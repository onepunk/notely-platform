"use strict";

const amqplib = require('amqplib');
const promClient = require('prom-client');
const { v4: uuidv4 } = require('uuid');
const sharedLogger = require('../logger');

const DEFAULT_EXCHANGE = 'notely.events';
const DEFAULT_DL_EXCHANGE = 'notely.events.dlq';
const DEFAULT_PREFETCH = 10;

const connectionCache = new Map();

function getOrCreateMetric(name, factory) {
  const existing = promClient.register.getSingleMetric(name);
  if (existing) {
    return existing;
  }
  return factory();
}

const publishedCounter = getOrCreateMetric(
  'notely_mq_published_total',
  () =>
    new promClient.Counter({
      name: 'notely_mq_published_total',
      help: 'Total messages published to RabbitMQ',
      labelNames: ['service', 'routing_key']
    })
);

const publishErrorCounter = getOrCreateMetric(
  'notely_mq_publish_failed_total',
  () =>
    new promClient.Counter({
      name: 'notely_mq_publish_failed_total',
      help: 'Total publish attempts that failed',
      labelNames: ['service', 'routing_key']
    })
);

const consumedCounter = getOrCreateMetric(
  'notely_mq_consumed_total',
  () =>
    new promClient.Counter({
      name: 'notely_mq_consumed_total',
      help: 'Total messages consumed from RabbitMQ',
      labelNames: ['service', 'routing_key']
    })
);

const rejectedCounter = getOrCreateMetric(
  'notely_mq_rejected_total',
  () =>
    new promClient.Counter({
      name: 'notely_mq_rejected_total',
      help: 'Total messages rejected or sent to DLQ',
      labelNames: ['service', 'routing_key']
    })
);

const processingHistogram = getOrCreateMetric(
  'notely_mq_processing_seconds',
  () =>
    new promClient.Histogram({
      name: 'notely_mq_processing_seconds',
      help: 'Time taken to process a consumed message',
      labelNames: ['service', 'queue', 'routing_key'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]
    })
);

async function getOrCreateConnection(url, logger, serviceName) {
  if (connectionCache.has(url)) {
    return connectionCache.get(url);
  }

  logger.info('Establishing RabbitMQ connection', { url, serviceName });

  const connectionPromise = amqplib
    .connect(url, {
      clientProperties: {
        connection_name: `${serviceName || 'unknown'}:${process.pid}`
      },
      heartbeat: 30
    })
    .then((connection) => {
      connection.on('error', (error) => {
        logger.error('RabbitMQ connection error', { error: error.message });
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        connectionCache.delete(url);
      });

      logger.info('RabbitMQ connection established');
      return connection;
    })
    .catch((error) => {
      connectionCache.delete(url);
      logger.error('Failed to connect to RabbitMQ', { error: error.message });
      throw error;
    });

  connectionCache.set(url, connectionPromise);
  return connectionPromise;
}

class MessagingContext {
  constructor({
    url = process.env.RABBITMQ_URL,
    serviceName = process.env.SERVICE_NAME || 'unknown',
    exchange = DEFAULT_EXCHANGE,
    deadLetterExchange = DEFAULT_DL_EXCHANGE,
    logger = sharedLogger.child({ module: 'messaging', service: serviceName })
  } = {}) {
    if (!url) {
      throw new Error('RABBITMQ_URL is required to initialize messaging context');
    }

    this.url = url;
    this.serviceName = serviceName;
    this.exchange = exchange;
    this.deadLetterExchange = deadLetterExchange;
    this.logger = logger;
    this.connection = null;
    this.publishChannel = null;
    this.consumerChannels = new Set();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    this.connection = await getOrCreateConnection(this.url, this.logger, this.serviceName);
    this.publishChannel = await this.connection.createConfirmChannel();
    await this.publishChannel.assertExchange(this.exchange, 'topic', { durable: true });
    await this.publishChannel.assertExchange(this.deadLetterExchange, 'topic', { durable: true });
    this.initialized = true;
    this.logger.info('Messaging context initialized', { exchange: this.exchange });
  }

