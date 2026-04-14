/**
 * Sync Notification Handler
 *
 * Processes sync notifications from Redis and forwards them to connected clients.
 */

class SyncNotifyHandler {
  constructor({ connectionManager, pubsubManager, logger }) {
    this.connectionManager = connectionManager;
    this.pubsubManager = pubsubManager;
    this.logger = logger;
    this.userCallbacks = new Map(); // userId -> callback function
  }

  /**
   * Register a user for sync notifications
   * Called when a WebSocket connection is established.
   *
   * @param {string} userId - User ID
   */
  async registerUser(userId) {
    // Don't re-register if already subscribed
    if (this.userCallbacks.has(userId)) {
      this.logger?.debug?.('User already registered for notifications', { userId });
      return;
    }

    const callback = (message) => {
      this.handleSyncNotification(userId, message);
    };

    this.userCallbacks.set(userId, callback);
    await this.pubsubManager.subscribeUser(userId, callback);

    this.logger?.debug?.('User registered for sync notifications', { userId });
  }

  /**
   * Unregister a user from sync notifications
   * Called when the last device for a user disconnects.
   *
   * @param {string} userId - User ID
   */
  async unregisterUser(userId) {
    const callback = this.userCallbacks.get(userId);
    if (!callback) {
      return;
    }

    await this.pubsubManager.unsubscribeUser(userId, callback);
    this.userCallbacks.delete(userId);

    this.logger?.debug?.('User unregistered from sync notifications', { userId });
  }

  /**
   * Handle incoming sync notification from Redis
   *
   * @param {string} userId - User ID
   * @param {object} message - Notification message from Redis
   */
  handleSyncNotification(userId, message) {
    const sourceDeviceId = message.source_device_id;
    const changesCount = message.changes_count || 0;
    const timestamp = message.timestamp || Date.now();

    this.logger?.info?.('Received sync notification', {
      userId,
      sourceDeviceId,
      changesCount
    });

    // Build message to send to other devices
    const wsMessage = {
      type: 'sync:needed',
      payload: {
        reason: 'remote_change',
        timestamp,
        originDeviceId: sourceDeviceId,
        changesCount
      }
    };

    // Notify all other devices for this user
    const notifiedCount = this.connectionManager.notifyUser(
      userId,
      sourceDeviceId,
      wsMessage
    );

    this.logger?.debug?.('Notified devices of sync', {
      userId,
      sourceDeviceId,
      notifiedCount
    });
  }

  /**
   * Check if user should be unregistered
   * Call this when a device disconnects.
   *
   * @param {string} userId - User ID
   */
  async checkAndUnregister(userId) {
    // If user has no more connected devices, unsubscribe from Redis
    if (!this.connectionManager.isUserConnected(userId)) {
      await this.unregisterUser(userId);
    }
  }
}

module.exports = SyncNotifyHandler;
