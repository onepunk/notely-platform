import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    authContext?: {
      userId: string;
      deviceId: string | null;
      scope?: string[] | string;
      deviceQuota: number;
    };
  }
}
