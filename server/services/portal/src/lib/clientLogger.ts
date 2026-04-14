/**
 * Client-Side Logger for Portal
 * Simplified logger for browser-side React components
 *
 * Note: Client-side logs don't go to Loki - only server-side logs do.
 * This is for consistency and better debugging in browser console.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

export const clientLogger = {
  info: (message: string, meta?: Record<string, any>) => {
    if (isDevelopment) {
      console.log(`[PORTAL] ${message}`, meta || '');
    }
  },

  warn: (message: string, meta?: Record<string, any>) => {
    console.warn(`[PORTAL] ${message}`, meta || '');
  },

  error: (message: string, meta?: Record<string, any>) => {
    console.error(`[PORTAL] ${message}`, meta || '');
  },

  debug: (message: string, meta?: Record<string, any>) => {
    if (isDevelopment) {
      console.debug(`[PORTAL] ${message}`, meta || '');
    }
  },
};

export default clientLogger;
