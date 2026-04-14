# LLM Worker - vLLM

OpenAI-compatible LLM inference service using vLLM for high-performance GPU-accelerated model serving.

## Overview

This service provides a stateless LLM inference API compatible with OpenAI's API format. It uses vLLM as the inference engine for efficient GPU-accelerated model serving.

**Container**: `notely-llm-worker-vllm-v3`
**Port**: `8100` (external) → `8000` (internal)
**Network**: `notely-v3-network`
**Status**: ✅ Implemented (V3)
**Requirements**: ✅ **NVIDIA GPU Required** (nvidia-docker runtime)

## Features

- ✅ OpenAI-compatible API endpoints
- ✅ vLLM inference engine with GPU acceleration
- ✅ Health check endpoint
- ✅ Model caching via Docker volumes
- ✅ Automatic GPU memory management (80% utilization)
- ✅ No database dependencies (stateless)

## Configuration

### Environment Variables

```bash
# HuggingFace Configuration
HUGGING_FACE_HUB_TOKEN=<your-token>                  # Required for model downloads

# NVIDIA GPU Configuration (automatic)
NVIDIA_VISIBLE_DEVICES=all                           # Use all available GPUs
NVIDIA_DRIVER_CAPABILITIES=compute,utility            # Required capabilities
```

Add `HUGGING_FACE_HUB_TOKEN` to `server/config/secrets.env`.

### vLLM Command-line Arguments

The service is configured via command-line args (not environment variables):
- `--host 0.0.0.0` - Bind to all interfaces
- `--port 8000` - Internal port
- `--model /app/models/meta-llama-Meta-Llama-3.1-8B-Instruct` - Model path
- `--trust-remote-code` - Allow remote code execution
- `--gpu-memory-utilization 0.8` - Use 80% of GPU memory
- `--max-model-len 4096` - Maximum sequence length

### Docker Compose

The service is defined in `server/docker-compose.yml`:

```yaml
llm-worker-vllm:
  image: vllm/vllm-openai:v0.6.5
  container_name: notely-llm-worker-vllm-v3
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
  ports:
    - "8100:8000"
  volumes:
    - llm-models-v3:/app/models
    - llm-cache-v3:/app/cache
```

**Note**: Uses official vLLM image `vllm/vllm-openai:v0.6.5` (same as V2) with GPU support enabled.

## Usage

### Prerequisites

**NVIDIA GPU and nvidia-docker runtime must be installed on the host.**

Verify GPU access:
```bash
# Check NVIDIA driver
nvidia-smi

# Test Docker GPU access
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

### Start the Service

```bash
cd ./server

# Start the service (uses pre-built vLLM image)
docker compose up -d llm-worker-vllm

# Check logs
docker compose logs -f llm-worker-vllm

# Verify GPU is detected
docker compose exec llm-worker-vllm nvidia-smi
```

### Model Storage

**Models are pre-downloaded** and stored in `infrastructure/llm-shared/models/`.

The models directory is bind-mounted (read-only) into the container:
```yaml
volumes:
  - ./infrastructure/llm-shared/models:/app/models:ro
```

**Model Location**: `./server/infrastructure/llm-shared/models/meta-llama-Meta-Llama-3.1-8B-Instruct/`
**Size**: ~30GB
**Source**: Copied from V2 (originally downloaded from HuggingFace)

No download step is needed - models are ready to use!

### API Endpoints

**Health Check**
```bash
curl http://localhost:8100/health
```

**List Models**
```bash
curl http://localhost:8100/v1/models
```

**Chat Completion**
```bash
curl http://localhost:8100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Meta-Llama-3.1-8B-Instruct",
    "messages": [
      {"role": "user", "content": "Hello! What is 2+2?"}
    ],
    "max_tokens": 50,
    "temperature": 0.7
  }'
```

### Testing

Run the included test script:

```bash
# Test against local service
python infrastructure/llm-worker-vllm/test_vllm.py http://localhost:8100

# Test against running container
docker compose exec llm-worker-vllm python /app/test_vllm.py http://localhost:8000
```

The test script validates:
- ✅ Health endpoint
- ✅ Models endpoint
- ✅ Completion endpoint with sample query

## GPU Configuration

### GPU Memory Management

The service is configured to use **80% of available GPU memory** (`--gpu-memory-utilization 0.8`). This leaves 20% for system overhead and other processes.

To adjust GPU memory usage, modify the command in `docker-compose.yml`:
```yaml
command: [
  "--gpu-memory-utilization", "0.9"  # Use 90% instead of 80%
]
```

### Multi-GPU Support

The configuration uses `count: all` to detect and use all available GPUs:
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all  # Uses all GPUs
          capabilities: [gpu]
```

To limit to specific GPUs, modify the docker-compose.yml or use `CUDA_VISIBLE_DEVICES`.

## Architecture Notes

### Why in `infrastructure/`?

This service belongs in `infrastructure/` (not `services/`) because:

- **Stateless**: No database schema ownership
- **Generic**: Provides compute capability, not business logic
- **Reusable**: Can be used by multiple domain services
- **No dependencies**: Doesn't interact with other microservices

### Service vs Infrastructure

| **Domain Services** (`services/`) | **Infrastructure** (`infrastructure/`) |
|-----------------------------------|----------------------------------------|
| Own database schemas              | Stateless (no database)                |
| Business domain logic             | Generic compute/processing             |
| Service-to-service communication  | Standalone capabilities                |
| Domain-specific APIs              | Standard/generic APIs                  |

## Troubleshooting

### Service won't start

**Check health:**
```bash
docker compose ps llm-worker-vllm
docker compose logs llm-worker-vllm
```

**Common issues:**
- Missing HuggingFace token → Add to `config/secrets.env`
- Model not downloaded → Run `download_model.py`
- Insufficient memory → Reduce `VLLM_GPU_MEMORY_UTILIZATION`
- Port conflict → Change `VLLM_PORT` in `.env`

### Model download fails

```bash
# Verify HuggingFace token is set
docker compose config | grep HUGGING_FACE_HUB_TOKEN

# Run download manually
docker compose run --rm llm-worker-vllm python /app/download_model.py
```

### GPU not detected

```bash
# Check nvidia-docker runtime
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# Verify deploy section is uncommented
docker compose config | grep -A 10 "llm-worker-vllm:" | grep -A 5 "deploy:"
```

## Files

- `Dockerfile` - vLLM container definition
- `start_vllm.sh` - Startup script (alternative to CMD)
- `download_model.py` - HuggingFace model downloader
- `test_vllm.py` - Service validation tests
- `models/` - Model storage directory (volume-mounted)

## Integration with V3 Services

Future domain services can consume this API:

```javascript
// Example: Summaries service calling LLM worker
const response = await fetch('http://llm-worker-vllm:8000/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    messages: [{ role: 'user', content: 'Summarize this meeting...' }],
    max_tokens: 500
  })
});
```

## References

- [vLLM Documentation](https://docs.vllm.ai/)
- [OpenAI API Compatibility](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html)
- [HuggingFace Models](https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct)
