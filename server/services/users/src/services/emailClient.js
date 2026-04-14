/**
 * Email Client - Publishes email requests to the email microservice via RabbitMQ
 */

const shared = require('@notely/shared');
const logger = shared.logger.child({ module: 'users-email-client' });

let channel = null;
let connection = null;

const QUEUE_NAME = 'email.requests';
const ROUTING_KEY = 'email.send';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function initialize() {
  try {
    const amqp = require('amqplib');
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Assert the email requests queue exists
    // Must match shared messaging module's queue arguments to avoid PRECONDITION_FAILED
    await channel.assertQueue(QUEUE_NAME, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'notely.events.dlq',
        'x-dead-letter-routing-key': 'email.requests.dead-letter'
      }
    });

    logger.info('Email client initialized', { queue: QUEUE_NAME });
  } catch (error) {
    logger.warn('RabbitMQ connection failed - emails will not be sent', { error: error.message });
    // Don't fail service startup if RabbitMQ is unavailable
  }
}

/**
 * Queue an email using a template
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.template - Template name
 * @param {Object} options.templateData - Template variables
 */
async function queueTemplateEmail({ to, subject, template, templateData }) {
  if (!channel) {
    logger.debug('Email not queued - RabbitMQ channel not available', { to, template });
    return false;
  }

  try {
    const message = Buffer.from(JSON.stringify({
      to,
      subject,
      template,
      templateData,
      timestamp: new Date().toISOString()
    }));

    channel.sendToQueue(QUEUE_NAME, message, {
      persistent: true,
      contentType: 'application/json'
    });

    logger.info('Email queued (template)', { to, template, subject });
    return true;
  } catch (error) {
    logger.error('Failed to queue template email', { to, template, error: error.message });
    return false;
  }
}

/**
 * Queue a raw email with HTML and/or text content
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content (optional)
 * @param {string} options.text - Plain text content (optional)
 */
async function queueRawEmail({ to, subject, html, text }) {
  if (!channel) {
    logger.debug('Email not queued - RabbitMQ channel not available', { to });
    return false;
  }

  try {
    const message = Buffer.from(JSON.stringify({
      to,
      subject,
      html,
      text,
      timestamp: new Date().toISOString()
    }));

    channel.sendToQueue(QUEUE_NAME, message, {
      persistent: true,
      contentType: 'application/json'
    });

    logger.info('Email queued (raw)', { to, subject });
    return true;
  } catch (error) {
    logger.error('Failed to queue raw email', { to, error: error.message });
    return false;
  }
}

async function close() {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    logger.info('Email client closed');
  } catch (error) {
    logger.error('Error closing email client', { error: error.message });
  }
}

module.exports = {
  initialize,
  queueTemplateEmail,
  queueRawEmail,
  close
};