  async publish(routingKey, payload, options = {}) {
    if (!this.initialized) {
      await this.init();
    }

    const messageId = options.messageId || uuidv4();
    const timestamp = Date.now();

    let payloadToSend;
    try {
      payloadToSend = applyValidator(options.validate, payload, { phase: 'publish', routingKey }, this.logger);
    } catch (error) {
      publishErrorCounter.labels(this.serviceName, routingKey).inc();
      this.logger.error('Payload validation failed', {
        routingKey,
        error: error.message
      });
      throw error;
    }

    const messageBuffer = Buffer.from(JSON.stringify(payloadToSend));
    const publishOptions = {
      contentType: 'application/json',
      persistent: options.persistent !== false,
      messageId,
      timestamp,
      headers: {
        'x-service-name': this.serviceName,
        ...options.headers
      },
      type: options.type,
      appId: this.serviceName
    };

    return new Promise((resolve, reject) => {
      this.publishChannel.publish(this.exchange, routingKey, messageBuffer, publishOptions, (err, ok) => {
        if (err) {
          this.logger.error('Failed to publish message', { routingKey, error: err.message });
          publishErrorCounter.labels(this.serviceName, routingKey).inc();
          return reject(err);
        }

        publishedCounter.labels(this.serviceName, routingKey).inc();
        this.logger.debug('Published message', {
          routingKey,
          messageId,
          timestamp
        });
        resolve(ok);
      });
    });
  }

  async subscribe({
    queue,
    bindingKeys = [],
    onMessage,
    options = {}
  }) {
    if (!queue) {
      throw new Error('Queue name is required for subscription');
    }
    if (typeof onMessage !== 'function') {
      throw new Error('onMessage handler must be a function');
    }
    if (!this.initialized) {
      await this.init();
    }

    const channel = await this.connection.createChannel();
    this.consumerChannels.add(channel);

    const queueOptions = {
      durable: options.durable !== false,
      arguments: {
        'x-dead-letter-exchange': this.deadLetterExchange,
        'x-dead-letter-routing-key': `${queue}.dead-letter`,
        ...options.arguments
      }
    };

    await channel.assertExchange(this.exchange, 'topic', { durable: true });
    await channel.assertQueue(queue, queueOptions);

    const bindings = Array.isArray(bindingKeys) && bindingKeys.length > 0 ? bindingKeys : ['#'];
    await Promise.all(bindings.map((pattern) => channel.bindQueue(queue, this.exchange, pattern)));

    if (options.prefetch !== null) {
      await channel.prefetch(options.prefetch || DEFAULT_PREFETCH);
    }

    this.logger.info('Subscribed to queue', {
      queue,
      bindings,
      prefetch: options.prefetch || DEFAULT_PREFETCH
    });

    channel.consume(
      queue,
      async (message) => {
        if (!message) {
          return;
        }

        const envelope = {
          messageId: message.properties.messageId,
          routingKey: message.fields.routingKey,
          timestamp: message.properties.timestamp,
          headers: message.properties.headers || {},
          deliveryTag: message.fields.deliveryTag,
          redelivered: message.fields.redelivered
        };

        let content = parseMessage(message);
        try {
          content = applyValidator(
            options.validate,
            content,
            { phase: 'consume', queue, envelope },
            this.logger
          );
        } catch (validationError) {
          rejectedCounter.labels(this.serviceName, envelope.routingKey).inc();
          this.logger.error('Message validation failed', {
            queue,
            routingKey: envelope.routingKey,
            messageId: envelope.messageId,
            error: validationError.message
          });
          channel.nack(message, false, false);
          return;
        }

        const startedAt = process.hrtime.bigint();

        try {
          await onMessage(content, envelope, message);
          channel.ack(message);

          const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
          const elapsedSeconds = elapsedMs / 1000;
          consumedCounter.labels(this.serviceName, envelope.routingKey).inc();
          processingHistogram.labels(this.serviceName, queue, envelope.routingKey).observe(elapsedSeconds);
          this.logger.debug('Message processed', {
            queue,
            routingKey: envelope.routingKey,
            messageId: envelope.messageId,
            duration_ms: elapsedMs
          });
        } catch (error) {
          rejectedCounter.labels(this.serviceName, envelope.routingKey).inc();
          this.logger.error('Message handler failed', {
            queue,
            routingKey: envelope.routingKey,
            messageId: envelope.messageId,
            error: error.message
          });

          if (options.requeueOnError) {
            channel.nack(message, false, true);
          } else {
            channel.nack(message, false, false);
          }
        }
      },
      {
        noAck: false
      }
    );

    return {
      close: async () => {
        try {
          await channel.close();
          this.consumerChannels.delete(channel);
        } catch (error) {
          this.logger.error('Failed to close consumer channel', { error: error.message, queue });
        }
      }
    };
  }

