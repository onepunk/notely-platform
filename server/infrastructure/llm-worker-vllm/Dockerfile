# vLLM Docker container for GPU-accelerated LLM inference
# Based on official vLLM OpenAI-compatible API server

FROM vllm/vllm-openai:latest

# Set working directory
WORKDIR /app

# Install additional Python packages if needed
RUN pip install huggingface_hub

# Create directories
RUN mkdir -p /app/models /app/cache

# GPU Configuration
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility
ENV CUDA_VISIBLE_DEVICES=0
ENV CUDA_MODULE_LOADING=LAZY

# vLLM Configuration with defaults
ENV VLLM_USE_MODELSCOPE=False
ENV VLLM_LOGGING_LEVEL=INFO
ENV VLLM_HOST=0.0.0.0
ENV VLLM_PORT=8000
ENV VLLM_MODEL_NAME=meta-llama-Meta-Llama-3.1-8B-Instruct
ENV VLLM_GPU_MEMORY_UTILIZATION=0.8
ENV VLLM_MAX_MODEL_LEN=4096
ENV VLLM_TRUST_REMOTE_CODE=true

# Expose the vLLM API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Use proper Python module entrypoint and environment variables
ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server"]
CMD ["--host", "0.0.0.0", \
     "--port", "8000", \
     "--model", "/app/models/meta-llama-Meta-Llama-3.1-8B-Instruct", \
     "--trust-remote-code", \
     "--gpu-memory-utilization", "0.8", \
     "--max-model-len", "4096"]