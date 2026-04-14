# LLM Gateway - API Orchestration Layer

API orchestration service that provides business logic, caching, and queue management for LLM inference operations.

## Overview

The LLM Gateway sits between domain services and the vLLM worker, providing:
- Business-focused `/analyze` endpoints
- Redis caching layer
- Celery async task queuing
- Prompt engineering and text chunking
- Meeting-specific analysis workflows

**Container**: `notely-llm-gateway-v3`
**Port**: 8002 (external)
**Role**: API orchestration and business logic
**Dependencies**: Redis, vLLM Worker

## Architecture

```
Domain Services (Summaries, Transcripts)
    ↓
LLM Gateway (8002)
    - Business logic endpoints
    - Redis caching (1-hour TTL)
    - Celery queue management
    - Prompt engineering
    - Text chunking for long documents
    ↓
LLM Worker vLLM (8100)
    - Pure GPU inference
    - OpenAI-compatible API
```

## Features

- ✅ **Business Logic Endpoints**: `/analyze`, `/analyze/async`, `/configure`
- ✅ **Caching Layer**: Redis-backed response caching (reduces GPU load)
- ✅ **Queue Management**: Celery tasks for async processing
- ✅ **Prompt Engineering**: Custom prompts from `llm-shared/prompt/`
- ✅ **Text Chunking**: Pipeline for processing long documents
- ✅ **Metrics**: Prometheus metrics for monitoring
- ✅ **Structured Output**: JSON parsing of LLM responses

## Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

# Backend Configuration
LLM_ROLE=api                                    # Fixed to API-only role
VLLM_BACKEND_URL=http://llm-worker-vllm:8000   # vLLM inference backend

# Analysis Configuration
MAX_INPUT_LENGTH=15000                          # Max input characters
MAX_OUTPUT_LENGTH=1000                          # Max output tokens
CACHE_RESULTS=true                              # Enable Redis caching
SYNC_ANALYZE_TIMEOUT=120                        # Sync request timeout (seconds)

# Prompt Configuration
PROMPT_DIR=/app/prompt                          # Prompt templates directory
```

### Docker Compose

```yaml
llm-gateway:
  image: notely/llm-gateway:v3
  container_name: notely-llm-gateway-v3
  ports:
    - "8002:8002"
  depends_on:
    - redis
    - llm-worker-vllm
```

## API Endpoints

### POST /analyze

Synchronous meeting analysis endpoint.

**Request**:
```json
{
  "text": "Meeting transcript text...",
  "type": "full"
}
```

**Response**:
```json
{
  "summary": "Meeting summary...",
  "action_items": ["Action 1", "Action 2"],
  "key_points": ["Point 1", "Point 2"],
  "decisions": ["Decision 1"],
  "questions": ["Question 1"]
}
```

**Caching**: Results cached in Redis for 1 hour
**Timeout**: 120 seconds (configurable via `SYNC_ANALYZE_TIMEOUT`)

### POST /analyze/async

Asynchronous analysis endpoint (returns job ID).

**Request**:
```json
{
  "text": "Very long transcript...",
  "type": "full"
}
```

**Response**:
```json
{
  "job_id": "celery-task-id",
  "status": "processing"
}
```

### GET /analyze/status/{job_id}

Check async job status.

**Response**:
```json
{
  "status": "completed",
  "result": { "summary": "...", "action_items": [...] }
}
```

### POST /configure

Update analysis configuration dynamically.

### GET /health

Health check endpoint.

**Response**:
```json
{
  "status": "healthy",
  "service": "llm",
  "role": "api",
  "backend": {
    "type": "vllm",
    "url": "http://llm-worker-vllm:8000"
  }
}
```

### GET /metrics

Prometheus metrics endpoint.

## Usage

### Start the Service

```bash
cd ./server

# Build and start
docker compose up -d --build llm-gateway

# Check logs
docker compose logs -f llm-gateway
```

### Test Endpoints

```bash
# Health check
curl http://localhost:8002/health

# Analyze meeting
curl -X POST http://localhost:8002/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Meeting started at 9am. We discussed Q4 planning. Action: John will prepare the budget by Friday.",
    "type": "full"
  }'

# Async analysis
curl -X POST http://localhost:8002/analyze/async \
  -H "Content-Type: application/json" \
  -d '{"text": "Long transcript...", "type": "full"}'
