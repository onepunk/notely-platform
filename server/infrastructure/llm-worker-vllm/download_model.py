#!/usr/bin/env python3
"""
Download Meta-Llama-3.1-8B-Instruct model from HuggingFace for vLLM
"""

import os
import sys
from huggingface_hub import snapshot_download, login

def download_llama_model():
    """Download Meta-Llama-3.1-8B-Instruct model"""
    model_name = "meta-llama/Meta-Llama-3.1-8B-Instruct"
    local_dir = "/app/models/meta-llama--Meta-Llama-3.1-8B-Instruct"

    # Get HuggingFace token from environment
    hf_token = os.getenv("HUGGING_FACE_HUB_TOKEN")
    if not hf_token:
        print("Error: HUGGING_FACE_HUB_TOKEN environment variable not set")
        print("Please set your HuggingFace token to download the model")
        sys.exit(1)

    print(f"Logging into HuggingFace with token...")
    try:
        login(token=hf_token)
        print("Successfully logged into HuggingFace")
    except Exception as e:
        print(f"Error logging into HuggingFace: {e}")
        sys.exit(1)

    print(f"Downloading {model_name} to {local_dir}")

    try:
        # Download the model to a specific local directory
        snapshot_download(
            repo_id=model_name,
            local_dir=local_dir,
            local_files_only=False,
            resume_download=True,
            token=hf_token
        )
        print(f"Successfully downloaded {model_name}")
        print(f"Model saved to: {local_dir}")

        # List downloaded files
        if os.path.exists(local_dir):
            files = os.listdir(local_dir)
            print(f"Downloaded files: {files}")

    except Exception as e:
        print(f"Error downloading model: {e}")
        sys.exit(1)

if __name__ == "__main__":
    download_llama_model()