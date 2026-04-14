# Infrastructure Services

This directory contains stateless infrastructure services that provide compute and processing capabilities but do not own database schemas or implement business domain logic.

## Directory Structure

```
infrastructure/
├── llm-shared/              # Shared LLM resources
│   ├── models/             # Pre-downloaded LLM models (~30GB)
│   │   └── meta-llama-Meta-Llama-3.1-8B-Instruct/
│   ├── prompt/             # Meeting analysis prompt templates
│   │   ├── prompt.txt
│   │   └── prompt_structure.json
│   └── README.md
├── llm-worker-vllm/        # vLLM GPU inference worker
│   ├── Dockerfile
│   ├── download_model.py
│   ├── start_vllm.sh
│   ├── test_vllm.py
│   └── README.md
└── llm-gateway/            # LLM API orchestration layer
    ├── app.py
    ├── chunking_pipeline.py
    ├── Dockerfile
    ├── requirements-api.txt
    ├── README.md
    └── shared/
```

## Services

### llm-gateway

**Purpose**: API orchestration layer for LLM operations, providing business logic, caching, and queue management.

**Type**: Stateless API service

**Technology**: Python Flask + Celery + Redis

**Port**: 8002

**Dependencies**:
- Redis (caching and task queue)
- LLM Worker vLLM (inference backend)

**Endpoints**:
- `POST /analyze` - Synchronous meeting analysis
- `POST /analyze/async` - Asynchronous analysis (returns job ID)
- `GET /analyze/status/{job_id}` - Check async job status
- `POST /configure` - Update configuration
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

**Key Features**:
- Redis caching (1-hour TTL) to reduce GPU load
- Celery task queue for async processing
- Custom prompt engineering for meeting analysis
- Text chunking pipeline for long documents
- Structured JSON output parsing

**Volumes**:
- `./infrastructure/llm-shared/models:/app/models:ro` - Model files (for reference)
- `./infrastructure/llm-shared/prompt:/app/prompt:ro` - Custom prompt templates
- `llm-cache-v3:/app/cache` - Cache directory

**Resource Limits**:
- Memory: 4GB limit, 1GB reserved

**Testing**:
```bash
# Health check
curl http://localhost:8002/health

# Analyze meeting
curl -X POST http://localhost:8002/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "Meeting transcript...", "type": "full"}'
```

**Notes**:
- CPU-only service (no GPU required)
- Acts as intermediary between domain services and vLLM worker
- Provides business-focused API vs. raw OpenAI-compatible API

---

### llm-worker-vllm

**Purpose**: OpenAI-compatible LLM inference API using vLLM for high-performance GPU-accelerated model serving.

**Type**: Stateless inference worker

**Technology**: vLLM (Python-based GPU inference engine)

**Port**: 8100 (mapped from internal 8000)

**Dependencies**:
- **NVIDIA GPU Required** (nvidia-docker runtime)
- No database required
- No Redis required

**Endpoints**:
- `GET /health` - Health check
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - OpenAI-compatible chat completions

**Configuration**:
- `VLLM_HOST` - Server host (default: 0.0.0.0)
- `VLLM_PORT` - Server port (default: 8000)
- `VLLM_MODEL_NAME` - Model identifier
- `VLLM_GPU_MEMORY_UTILIZATION` - GPU memory fraction (default: 0.8)
- `VLLM_MAX_MODEL_LEN` - Max sequence length (default: 4096)
- `HUGGING_FACE_HUB_TOKEN` - HuggingFace token for model downloads

**Volumes**:
- `./infrastructure/llm-shared/models:/app/models:ro` - Bind mount to pre-downloaded models (read-only)
- `llm-cache-v3:/app/cache` - Model cache directory

**GPU Configuration**:
- Uses all available GPUs (`count: all`)
- 80% GPU memory utilization
- Requires nvidia-docker runtime on host
- Same configuration as V2 for proven stability

**Testing**:
```bash
# Test health endpoint
curl http://localhost:8100/health

# List models
curl http://localhost:8100/v1/models

# Test completion
python infrastructure/llm-worker-vllm/test_vllm.py http://localhost:8100
```

**Notes**:
- This is a stateless service - it can be scaled horizontally
- Model files are cached in a Docker volume to avoid re-downloading
- The service follows OpenAI API compatibility for easy integration
- No database or business logic dependencies make it portable across environments

## Architecture Pattern

Infrastructure services differ from domain microservices in `services/`:

**Domain Services** (`services/`):
- Own database schemas
- Implement business logic
- Domain-specific APIs
- Service-to-service communication

**Infrastructure Services** (`infrastructure/`):
- Stateless compute/processing
- No database ownership
- Generic/reusable capabilities
- Can be shared across domains
