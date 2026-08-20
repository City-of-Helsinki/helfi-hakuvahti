import type { FastifyPluginAsync } from 'fastify';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader.ts';
import { Statistics } from '../lib/statistics.ts';
import { buildPeriods, parseDay, resolveRange } from '../lib/statsReport.ts';
import { Generic400Error, type Generic400ErrorType } from '../types/error.ts';
import {
  type StatisticsCollectionType,
  StatsQuery,
  type StatsQueryType,
  StatsResponse,
  type StatsResponseType,
} from '../types/statistics.ts';

/** Per-site key figures. One site per request: a hakuvahti *is* a site_id. */
const stats: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.get<{
    Params: { site_id: string };
    Querystring: StatsQueryType;
    Reply: StatsResponseType | Generic400ErrorType;
  }>(
    '/stats/:site_id',
    {
      schema: {
        querystring: StatsQuery,
        response: {
          200: StatsResponse,
          400: Generic400Error,
        },
      },
    },
    async (request, reply) => {
      const { site_id } = request.params;
      const { interval = 'month', from, to } = request.query;

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

      // `_id` is `${site_id}:${day}` and both halves sort lexicographically, so
      // the always-indexed `_id` answers the range and the ordering at once.
      const [documents, earliest, current] = await Promise.all([
        statistics
          .find({ _id: { $gte: `${site_id}:${range.from}`, $lte: `${site_id}:${range.to}` } })
          .sort({ _id: 1 })
          .toArray(),

        // ':' sorts above every character a site id can hold, so a site whose
        // id merely starts with this one cannot leak in.
        statistics
          .find({ _id: { $gte: `${site_id}:`, $lt: `${site_id};` } })
          .sort({ _id: 1 })
          .limit(1)
          .next(),

        // The same measurement the cron stores, so `current` and `active_end`
        // stay comparable.
        fastify.statistics.countLive(site_id),
      ]);

      const periods = buildPeriods(documents, range, today);

      // 200 with a zero-filled series: a 404 would look like a bad path.
      return reply
        .code(200)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({
          site_id,
          generated_at: new Date().toISOString(),
          collecting_since: earliest?.day ?? null,
          range,
          current,
          periods,
        });
    },
  );
};

export default stats;
