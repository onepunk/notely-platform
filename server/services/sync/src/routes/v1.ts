import { Router } from 'express';
import { syncApiRouter } from './api';
import { updateDeviceCursor } from '../repositories/deviceCursorsRepository';

export const syncRouter = Router();

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Device linking endpoint - registers a desktop device with the sync service
 *
 * Note: This endpoint is for backward compatibility. Devices are also
 * auto-registered on their first POST /api/sync call.
 *
 * Request body:
 *   - device_id: UUID - unique identifier for this device (required)
 *   - client_info: object - optional device metadata (platform, version, device_name)
 *
 * Response:
 *   - device_id: the registered device identifier
 *   - server_user_id: the authenticated user's ID
 *   - linked_at: timestamp of registration
 */
syncRouter.post('/link', async (req: any, res) => {
  try {
    const userId = req.authContext?.userId;

    if (!userId) {
      console.error('[sync/link] No userId in authContext');
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { device_id, client_info } = req.body || {};

    if (!device_id) {
      console.error('[sync/link] Missing device_id', { userId, body: req.body });
      return res.status(400).json({
        success: false,
        error: 'Missing required field: device_id'
      });
    }

    // Validate UUID format
    if (!UUID_REGEX.test(device_id)) {
      console.error('[sync/link] Invalid device_id format', { userId, device_id });
      return res.status(400).json({
        success: false,
        error: 'Invalid device_id format: must be a valid UUID'
      });
    }

    // Build device name from client_info
    const deviceName = client_info?.device_name ||
                       `${client_info?.platform || 'unknown'}-${client_info?.version || 'unknown'}`;

    console.log('[sync/link] Registering device:', {
      userId,
      device_id,
      deviceName,
      clientInfo: client_info,
    });

    // PERSIST device cursor to database (cursor starts at 0)
    const cursor = await updateDeviceCursor(userId, device_id, deviceName);

    console.log('[sync/link] Device linked successfully:', {
      userId,
      device_id,
      deviceName,
      cursorId: cursor.id,
      lastSyncAt: cursor.last_sync_at,
    });

    // Return success response with device info
    res.status(200).json({
      success: true,
      data: {
        device_id,
        server_user_id: userId,
        linked_at: new Date().toISOString(),
      }
    });
  } catch (error: any) {
    console.error('[sync/link] Failed to link device:', {
      error: error?.message || error,
      stack: error?.stack,
      userId: req.authContext?.userId,
      body: req.body,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to link device',
      message: error?.message || 'Internal server error'
    });
  }
});

// Mount cursor-based sync API routes
syncRouter.use('/', syncApiRouter);
