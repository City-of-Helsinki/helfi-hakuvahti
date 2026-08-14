import * as Sentry from '@sentry/node';
import type { Collection, Db, UpdateFilter } from 'mongodb';
import {
  STAT_EVENTS,
  type StatEventType,
  type StatisticsCollectionType,
  type StatSnapshotInput,
} from '../types/statistics.ts';
import { SUBSCRIPTION_LANGUAGES, type SubscriptionCollectionLanguageType } from '../types/subscription.ts';

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

  // en-CA renders as YYYY-MM-DD; the timeZone is the part that matters.
  private static readonly dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  constructor(deps: StatisticsDependencies) {
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

  /** Records the live counts measured for a site today. Last write wins. */
  async recordSnapshot(siteId: string, snapshot: StatSnapshotInput): Promise<void> {
    await this.upsert(siteId, {
      $set: { snapshot: { at: new Date(), ...snapshot } },
    });
  }

  /** The single write primitive, so both callers share one failure policy. */
  private async upsert(siteId: string, update: UpdateFilter<StatisticsCollectionType>): Promise<void> {
    const day = Statistics.day();

    try {
      await this.collection.updateOne(
        { _id: `${siteId}:${day}` },
        {
          ...update,
          // Must not overlap the paths above, or the whole update is rejected.
          $setOnInsert: { site_id: siteId, day, created: new Date() } satisfies Partial<StatisticsCollectionType>,
        },
        { upsert: true },
      );
    } catch (error) {
      console.error(`Failed to write statistics for ${siteId}`, error);
      Sentry.captureException(error);
    }
  }
}
