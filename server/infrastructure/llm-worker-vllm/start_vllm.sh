#!/bin/bash
# Start vLLM server with Meta-Llama-3.1-8B-Instruct model

# Set default values
MODEL_NAME=${MODEL_NAME:-"meta-llama/Meta-Llama-3.1-8B-Instruct"}
HOST=${VLLM_HOST:-"0.0.0.0"}
PORT=${VLLM_PORT:-"8000"}
GPU_MEMORY_UTILIZATION=${VLLM_GPU_MEMORY_UTILIZATION:-"0.8"}
MAX_MODEL_LEN=${VLLM_MAX_MODEL_LEN:-"4096"}
TRUST_REMOTE_CODE=${VLLM_TRUST_REMOTE_CODE:-"true"}

echo "Starting vLLM server with model: $MODEL_NAME"
echo "Host: $HOST, Port: $PORT"
echo "GPU Memory Utilization: $GPU_MEMORY_UTILIZATION"
echo "Max Model Length: $MAX_MODEL_LEN"

# Start vLLM server
python -m vllm.entrypoints.openai.api_server \
    --host "$HOST" \
    --port "$PORT" \
    --model "$MODEL_NAME" \
    --trust-remote-code \
    --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
    --max-model-len "$MAX_MODEL_LEN"