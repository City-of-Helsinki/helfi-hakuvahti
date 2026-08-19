import * as Sentry from '@sentry/node';
import type { Collection, Db, MongoServerError, UpdateFilter } from 'mongodb';
import {
  STAT_EVENTS,
  type StatEventType,
  type StatisticsCollectionType,
  type StatSnapshotInput,
} from '../types/statistics.ts';
import {
  SUBSCRIPTION_LANGUAGES,
  type SubscriptionCollectionLanguageType,
  SubscriptionStatus,
} from '../types/subscription.ts';

export interface StatisticsDependencies {
  db: Db;
}

/**
 * Aggregate subscription counters, one document per (site_id, day).
 *
 * Exists because `subscription` is a current-state store — rows are hard-deleted
 * on unsubscribe and on expiry — so it can never answer how many of something
 * happened during a past period. Counters are written inline by whatever causes
 * the event; nothing aggregates on a schedule.
 */
export class Statistics {
  private readonly collection: Collection<StatisticsCollectionType>;
  private readonly db: Db;

  // en-CA renders as YYYY-MM-DD; the timeZone is the part that matters.
  private static readonly dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  constructor(deps: StatisticsDependencies) {
    this.db = deps.db;
    this.collection = deps.db.collection<StatisticsCollectionType>('statistics');
  }

  /**
   * The reporting day a timestamp belongs to. Helsinki rather than UTC, so month
   * boundaries match the ones a product owner reads.
   */
  static day(date: Date = new Date()): string {
    return Statistics.dayFormatter.format(date);
  }

  /**
   * Records one lifecycle event, counting subscriptions rather than channels: a
   * subscriber who confirms both email and SMS increments `confirmed` once.
   *
   * Never throws. Statistics must not fail the operation that triggered them.
   */
  async record(
    siteId: string,
    event: StatEventType,
    { lang, count = 1 }: { lang: SubscriptionCollectionLanguageType; count?: number },
  ): Promise<void> {
    if (count <= 0) {
      return;
    }

    // Both values end up in `$inc` key paths, and production enforces no schema,
    // so a bad one would create a junk subtree instead of failing.
    if (!STAT_EVENTS.includes(event) || !SUBSCRIPTION_LANGUAGES.includes(lang)) {
      Sentry.captureMessage(`Refusing statistics write: event='${event}' lang='${lang}'`);
      return;
    }

    await this.upsert(siteId, {
      $inc: {
        [`events.${event}`]: count,
        [`lang.${lang}.${event}`]: count,
      },
    });
  }

  /**
   * Counts a site's live subscriptions.
   *
   * Lives here so the stored snapshot and the `current` block of GET /stats are
   * the same measurement: their whole purpose is to be comparable, and two
   * copies of the query would let them drift apart on any future change.
   */
  async countLive(siteId: string): Promise<StatSnapshotInput> {
    const subscriptions = this.db.collection('subscription');

    const [active, unconfirmed] = await Promise.all([
      subscriptions.countDocuments({ site_id: siteId, status: SubscriptionStatus.ACTIVE }),
      subscriptions.countDocuments({ site_id: siteId, status: SubscriptionStatus.INACTIVE }),
    ]);

    return { active, unconfirmed };
  }

  /**
   * Measures a site and stores the result on today's document, as an independent
   * check on the event counters: the day-to-day delta should track net_change,
   * and a persistent divergence means an event is being missed.
   *
   * Never throws, for the same reason record() does not — a lost measurement
   * costs one point in a series, and must not abort the caller's work.
   */
  async measure(siteId: string): Promise<void> {
    try {
      await this.recordSnapshot(siteId, await this.countLive(siteId));
    } catch (error) {
      console.error(`Failed to measure subscription counts for ${siteId}`, error);
      Sentry.captureException(error);
    }
  }

  /** Records the live counts measured for a site today. Last write wins. */
  async recordSnapshot(siteId: string, snapshot: StatSnapshotInput): Promise<void> {
    await this.upsert(siteId, {
      $set: { snapshot: { at: new Date(), ...snapshot } },
    });
  }

  /**
   * Conditions worth one immediate retry rather than a lost counter.
   *
   * 11000 happens when two writes race to create a day's document: both find no
   * match, both attempt the insert, one loses. It can only occur on the first
   * write of a site's day, and by the time we retry the document exists, so the
   * retry is a plain $inc.
   */
  private static readonly RETRYABLE = new Set([
    11000, // duplicate key
    16500, // Cosmos DB: request rate too large
  ]);

  /** The single write primitive, so both callers share one failure policy. */
  private async upsert(siteId: string, update: UpdateFilter<StatisticsCollectionType>): Promise<void> {
    const day = Statistics.day();
    const filter = { _id: `${siteId}:${day}` };
    const document = {
      ...update,
      // Must not overlap the paths above, or the whole update is rejected.
      $setOnInsert: { site_id: siteId, day, created: new Date() } satisfies Partial<StatisticsCollectionType>,
    };

    try {
      await this.collection.updateOne(filter, document, { upsert: true });
    } catch (error) {
      if (Statistics.RETRYABLE.has((error as MongoServerError)?.code as number)) {
        try {
          await this.collection.updateOne(filter, document, { upsert: true });

          return;
        } catch {
          // Fall through and report the original failure.
        }
      }

      console.error(`Failed to write statistics for ${siteId}`, error);
      Sentry.captureException(error);
    }
  }
}