```

## Prompt Engineering

### Prompt Files

Located in `infrastructure/llm-shared/prompt/`:
- `prompt.txt` - Base meeting analysis prompt
- `prompt_structure.json` - Structured output format

### Custom Prompts

The gateway loads prompts from the mounted directory:
```yaml
volumes:
  - ./infrastructure/llm-shared/prompt:/app/prompt:ro
```

Edit prompt files and restart the service to apply changes.

## Text Chunking Pipeline

For long documents exceeding context limits:

1. **Chunk Strategy**: Splits text into semantic chunks
2. **Analysis**: Each chunk analyzed independently
3. **Synthesis**: Results merged into cohesive output
4. **Context Limit**: Configurable via `VLLM_CONTEXT_LIMIT` (default: 4096 tokens)

## Caching Strategy

### Redis Cache

- **Key Format**: `llm:{analysis_type}:{hash(text)}`
- **TTL**: 3600 seconds (1 hour)
- **Benefit**: Reduces GPU load for repeated queries
- **Disable**: Set `CACHE_RESULTS=false`

### Cache Invalidation

Cache automatically expires after 1 hour. To manually clear:
```bash
docker compose exec redis redis-cli --pass ${REDIS_PASSWORD} FLUSHDB
```

## Queue Management

### Celery Configuration

- **Broker**: Redis
- **Tasks**: `llama.analyze`, `llm.apply_config`
- **Workers**: Runs within the llm-gateway container

### Async Processing Flow

1. Request received at `/analyze/async`
2. Task queued in Redis via Celery
3. Worker picks up task and processes
4. Result stored with job ID
5. Client polls `/analyze/status/{job_id}`

## Monitoring

### Prometheus Metrics

Available at `http://localhost:8002/metrics`:
- `llm_requests_total` - Total requests
- `llm_requests_active` - Active requests
- `llm_request_duration_seconds` - Request latency histogram

### Logs

Structured JSON logs with request IDs for tracing:
```bash
docker compose logs -f llm-gateway
```

## Dependencies

### Required Services

- **Redis** (`notely-redis-v3`): Caching and queue broker
- **LLM Worker vLLM** (`notely-llm-worker-vllm-v3`): GPU inference backend

### Python Packages

See `requirements-api.txt`:
- Flask (web framework)
- Celery (task queue)
- Redis (caching)
- NLTK (text processing)
- Prometheus client (metrics)

## Resource Limits

```yaml
deploy:
  resources:
    limits:
      memory: 4G      # Maximum memory
    reservations:
      memory: 1G      # Reserved memory
```

The gateway is CPU-only (no GPU required).

## Troubleshooting

### Gateway Can't Connect to vLLM

**Check vLLM worker is running**:
```bash
curl http://localhost:8100/health
```

**Check environment variable**:
```bash
docker compose exec llm-gateway env | grep VLLM_BACKEND_URL
```

### Redis Connection Failed

**Check Redis is healthy**:
```bash
docker compose ps redis
docker compose logs redis
```

**Test connection**:
```bash
docker compose exec llm-gateway python -c "import redis; r = redis.from_url('redis://:password@redis:6379/0'); print(r.ping())"
```

### Celery Tasks Not Processing

**Check Celery worker status**:
```bash
docker compose logs llm-gateway | grep celery
```

**Inspect queue**:
```bash
docker compose exec redis redis-cli --pass ${REDIS_PASSWORD} LLEN celery
```

### Analysis Timeout

Increase timeout in environment:
```yaml
environment:
  SYNC_ANALYZE_TIMEOUT: 240  # 4 minutes
```

## Integration with Domain Services

Domain services (Summaries, Transcripts, etc.) should call the gateway:

```javascript
// Example: Summaries service
const response = await fetch('http://llm-gateway:8002/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: transcriptText,
    type: 'full'
  })
});

const analysis = await response.json();
// { summary, action_items, key_points, decisions, questions }
```

## Architecture Notes

### Why Separate from vLLM Worker?

- **Business Logic Separation**: vLLM is pure inference, gateway has business rules
- **Caching**: Avoids redundant GPU calls
- **Queue Management**: Handles async processing
- **Prompt Engineering**: Centralizes meeting-specific prompts
- **Scalability**: Can scale workers independently

### Why in `infrastructure/`?

- **Shared Resource**: Used by multiple domain services (Summaries, Transcripts)
- **Stateless Logic**: No database ownership
- **Infrastructure Concern**: Not domain-specific business logic

## References

- [Celery Documentation](https://docs.celeryproject.org/)
- [Flask Documentation](https://flask.palletsprojects.com/)
- [Redis Documentation](https://redis.io/docs/)
- [vLLM OpenAI API](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html)
