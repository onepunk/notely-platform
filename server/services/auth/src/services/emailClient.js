/**
 * Email Client for Auth Service
 * Publishes email requests to RabbitMQ for the email microservice to process.
 * Minimal client following the same pattern as support service emailClient.
 */

const { v4: uuidv4 } = require('uuid');
const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'auth-email-client' });

let messagingContext = null;

const EXCHANGE_NAME = 'email.requests';
const ROUTING_KEY = 'email.send';

/**
 * Initialize RabbitMQ connection using shared messaging module
 */
async function initialize() {
  if (messagingContext) {
    return messagingContext;
  }

  try {
    messagingContext = await shared.messaging.createContext({
      serviceName: process.env.SERVICE_NAME || 'auth',
      exchange: EXCHANGE_NAME
    });

    logger.info('Auth email client initialized', { exchange: EXCHANGE_NAME });
  } catch (error) {
    logger.error('Failed to initialize auth email client messaging', { error: error.message });
    throw error;
  }

  return messagingContext;
}

/**
 * Queue a verification email with an 8-character code
 * @param {Object} options
 * @param {string} options.email - Recipient email address
 * @param {string} options.firstName - User's first name
 * @param {string} options.code - 8-character verification code
 * @returns {Promise<string|null>} Correlation ID or null if failed
 */
async function queueVerificationEmail({ email, firstName, code }) {
  if (!messagingContext) {
    logger.warn('Verification email not queued - messaging context not initialized', { email });
    return null;
  }

  try {
    const correlationId = uuidv4();

    const payload = {
      correlationId,
      timestamp: new Date().toISOString(),
      recipient: email,
      to: email,
      subject: 'Verify Your Email - Notely',
      template: 'email-verification',
      templateData: {
        firstName: firstName || 'there',
        code,
        footerText: "You're receiving this because you created a Notely account."
      }
    };

    await messagingContext.publish(ROUTING_KEY, payload);

    logger.info('Verification email queued', { correlationId, email });
    return correlationId;
  } catch (error) {
    logger.error('Failed to queue verification email', { email, error: error.message });
    return null;
  }
}

/**
 * Close messaging connection
 */
async function close() {
  if (!messagingContext) {
    return;
  }

  try {
    await messagingContext.close();
    messagingContext = null;
    logger.info('Auth email client closed');
  } catch (error) {
    logger.error('Error closing auth email client', { error: error.message });
  }
}

module.exports = {
  initialize,
  queueVerificationEmail,
  close
};
