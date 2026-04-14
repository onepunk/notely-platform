import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    authContext?: {
      userId: string;
      email?: string;
      role?: string;
      scope?: string[] | string;
      organizationId?: string;
    };
  }
}
