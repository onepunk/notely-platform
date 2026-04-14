import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email?: string;
    deviceId?: string;
  };
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Path 1: Gateway-forwarded auth (X-Auth-* headers set after gateway validated the token)
  const gatewaySubject = req.headers['x-auth-subject'] as string | undefined;
  if (gatewaySubject) {
    req.user = {
      userId: gatewaySubject,
      email: req.headers['x-auth-email'] as string | undefined,
      deviceId: req.headers['x-auth-device-id'] as string | undefined,
    };
    return next();
  }

  // Path 2: Direct Bearer token (desktop client, service-to-service)
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  if (!config.auth.jwtPublicKey) {
    console.error('JWT_PUBLIC_KEY not configured');
    res.status(500).json({ error: 'Authentication not configured' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.auth.jwtPublicKey, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    req.user = {
      userId: decoded.sub as string,
      email: decoded.email as string | undefined,
      deviceId: decoded.deviceId as string | undefined,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}
