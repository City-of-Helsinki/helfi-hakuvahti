import crypto from 'node:crypto';
import fp from 'fastify-plugin';

export type RateLimitPluginOptions = Record<string, never>;

// In-memory storage for rate limits - persists for lifetime of the process
const rateLimits = new Map<string, { count: number; resetAt: number }>();

// Cleanup interval reference
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Hash key using SHA-256 for privacy (never store raw IPs).
 */
const hashKey = (key: string): string => crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);

export default fp<RateLimitPluginOptions>(async (fastify, _opts) => {
  // Start cleanup interval when plugin loads (every 60 seconds)
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimits.entries()) {
      if (now > entry.resetAt) {
        rateLimits.delete(key);
      }
    }
  }, 60 * 1000);

  // Clean up interval on server close
  fastify.addHook('onClose', () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  });

  /**
   * Check if a request is within rate limits.
   *
   * @param rawKey - The key to rate limit (e.g., IP address) - will be hashed
   * @param maxAttempts - Maximum attempts allowed in window (default: 5)
   * @param windowMs - Window duration in milliseconds (default: 15 minutes)
   * @returns true if request is allowed, false if rate limited
   */
  fastify.decorate(
    'checkRateLimit',
    function checkRateLimit(rawKey: string, maxAttempts = 5, windowMs = 15 * 60 * 1000): boolean {
      const key = hashKey(rawKey);
      const now = Date.now();
      const entry = rateLimits.get(key);

      // First attempt or window expired - allow and reset
      if (!entry || now > entry.resetAt) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      // Over limit
      if (entry.count >= maxAttempts) {
        return false;
      }

      // Under limit - increment and allow
      entry.count++;
      return true;
    },
  );
});

declare module 'fastify' {
  export interface FastifyInstance {
    checkRateLimit(key: string, maxAttempts?: number, windowMs?: number): boolean;
  }
}
