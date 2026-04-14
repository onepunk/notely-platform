/**
 * WebSocket Connection Manager
 *
 * Tracks connected devices per user and enables targeted messaging.
 */

class ConnectionManager {
  constructor({ maxConnectionsPerUser = 5, logger }) {
    this.maxConnectionsPerUser = maxConnectionsPerUser;
    this.logger = logger;
    // Map: userId -> Map<deviceId, ConnectedDevice>
    this.connections = new Map();
    // Reverse lookup: ws -> { userId, deviceId }
    this.socketToUser = new WeakMap();
  }

  /**
   * Add a new connection
   *
   * @param {string} userId - User ID
   * @param {string} deviceId - Device ID
   * @param {WebSocket} socket - WebSocket instance
   * @returns {boolean} - True if connection was added, false if limit exceeded
   */
  addConnection(userId, deviceId, socket) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Map());
    }

    const userConnections = this.connections.get(userId);

    // Check if this device is already connected (reconnection)
    if (userConnections.has(deviceId)) {
      const existing = userConnections.get(deviceId);
      // Close the old connection
      try {
        existing.socket.close(1000, 'Replaced by new connection');
      } catch (err) {
        this.logger?.debug?.('Error closing existing connection', { error: err.message });
      }
    }

    // Check connection limit (excluding the device being reconnected)
    const currentCount = userConnections.size - (userConnections.has(deviceId) ? 1 : 0);
    if (currentCount >= this.maxConnectionsPerUser) {
      this.logger?.warn?.('Connection limit exceeded', {
        userId,
        deviceId,
        currentCount,
        maxConnections: this.maxConnectionsPerUser
      });
      return false;
    }

    const device = {
      deviceId,
      socket,
      connectedAt: Date.now(),
      lastPing: Date.now()
    };

    userConnections.set(deviceId, device);
    this.socketToUser.set(socket, { userId, deviceId });

    this.logger?.info?.('Connection added', {
      userId,
      deviceId,
      totalUserConnections: userConnections.size
    });

    return true;
  }

  /**
   * Remove a connection
   *
   * @param {string} userId - User ID
   * @param {string} deviceId - Device ID
   */
  removeConnection(userId, deviceId) {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return;
    }

    const device = userConnections.get(deviceId);
    if (device) {
      userConnections.delete(deviceId);
      this.logger?.info?.('Connection removed', {
        userId,
        deviceId,
        remainingConnections: userConnections.size
      });
    }

    // Clean up empty user entries
    if (userConnections.size === 0) {
      this.connections.delete(userId);
    }
  }

  /**
   * Remove connection by socket reference
   *
   * @param {WebSocket} socket - WebSocket instance
   * @returns {{ userId: string, deviceId: string } | null}
   */
  removeConnectionBySocket(socket) {
    const info = this.socketToUser.get(socket);
    if (info) {
      this.removeConnection(info.userId, info.deviceId);
      return info;
    }
    return null;
  }

  /**
   * Get other devices for a user (excluding specified device)
   *
   * @param {string} userId - User ID
   * @param {string} excludeDeviceId - Device ID to exclude
   * @returns {Array<{ deviceId: string, socket: WebSocket }>}
   */
  getOtherDevices(userId, excludeDeviceId) {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return [];
    }

    const devices = [];
    for (const [deviceId, device] of userConnections) {
      if (deviceId !== excludeDeviceId) {
        devices.push(device);
      }
    }
    return devices;
  }

  /**
   * Get all devices for a user
   *
   * @param {string} userId - User ID
   * @returns {Array<{ deviceId: string, socket: WebSocket }>}
   */
  getAllDevices(userId) {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return [];
    }
    return Array.from(userConnections.values());
  }

  /**
   * Get count of connected devices for a user
   *
   * @param {string} userId - User ID
   * @returns {number}
   */
  getUserDeviceCount(userId) {
    const userConnections = this.connections.get(userId);
    return userConnections ? userConnections.size : 0;
  }

  /**
   * Send message to all of a user's other devices
   *
   * @param {string} userId - User ID
   * @param {string} excludeDeviceId - Device ID to exclude (the source)
   * @param {object} message - Message to send
   * @returns {number} - Number of devices notified
   */
  notifyUser(userId, excludeDeviceId, message) {
    const devices = this.getOtherDevices(userId, excludeDeviceId);
    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    for (const device of devices) {
      try {
        if (device.socket.readyState === 1) { // WebSocket.OPEN
          device.socket.send(messageStr);
          sentCount++;
        }
      } catch (err) {
        this.logger?.error?.('Failed to send message to device', {
          userId,
          deviceId: device.deviceId,
          error: err.message
        });
      }
    }

    return sentCount;
  }

  /**
   * Update last ping time for a device
   *
   * @param {WebSocket} socket - WebSocket instance
   */
  updateLastPing(socket) {
    const info = this.socketToUser.get(socket);
    if (info) {
      const userConnections = this.connections.get(info.userId);
      if (userConnections) {
        const device = userConnections.get(info.deviceId);
        if (device) {
          device.lastPing = Date.now();
        }
      }
    }
  }

  /**
   * Get connection info from socket
   *
   * @param {WebSocket} socket - WebSocket instance
   * @returns {{ userId: string, deviceId: string } | undefined}
   */
  getConnectionInfo(socket) {
    return this.socketToUser.get(socket);
  }

  /**
   * Get statistics
   *
   * @returns {{ totalConnections: number, totalUsers: number }}
   */
  getStats() {
    let totalConnections = 0;
    for (const userConnections of this.connections.values()) {
      totalConnections += userConnections.size;
    }
    return {
      totalConnections,
      totalUsers: this.connections.size
    };
  }

  /**
   * Check if user has active connections
   *
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  isUserConnected(userId) {
    return this.connections.has(userId) && this.connections.get(userId).size > 0;
  }
}

module.exports = ConnectionManager;
