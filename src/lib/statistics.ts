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

/** Aggregate subscription counters, one document per (site_id, day). */
export class Statistics {
  private readonly statistics: Collection<StatisticsCollectionType>;
  private readonly subscriptions: Collection;

  private static readonly dayFormatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Helsinki',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  constructor(deps: StatisticsDependencies) {
    this.statistics = deps.db.collection<StatisticsCollectionType>('statistics');
    this.subscriptions = deps.db.collection('subscription');
  }

  /**
   * The Europe/Helsinki day a timestamp belongs to, as YYYY-MM-DD.
   *
   * Assembled from the parts because no API returns an ISO date in a given
   * timezone: toISOString() is UTC, and format() follows the locale's order.
   */
  static day(date: Date = new Date()): string {
    const parts = Statistics.dayFormatter.formatToParts(date);
    const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';

    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  /**
   * Records one lifecycle event. Counts subscriptions, not channels: confirming
   * both email and SMS increments `confirmed` once. Never throws.
   */
  async record(
    siteId: string,
    event: StatEventType,
    { lang, count = 1 }: { lang: SubscriptionCollectionLanguageType; count?: number },
  ): Promise<void> {
    if (count <= 0) {
      return;
    }

    // Both end up in `$inc` key paths and production enforces no schema.
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

  /** Counts a site's live subscriptions. Shared with GET /stats `current`. */
  async countLive(siteId: string): Promise<StatSnapshotInput> {
    const [active, unconfirmed] = await Promise.all([
      this.subscriptions.countDocuments({ site_id: siteId, status: SubscriptionStatus.ACTIVE }),
      this.subscriptions.countDocuments({ site_id: siteId, status: SubscriptionStatus.INACTIVE }),
    ]);

    return { active, unconfirmed };
  }

  /**
   * Measures a site and stores the counts on today's document, as an independent
   * check on the event counters. Last write of the day wins. Never throws.
   */
  async measure(siteId: string): Promise<void> {
    try {
      const snapshot = await this.countLive(siteId);

      await this.upsert(siteId, { $set: { snapshot: { at: new Date(), ...snapshot } } });
    } catch (error) {
      console.error(`Failed to measure subscription counts for ${siteId}`, error);
      Sentry.captureException(error);
    }
  }

  /** The single write primitive, so both callers share one failure policy. */
  private async upsert(siteId: string, update: UpdateFilter<StatisticsCollectionType>): Promise<void> {
    const day = Statistics.day();
    const filter = { _id: `${siteId}:${day}` };
    const document = {
      ...update,
      // Must not overlap the paths above, or the update is rejected.
      $setOnInsert: { site_id: siteId, day, created: new Date() } satisfies Partial<StatisticsCollectionType>,
    };

    try {
      await this.statistics.updateOne(filter, document, { upsert: true });
    } catch (error) {
      // 11000 is a duplicate key.
      if ((error as MongoServerError)?.code === 11000) {
        try {
          await this.statistics.updateOne(filter, document, { upsert: true });

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
