# LLM Meeting Intelligence Service

# ---------- Builder stage: compile source-only deps (e.g., llama-cpp-python) ----------
FROM python:3.11-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    CC=gcc \
    CXX=g++

# Build toolchain for native extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    python3-dev \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for better caching
COPY requirements-api.txt ./

# Prebuild wheels for all Python deps. This ensures C/C++ compilers are only in the builder image.
# If a wheel exists on PyPI (e.g., torch, transformers), pip will download it.
# If not (e.g., llama-cpp-python on some platforms), pip will build it here with cmake/g++.
RUN python -m pip install --upgrade pip wheel && \
    pip wheel --no-deps --wheel-dir /wheels -r requirements-api.txt --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org && \
    pip wheel --wheel-dir /wheels -r requirements-api.txt --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org


# ---------- Runtime stage: minimal image with only runtime deps ----------
FROM python:3.11-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1

# Runtime system libs only; no compilers. Keep curl for healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    libstdc++6 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy wheels from builder and install them offline for deterministic builds
COPY --from=builder /wheels /wheels
COPY requirements-api.txt ./
RUN python -m pip install --upgrade pip && \
    pip install --no-index --find-links=/wheels -r requirements-api.txt --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org

# Copy application code
COPY . .

# Create directories
RUN mkdir -p /app/models /app/cache

# Expose port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

# Run the application
CMD ["python", "app.py"]
