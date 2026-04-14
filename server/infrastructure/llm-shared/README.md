# LLM Shared Resources

This directory contains shared LLM resources used by infrastructure services.

## Structure

```
llm-shared/
└── models/                                  # Pre-downloaded LLM models
    └── meta-llama-Meta-Llama-3.1-8B-Instruct/  # Llama 3.1 8B model
        ├── model-00001-of-00004.safetensors     # Model weights (4.7GB)
        ├── model-00002-of-00004.safetensors     # Model weights (4.7GB)
        ├── model-00003-of-00004.safetensors     # Model weights (4.6GB)
        ├── model-00004-of-00004.safetensors     # Model weights (1.1GB)
        ├── config.json                           # Model configuration
        ├── tokenizer.json                        # Tokenizer data (8.7MB)
        ├── tokenizer_config.json                 # Tokenizer configuration
        └── ...                                   # Other model files
```

## Models Directory

**Location**: `infrastructure/llm-shared/models/`
**Total Size**: ~30GB (for Llama 3.1 8B)
**Usage**: Read-only bind mount into vLLM worker container

### Mount Configuration

In `docker-compose.yml`:
```yaml
llm-worker-vllm:
  volumes:
    - ./infrastructure/llm-shared/models:/app/models:ro
```

This mounts the models directory as **read-only** (`ro`) to prevent accidental modification.

## Adding New Models

To add additional models:

1. **Download the model** using HuggingFace:
   ```bash
   cd infrastructure/llm-shared/models
   python -c "
   from huggingface_hub import snapshot_download
   snapshot_download(
       repo_id='meta-llama/Meta-Llama-3.1-8B-Instruct',
       local_dir='./meta-llama-Meta-Llama-3.1-8B-Instruct',
       token='your-hf-token'
   )
   "
   ```

2. **Update docker-compose.yml** command to point to new model:
   ```yaml
   command: [
     "--model", "/app/models/your-new-model-name"
   ]
   ```

3. **Restart the service**:
   ```bash
   docker compose restart llm-worker-vllm
   ```

## Model Source

**Original Location**: Copied from V2 at `/notely-platform/server/llm-shared/models/`

The models were downloaded from HuggingFace and require:
- HuggingFace account with Meta Llama 3.1 access approval
- Valid `HUGGING_FACE_HUB_TOKEN` in secrets

## Storage Considerations

- **Size**: Each model can be 10GB-50GB depending on parameters
- **Location**: Stored directly on host filesystem (not in Docker volumes)
- **Backup**: Consider backing up models separately from code
- **Sharing**: V3 can share models with V2 if both point to same directory (not recommended)

## Architecture Notes

### Why in `infrastructure/llm-shared/`?

- **Shared Resource**: Models can be used by multiple infrastructure services
- **Large Files**: Models are too large for Docker volumes or container layers
- **Performance**: Bind mounts provide direct filesystem access
- **Separation**: Models are infrastructure assets, not application code

### Bind Mount vs Docker Volume

We use **bind mount** (not volume) because:
- ✅ Direct access to large files without copying
- ✅ Can share models across multiple services
- ✅ Easier to manage and backup on host filesystem
- ✅ Faster startup (no volume copy overhead)

## References

- [Meta Llama 3.1 on HuggingFace](https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct)
- [vLLM Model Loading](https://docs.vllm.ai/en/latest/models/supported_models.html)
- [HuggingFace Hub Documentation](https://huggingface.co/docs/hub/index)
