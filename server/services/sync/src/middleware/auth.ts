import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { config } from '../config/env';

type SyncJwtPayload = JwtPayload & {
  sub: string;
  device_id?: string;
  scope?: string[] | string;
  aud?: string | string[];
};

function isAudienceValid(aud?: string | string[]) {
  if (!aud) {
    return false;
  }
  if (Array.isArray(aud)) {
    return aud.includes('sync-service');
  }
  return aud === 'sync-service';
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.auth.jwtPublicKey) {
    console.error('[authMiddleware] JWT_PUBLIC_KEY not configured');
    return res.status(500).json({
      error: 'server_misconfigured',
      message: 'Sync service missing JWT public key configuration',
    });
  }

  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token', message: 'Authorization header not provided' });
  }

  const token = header.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, config.auth.jwtPublicKey, {
      algorithms: ['RS256'],
      audience: 'sync-service',
    }) as SyncJwtPayload;

    console.log('[authMiddleware] Token verified for user:', decoded.sub);

    if (!decoded.sub) {
      return res.status(401).json({ error: 'invalid_token', message: 'Token missing subject' });
    }

    if (!isAudienceValid(decoded.aud)) {
      return res.status(401).json({ error: 'invalid_token', message: 'Token audience mismatch' });
    }

    req.authContext = {
      userId: decoded.sub,
      deviceId: decoded.device_id ?? null,
      scope: decoded.scope,
      deviceQuota: config.auth.deviceQuota,
    };

    return next();
  } catch (error) {
    console.error('[authMiddleware] Token verification failed:', (error as Error).name, (error as Error).message);
    return res.status(401).json({ error: 'invalid_token', message: 'Failed to verify token' });
  }
}
