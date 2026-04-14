# RabbitMQ Infrastructure Service

This directory tracks the RabbitMQ broker that powers asynchronous messaging for Notely Platform V3. The service follows the infrastructure guidelines from `server/docs/OVERVIEW.md`, meaning it remains stateless and reusable across domain microservices.

## Capabilities

- AMQP 0-9-1 broker for service-to-service messaging
- Default virtual host and user configured by shared environment variables
- Management UI exposed on the standard port for local inspection
- Persistent storage through a dedicated Docker volume (`rabbitmq-v3-data`)

## Local Development

The broker is declared in `server/docker-compose.yml` as `notely-rabbitmq-v3`. Environment variables are sourced from the generated `server/.env` file:

- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `RABBITMQ_VHOST`
- `RABBITMQ_ERLANG_COOKIE`

To launch the broker on its own:

```bash
docker compose up rabbitmq
```

Once running:

- AMQP endpoint: `amqp://$RABBITMQ_USER:$RABBITMQ_PASSWORD@localhost:${RABBITMQ_PORT}/${RABBITMQ_VHOST}`
- Management UI: http://localhost:${RABBITMQ_MANAGEMENT_PORT}

## Notes

- Keep credentials in `config/secrets.env`.
- Services should create their own exchanges/queues on startup to avoid shared state drift.
- For clustered or production deployments, extend this configuration with additional nodes and TLS certificates.
