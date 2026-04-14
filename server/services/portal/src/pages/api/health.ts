import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Health check endpoint for Docker and monitoring
 * Returns 200 OK with basic service information
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Basic health check response
    return res.status(200).json({
      status: 'healthy',
      service: 'portal',
      version: process.env.VERSION || '3.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return res.status(500).json({
      status: 'unhealthy',
      service: 'portal',
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
}