  async assertWorkQueue(queueName, options = {}) {
    if (!this.initialized) {
      await this.init();
    }

    const channel = await this.connection.createChannel();
    this.consumerChannels.add(channel);

    await channel.assertQueue(queueName, {
      durable: options.durable !== false,
      arguments: {
        'x-dead-letter-exchange': this.deadLetterExchange,
        'x-dead-letter-routing-key': `${queueName}.dead-letter`,
        ...options.arguments
      }
    });

    this.logger.info('Declared work queue', { queue: queueName });

    return {
      channel,
      close: async () => {
        try {
          await channel.close();
          this.consumerChannels.delete(channel);
        } catch (error) {
          this.logger.error('Failed to close work queue channel', { error: error.message, queue: queueName });
        }
      }
    };
  }

  async close() {
    for (const channel of this.consumerChannels) {
      try {
        await channel.close();
      } catch (error) {
        this.logger.error('Error closing consumer channel', { error: error.message });
      }
    }
    this.consumerChannels.clear();

    if (this.publishChannel) {
      try {
        await this.publishChannel.close();
      } catch (error) {
        this.logger.error('Error closing publish channel', { error: error.message });
      }
      this.publishChannel = null;
    }

    this.initialized = false;
  }
}

function parseMessage(message) {
  if (!message.content) {
    return null;
  }

  if (message.properties?.contentType === 'application/json' || message.properties?.contentType === 'text/json') {
    try {
      return JSON.parse(message.content.toString('utf8'));
    } catch (error) {
      return {
        parsingError: error.message,
        raw: message.content.toString('utf8')
      };
    }
  }

  return message.content;
}

function applyValidator(validator, payload, meta, logger) {
  if (!validator) {
    return payload;
  }

  let result;
  try {
    result = validator(payload, meta);
  } catch (error) {
    const validationError = error instanceof Error ? error : new Error(String(error));
    validationError.name = validationError.name || 'MessageValidationError';
    throw validationError;
  }

  if (result === undefined) {
    return payload;
  }

  if (result === false || result === null) {
    const validationError = new Error('Message validation rejected payload');
    validationError.name = 'MessageValidationError';
    logger?.warn?.('Validator returned falsy result', meta);
    throw validationError;
  }

  if (typeof result === 'object' && result !== null && 'value' in result && 'error' in result) {
    if (result.error) {
      const validationError = result.error instanceof Error ? result.error : new Error(result.error.message || 'Message validation failed');
      validationError.name = validationError.name || 'MessageValidationError';
      throw validationError;
    }
    return result.value;
  }

  return result;
}

async function createContext(options) {
  const context = new MessagingContext(options);
  await context.init();
  return context;
}

module.exports = {
  createContext,
  DEFAULT_EXCHANGE,
  DEFAULT_DL_EXCHANGE
};
