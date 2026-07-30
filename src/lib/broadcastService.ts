import type { Db, Filter, ObjectId } from 'mongodb';
import type { AtvDocumentType } from '../types/atv.ts';
import type { BroadcastRequestType, BroadcastStatsType } from '../types/broadcast.ts';
import type { QueueInsertDocument } from '../types/queue.ts';
import type { SiteConfigurationType } from '../types/siteConfig.ts';
import {
  SUBSCRIPTION_LANGUAGES,
  type SubscriptionCollectionLanguageType,
  type SubscriptionCollectionType,
  SubscriptionStatus,
} from '../types/subscription.ts';
import { ATV } from './atv.ts';
import { broadcastEmail } from './email.ts';
import { BATCH_SIZE } from './queueService.ts';
import { isEmailActive, isSmsActive } from './subscriptionProcessor.ts';

export interface BroadcastServiceDeps {
  db: Db;
  atv: ATV;
  batchSize?: number;
}

type ContentByLanguage = Record<SubscriptionCollectionLanguageType, string>;

/**
 * Service for handling broadcast messages.
 *
 * Fans a one-off message out to the subscribers of a single site.
 * Delivery happens through the normal queue processing.
 */
export class BroadcastService {
  private readonly subscriptionCollection;
  private readonly queueCollection;
  private readonly atv: ATV;
  private readonly batchSize: number;

  constructor(deps: BroadcastServiceDeps) {
    this.subscriptionCollection = deps.db.collection<SubscriptionCollectionType>('subscription');
    this.queueCollection = deps.db.collection<QueueInsertDocument>('queue');
    this.atv = deps.atv;
    this.batchSize = deps.batchSize ?? BATCH_SIZE;
  }

  /**
   * Send message to all subscribers.
   *
   * Since we obfuscate PII, We have no way to deduplicate
   * individual recipients at the database level. We need to
   * load user details from ATV to memory and only then we can
   * deduplicate users.
   *
   * Due to deduplication, the memory requirements for broadcasting
   * grow with subscriber count. Only seen emails and phone nubmers
   * are stored in memory, while heavier ATV requests etc. are handled
   * in batches and can be released aftger each chunk. This should keep
   * memory requirements manageable event for large subscibtion counts.
   *
   * @param siteConfig Only target subscribers from this site.
   * @param messages Message details.
   * @param subscriptionIds when given, only these subscriptions
   *   of the site are targeted.
   */
  async broadcast(
    siteConfig: SiteConfigurationType,
    messages: BroadcastRequestType['messages'],
    subscriptionIds?: ObjectId[],
  ): Promise<BroadcastStatsType> {
    const emailByLang = {} as ContentByLanguage;
    for (const lang of SUBSCRIPTION_LANGUAGES) {
      emailByLang[lang] = await broadcastEmail(lang, messages[lang], siteConfig);
    }

    const smsByLang =
      siteConfig.subscription.enableSms && SUBSCRIPTION_LANGUAGES.every((lang) => messages[lang].sms)
        ? (Object.fromEntries(SUBSCRIPTION_LANGUAGES.map((lang) => [lang, messages[lang].sms])) as ContentByLanguage)
        : undefined;

    const filter: Filter<SubscriptionCollectionType> = {
      site_id: siteConfig.id,
      status: SubscriptionStatus.ACTIVE,
    };

    // If user provider subscriptionIds, only send
    // to those subscriptions.
    if (subscriptionIds) {
      filter._id = { $in: subscriptionIds };
    }

    const stats: BroadcastStatsType = {
      subscriptionsChecked: 0,
      emailsQueued: 0,
      smsQueued: 0,
      missingContacts: 0,
    };

    // Newest subscription first. When one address has several
    // subscriptions the most recently renewed one decides the language.
    const cursor = this.subscriptionCollection
      .find(filter, {
        projection: { atv_id: 1, email: 1, lang: 1, created: 1, email_confirmed: 1, sms_confirmed: 1, status: 1 },
      })
      .sort({ created: -1 });

    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();

    let chunk: Partial<SubscriptionCollectionType>[] = [];
    for await (const subscription of cursor) {
      chunk.push(subscription);
      if (chunk.length >= this.batchSize) {
        await this.processChunk(chunk, emailByLang, smsByLang, seenEmails, seenPhones, stats);
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      await this.processChunk(chunk, emailByLang, smsByLang, seenEmails, seenPhones, stats);
    }

    return stats;
  }

  private async processChunk(
    chunk: Partial<SubscriptionCollectionType>[],
    emailByLang: ContentByLanguage,
    smsByLang: ContentByLanguage | undefined,
    seenEmails: Set<string>,
    seenPhones: Set<string>,
    stats: BroadcastStatsType,
  ): Promise<void> {
    const atvIds = [...new Set(chunk.map((subscription) => ATV.getAtvId(subscription)).filter(Boolean))];
    const atvDocuments = await this.atv.getDocumentBatch(atvIds);
    const atvMap = new Map<string, AtvDocumentType>();

    atvDocuments.forEach((doc) => {
      if (doc?.id) atvMap.set(doc.id, doc);
    });

    const queueDocuments: QueueInsertDocument[] = [];

    for (const subscription of chunk) {
      stats.subscriptionsChecked++;

      const atvId = ATV.getAtvId(subscription);
      const atvDoc = atvMap.get(atvId);
      const email = atvDoc?.content?.email as string | undefined;
      const phone = atvDoc?.content?.sms as string | undefined;

      if (!email && !phone) {
        stats.missingContacts++;
        console.warn(`No contact details found for ATV ID ${atvId}`);
        continue;
      }

      const lang = subscription.lang ?? 'fi';

      if (isEmailActive(subscription) && email && !seenEmails.has(email.toLowerCase())) {
        seenEmails.add(email.toLowerCase());
        queueDocuments.push({ type: 'email', atv_id: atvId, content: emailByLang[lang] });
        stats.emailsQueued++;
      }

      // Phone numbers are normalized at subscribe time, so plain string
      // equality is enough for deduplication.
      if (smsByLang && isSmsActive(subscription) && phone && !seenPhones.has(phone)) {
        seenPhones.add(phone);
        queueDocuments.push({ type: 'sms', atv_id: atvId, content: smsByLang[lang] });
        stats.smsQueued++;
      }
    }

    if (queueDocuments.length > 0) {
      await this.queueCollection.insertMany(queueDocuments, { ordered: false });
    }
  }
}
