# Email Service

Email microservice for the Notely Platform V3. Handles email sending, template management, and email event processing.

## Overview

- **Port**: 3214
- **Container Name**: `notely-email-v3`
- **Service Name**: `email`

## Features

- Email sending via SMTP (Nodemailer)
- HTML email templates with variable substitution
- RabbitMQ event consumption for automated emails
- Prometheus metrics for email delivery tracking
- Health check endpoint
- Integration with support service for ticket notifications

## API Endpoints

### POST /api/email/send
Send a custom email (admin only).

**Request Body:**
```json
{
  "to": "user@example.com",
  "subject": "Email Subject",
  "html": "<h1>HTML content</h1>",
  "text": "Plain text content (optional)"
}
```

### POST /api/email/send-template
Send an email using a template (admin only).

**Request Body:**
```json
{
  "to": "user@example.com",
  "subject": "Email Subject",
  "template": "beta-confirmation",
  "templateData": {
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

### GET /api/email/templates
List available email templates (admin only).

### GET /health
Health check endpoint.

### GET /metrics
Prometheus metrics endpoint.

## Environment Variables

### Required
- `SMTP_HOST` - SMTP server hostname (default: smtp.gmail.com)
- `SMTP_PORT` - SMTP server port (default: 587)
- `SMTP_USER` - SMTP authentication username
- `SMTP_PASS` - SMTP authentication password

### Optional
- `EMAIL_PORT` - Service port (default: 3214)
- `SERVICE_NAME` - Service name for logging (default: email)
- `SMTP_SECURE` - Use TLS (default: false)
- `FROM_EMAIL` - Sender email address (default: noreply@example.com)
- `FROM_NAME` - Sender name (default: Notely)
- `RABBITMQ_URL` - RabbitMQ connection URL (default: amqp://localhost)
- `SUPPORT_ADMIN_EMAIL` - Admin email for support notifications
- `ADMIN_CONFIG_SERVICE_URL` - Admin config service URL (default: http://admin-config:3206)

## Email Templates

Templates are located in `src/templates/`. All templates use the base template (`base.html`) for consistent styling.

### Available Templates
- `beta-confirmation.html` - Beta program signup confirmation
- `beta-admin-notification.html` - Admin notification for new beta signups

### Template Variables

Templates use `{{variableName}}` syntax for variable substitution.

**Base Template Variables:**
- `{{title}}` - Email title
- `{{content}}` - Email content (rendered template)
- `{{footerText}}` - Footer text

## Event Processing

The email service consumes events from RabbitMQ and automatically sends emails for:

- Support ticket creation
- Support ticket replies (user and admin)
- Direct email send requests

### Supported Events
- `support.ticket.created` - Sends confirmation email to user
- `support.ticket.reply.user` - Notifies admin of user reply
- `support.ticket.reply.admin` - Notifies user of admin response
- `email.send` - Direct email send request

## Metrics

The service exports Prometheus metrics at `/metrics`:

- `email_sent_total` - Total emails successfully sent (labels: template, recipient_type)
- `email_failed_total` - Total failed email sends (labels: template, error_type)
- `email_queue_size` - Current queue size
- `email_template_usage_total` - Template usage count (labels: template_name)
- `http_request_duration_seconds` - HTTP request duration histogram

## Development

### Local Development
```bash
cd ./server/services/email
npm install
npm run dev
```

### Building Docker Image
```bash
cd ./server
docker compose build email
```

### Running in Docker
```bash
cd ./server
docker compose up -d email
```

### Viewing Logs
```bash
docker compose logs -f email
```

## Dependencies

- `@notely/shared` - Shared infrastructure (logging, middleware, database)
- `express` - Web framework
- `nodemailer` - Email sending
- `amqplib` - RabbitMQ client
- `prom-client` - Prometheus metrics
- `uuid` - UUID generation
- `dotenv` - Environment variable management

## Architecture

The email service follows the standard microservice pattern:

```
index.js                    # Main entry point, Express setup
├── src/
│   ├── routes/
│   │   └── email.js       # HTTP API routes
│   ├── services/
│   │   ├── emailService.js    # Core email sending logic
│   │   ├── eventPublisher.js  # RabbitMQ event publisher
│   │   └── eventConsumer.js   # RabbitMQ event consumer
│   ├── templates/         # Email templates
│   │   ├── base.html      # Base template (layout)
│   │   ├── beta-confirmation.html
│   │   └── beta-admin-notification.html
│   └── utils/
│       └── metrics.js     # Prometheus metrics
```

## Testing

### Manual Testing
```bash
# Send test email
curl -X POST http://localhost:3214/api/email/send \
  -H "Content-Type: application/json" \
  -H "x-auth-subject: admin-user-id" \
  -H "x-auth-role: admin" \
  -d '{
    "to": "test@example.com",
    "subject": "Test Email",
    "html": "<h1>Test</h1>"
  }'

# List templates
curl http://localhost:3214/api/email/templates \
  -H "x-auth-subject: admin-user-id" \
  -H "x-auth-role: admin"
```

### Health Check
```bash
curl http://localhost:3214/health
```

## Production Considerations

1. **SMTP Configuration**: Configure production SMTP credentials in `config/secrets.env`
2. **Email Templates**: Review and customize templates for production branding
3. **Rate Limiting**: Consider implementing rate limiting for email sending
4. **Queue Management**: Monitor RabbitMQ queue size and processing times
5. **Monitoring**: Set up alerts for email delivery failures
6. **SPF/DKIM**: Configure DNS records for email authentication
7. **Bounce Handling**: Implement bounce and complaint handling
