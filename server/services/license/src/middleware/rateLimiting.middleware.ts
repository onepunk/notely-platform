import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../lib/redis';
import { logger } from '../utils/logger';

/**
 * Rate limiter configuration
 */
interface RateLimiterConfig {
  /**
   * Maximum number of requests allowed in the time window
   */
  maxRequests: number;

  /**
   * Time window in seconds
   */
  windowSeconds: number;

  /**
   * Key prefix for Redis keys
   */
  keyPrefix: string;

  /**
   * Function to extract rate limit key from request
   */
  keyExtractor: (req: Request) => string;
}

/**
 * Extracts client IP address from request
 * Handles both direct connections and proxied requests (X-Forwarded-For)
 *
 * @param req - Express request object
 * @returns Client IP address
 */
function getClientIp(req: Request): string {
  // Check X-Forwarded-For header first (for proxied requests)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  // Fall back to direct connection IP
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Creates a rate limiting middleware using Redis token bucket algorithm
 *
 * Implements sliding window rate limiting using Redis INCR and EXPIRE commands.
 * Returns 429 (Too Many Requests) when the limit is exceeded, with a Retry-After header.
 *
 * @param config - Rate limiter configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const limiter = createRateLimiter({
 *   maxRequests: 100,
 *   windowSeconds: 60,
 *   keyPrefix: 'ratelimit:validation',
 *   keyExtractor: (req) => getClientIp(req)
 * });
 * app.use('/api/validate', limiter, validationRoutes);
 * ```
 */
function createRateLimiter(config: RateLimiterConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedisClient();

      // Extract rate limit key (IP or user ID)
      const identifier = config.keyExtractor(req);
      const redisKey = `${config.keyPrefix}:${identifier}`;

      logger.debug('Checking rate limit', {
        key: redisKey,
        identifier,
      });

      // Increment counter atomically
      const currentCount = await redis.incr(redisKey);

      // Set expiration on first request in window
      if (currentCount === 1) {
        await redis.expire(redisKey, config.windowSeconds);
        logger.debug('First request in window', {
          key: redisKey,
          expiresIn: config.windowSeconds,
        });
      }

      // Get TTL to calculate when limit resets
      const ttl = await redis.ttl(redisKey);

      logger.debug('Rate limit check', {
        key: redisKey,
        count: `${currentCount}/${config.maxRequests}`,
        ttl,
      });

      // Check if limit exceeded
      if (currentCount > config.maxRequests) {
        const retryAfter = Math.max(ttl, 1); // At least 1 second

        logger.warn('Rate limit exceeded', {
          identifier,
          key: redisKey,
          count: `${currentCount}/${config.maxRequests}`,
          retryAfter,
        });

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': (Date.now() + retryAfter * 1000).toString(),
          'Retry-After': retryAfter.toString(),
        });

        res.status(429).json({
          error: 'rate_limit_exceeded',
          message: 'Too many requests, please try again later',
          retry_after_seconds: retryAfter,
        });
        return;
      }

      // Set rate limit headers
      const remaining = Math.max(config.maxRequests - currentCount, 0);
      res.set({
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': (Date.now() + ttl * 1000).toString(),
      });

      next();
    } catch (error) {
      // Log error but don't block request on rate limiter failure
      logger.error('Rate limiter Redis error, allowing request', { error });
      next();
    }
  };
}

/**
 * Rate limiter for license validation endpoints
 *
 * Limits: 100 requests per minute per IP address
 * Use on public-facing validation endpoints to prevent abuse
 *
 * @example
 * ```typescript
 * app.use('/api/validate', validationRateLimiter, validationRoutes);
 * ```
 */
export const validationRateLimiter = createRateLimiter({
  maxRequests: 100,
  windowSeconds: 60,
  keyPrefix: 'ratelimit:validation',
  keyExtractor: getClientIp,
});

/**
 * Rate limiter for admin endpoints
 *
 * Limits: 1000 requests per minute per authenticated user
 * Use on admin endpoints to prevent abuse while allowing legitimate operations
 *
 * @example
 * ```typescript
 * app.use('/api/admin', authMiddleware, adminRateLimiter, adminRoutes);
 * ```
 */
export const adminRateLimiter = createRateLimiter({
  maxRequests: 1000,
  windowSeconds: 60,
  keyPrefix: 'ratelimit:admin',
  keyExtractor: (req: Request) => {
    // Use authenticated user ID if available, otherwise fall back to IP
    return req.authContext?.userId || getClientIp(req);
  },
});

/**
 * Rate limiter for heartbeat/status check endpoints
 *
 * Limits: 20 requests per minute per client
 * Stricter limit to prevent excessive polling from desktop clients
 *
 * @example
 * ```typescript
 * app.post('/api/heartbeat', heartbeatRateLimiter, heartbeatHandler);
 * ```
 */
export const heartbeatRateLimiter = createRateLimiter({
  maxRequests: 20,
  windowSeconds: 60,
  keyPrefix: 'ratelimit:heartbeat',
  keyExtractor: (req: Request) => {
    // Use combination of user ID and client identifier for stricter per-client limits
    const userId = req.authContext?.userId || 'anonymous';
    const clientIp = getClientIp(req);
    return `${userId}:${clientIp}`;
  },
});
