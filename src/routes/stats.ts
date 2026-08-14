import type { FastifyPluginAsync } from 'fastify';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader.ts';
import { Statistics } from '../lib/statistics.ts';
import { buildPeriods, parseDay, periodOf, resolveRange, toCsv } from '../lib/statsReport.ts';
import { Generic400Error, type Generic400ErrorType } from '../types/error.ts';
import {
  type StatisticsCollectionType,
  StatsQuery,
  type StatsQueryType,
  type StatsResponseType,
} from '../types/statistics.ts';
import { SubscriptionStatus } from '../types/subscription.ts';

/**
 * Per-site key figures. One site per request: a hakuvahti *is* a site_id.
 *
 * Authorization is the globally applied API key and nothing more, since this
 * reads aggregate counts holding no personal data.
 */
const stats: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.get<{
    Params: { site_id: string };
    Querystring: StatsQueryType;
    Reply: StatsResponseType | Generic400ErrorType | string;
  }>(
    '/stats/:site_id',
    {
      schema: {
        querystring: StatsQuery,
        // No 200 schema on purpose: this route answers with JSON or CSV, and a
        // response serializer bound to one would mangle the other.
        response: {
          400: Generic400Error,
        },
      },
    },
    async (request, reply) => {
      const { site_id } = request.params;
      const { interval = 'month', format = 'json', from, to } = request.query;

      try {
        SiteConfigurationLoader.getConfiguration(site_id);
      } catch {
        return reply.code(400).send({ error: 'Invalid site_id provided.' });
      }

      if (from && !parseDay(from)) {
        return reply.code(400).send({ error: 'Invalid date.', field: 'from' });
      }

      if (to && !parseDay(to)) {
        return reply.code(400).send({ error: 'Invalid date.', field: 'to' });
      }

      if (from && to && to < from) {
        return reply.code(400).send({ error: 'Range end must not precede range start.', field: 'to' });
      }

      const db = fastify.mongo.db;
      if (!db) {
        throw new Error('MongoDB connection not available');
      }

      const today = Statistics.day();
      const range = resolveRange(interval, { from, to }, today);
      const statistics = db.collection<StatisticsCollectionType>('statistics');

      // Range-scan `_id` rather than filtering site_id and sorting day: `_id` is
      // `${site_id}:${day}` and both halves sort lexicographically, so the
      // always-indexed `_id` answers the range and the ordering at once. Cosmos
      // DB indexes only `_id` by default and needs an index for any sort.
      const documents = await statistics
        .find({ _id: { $gte: `${site_id}:${range.from}`, $lte: `${site_id}:${range.to}` } })
        .sort({ _id: 1 })
        .toArray();

      // ':' sorts above every character a site id can hold, so this cannot leak
      // into a site whose id merely starts with this one.
      const earliest = await statistics
        .find({ _id: { $gte: `${site_id}:`, $lt: `${site_id};` } })
        .sort({ _id: 1 })
        .limit(1)
        .next();

      const subscription = db.collection('subscription');
      const [active, unconfirmed] = await Promise.all([
        subscription.countDocuments({ site_id, status: SubscriptionStatus.ACTIVE }),
        subscription.countDocuments({ site_id, status: SubscriptionStatus.INACTIVE }),
      ]);

      const periods = buildPeriods(documents, range, today);

      if (format === 'csv') {
        const filename = `hakuvahti-${site_id}-${periodOf(range.from, interval)}-${periodOf(range.to, interval)}.csv`;

        return reply
          .code(200)
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(toCsv(periods));
      }

      // A configured site with no data answers 200 with a zero-filled series: a
      // 404 would be indistinguishable from a typo in the path.
      return reply
        .code(200)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({
          site_id,
          generated_at: new Date().toISOString(),
          collecting_since: earliest?.day ?? null,
          range,
          current: { active, unconfirmed },
          periods,
        });
    },
  );
};

export default stats;
