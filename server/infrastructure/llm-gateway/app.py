#!/usr/bin/env python3
"""
LLM Meeting Intelligence Service - API-only version that forwards requests to the GPU worker
"""

import os
import json
import logging
import time
import math
from typing import Dict, Optional, Any
from urllib.parse import quote as urlquote

from flask import Flask, request, jsonify
from flask_cors import CORS
import redis
from celery import Celery
import requests
import psutil
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import nltk

# Download required NLTK data
try:
    nltk.download('punkt', quiet=True)
    nltk.download('stopwords', quiet=True)
except:
    pass

# Import standardized logging
import sys
sys.path.append('/app/shared/logging/python')
from standard_logger import create_standard_logger, add_tracing_to_logger, create_flask_tracing_middleware

# Configure standardized logging
logger = create_standard_logger('llm')
add_tracing_to_logger(logger)

# Import chunking pipeline (after logger is configured)
try:
    from chunking_pipeline import create_pipeline
    PIPELINE_AVAILABLE = True
    logger.info("Chunking pipeline imported successfully")
except ImportError as e:
    PIPELINE_AVAILABLE = False
    logger.warning(f"Chunking pipeline not available: {e}")

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Add request tracing middleware
create_flask_tracing_middleware(app, logger)

# Configuration
def build_redis_url():
    """Build Redis URL with properly encoded password."""
    # Check for explicit REDIS_URL first (for backwards compatibility)
    explicit_url = os.getenv('REDIS_URL')
    if explicit_url:
        return explicit_url

    # Build URL from separate components with URL encoding
    host = os.getenv('REDIS_HOST', 'localhost')
    port = os.getenv('REDIS_PORT', '6379')
    password = os.getenv('REDIS_PASSWORD', '')

    if password:
        # URL-encode password to handle special characters like /, +, =
        encoded_password = urlquote(password, safe='')
        return f'redis://:{encoded_password}@{host}:{port}/0'
    return f'redis://{host}:{port}/0'

REDIS_URL = build_redis_url()
MAX_INPUT_LENGTH = int(os.getenv('MAX_INPUT_LENGTH', '4000'))
MAX_OUTPUT_LENGTH = int(os.getenv('MAX_OUTPUT_LENGTH', '1000'))
CACHE_RESULTS = os.getenv('CACHE_RESULTS', 'true').lower() == 'true'
# API-only service configuration - no GPU or local artifact management
LLM_ROLE = 'api'  # Fixed to API-only role
LLM_BACKEND_URL = os.getenv('LLM_BACKEND_URL', os.getenv('LLM_BACKEND_URL', 'http://llm-worker:8000'))
SYNC_ANALYZE_TIMEOUT = int(os.getenv('SYNC_ANALYZE_TIMEOUT', '120'))  # seconds
ANALYSIS_BACKEND = os.getenv('ANALYSIS_BACKEND', 'llamacpp')

# Prompt configuration — prompts are now supplied per-request from the summaries
# service (sourced from PostgreSQL).  File-based prompt loading has been removed.
LLM_CONTEXT_LIMIT = int(os.getenv('LLM_CONTEXT_LIMIT', os.getenv('LLM_CONTEXT_LIMIT', '4096')))
AVG_CHARS_PER_TOKEN = float(os.getenv('AVG_CHARS_PER_TOKEN', '4'))

# API service constants - always CPU-only
DEVICE = 'cpu'

logger.info("LLM API service initialized - forwarding requests to remote backend")

def publish_status(role: Optional[str] = None):
    """Publish current status to Redis for external visibility (e.g., Admin Portal)."""
    r = redis_client
    if not r:
        return
    try:
        status_key = f"llm:{(role or LLM_ROLE)}:status"

        payload = {
            'service': 'llm',
            'role': role or LLM_ROLE,
            'device': DEVICE,
            'timestamp': time.time(),
            'backend': {
                'type': ANALYSIS_BACKEND,
                'url': LLM_BACKEND_URL
            }
        }
        r.setex(status_key, 300, json.dumps(payload))
        logger.debug(f"Published status to {status_key}: device={DEVICE}, backend={ANALYSIS_BACKEND}")
    except Exception as e:
        logger.warning(f"Failed to publish status to Redis: {e}")

def get_device_info():
    """Get device information - API service only uses CPU"""
    return {
        'device': DEVICE,
        'cpu_count': psutil.cpu_count(),
        'memory_gb': round(psutil.virtual_memory().total / (1024**3), 1),
        'backend': 'api-only'
    }

# Prometheus metrics
request_count = Counter('llm_requests_total', 'Total requests')
request_duration = Histogram('llm_request_duration_seconds', 'Request duration')
active_requests = Gauge('llm_active_requests', 'Active requests')

# Initialize Redis
try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
    logger.info("Redis connection established", {
        'redis_url': REDIS_URL.split('@')[1] if '@' in REDIS_URL else REDIS_URL,  # Don't log password
        'action': 'redis_connect_success'
    })
    # Publish initial status snapshot
    publish_status()
except Exception as e:
    logger.warning(f"Redis connection failed: {e}", {
        'error_type': type(e).__name__,
        'action': 'redis_connect_error'
    })
    redis_client = None

# Initialize Celery
celery_app = Celery('llm', broker=REDIS_URL)
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    # Enable result backend so /jobs/<id> can fetch statuses
    result_backend=REDIS_URL,
    result_expires=3600,
)

pipeline = None  # Chunking pipeline instance


def build_prompt(text: str, analysis_type: str = 'full',
                 system_prompt: str = '',
                 output_structure: dict = None) -> str:
    """Build a prompt string from the caller-supplied prompt templates.

    All prompts originate from the database via the summaries service.
    There are no file-based or hardcoded fallback prompts.
    """
    if output_structure:
        # Map analysis types to template keys in the output_structure
        # The DB stores templates under 'chunk_extraction' (JSON output) and
        # 'refinement' (narrative output).  'structured_v1' and 'full' both
        # need the JSON-producing template so the client receives structured data.
        _TEMPLATE_KEY_MAP = {
            'structured_v1': 'chunk_extraction',
            'full': 'chunk_extraction',
        }
        template_key = _TEMPLATE_KEY_MAP.get(analysis_type, analysis_type)
        template = (output_structure.get(template_key)
                    or output_structure.get(analysis_type)
                    or output_structure.get('default'))
        if template:
            try:
                return template.format(
                    base_prompt=system_prompt,
                    text=text
                )
            except KeyError as exc:
                logger.warning(
                    "Missing placeholder %s in prompt template for analysis_type=%s",
                    exc,
                    analysis_type
                )

    # No matching template — combine system prompt + transcript directly
    if system_prompt:
        return f"{system_prompt}\n\nTranscript:\n\n{text}\n"

    raise ValueError(f"No prompt template available for analysis_type={analysis_type}")


def estimate_token_count(prompt_text: str) -> int:
    """Estimate token usage for prompt text using a rough char/token ratio."""
    if AVG_CHARS_PER_TOKEN <= 0:
        return max(1, len(prompt_text))
    return max(1, math.ceil(len(prompt_text) / AVG_CHARS_PER_TOKEN))


def analyze_text_core(text: str, analysis_type: str = 'full',
                      system_prompt: str = '',
                      output_structure: str = None) -> Dict[str, Any]:
    """Core text analysis logic shared between sync and async endpoints.

    Prompts are required and supplied by the caller (summaries service, backed by DB).
    """

    # Check if text is too long and needs chunking pipeline
    text_length = len(text)
    logger.info(f"Text length: {text_length} characters, MAX_INPUT_LENGTH: {MAX_INPUT_LENGTH}")

    def process_with_pipeline(trigger_reason: str) -> Dict[str, Any]:
        logger.info(
            "Routing analysis through chunking pipeline",
            {
                'analysis_type': analysis_type,
                'reason': trigger_reason,
                'text_length': text_length
            }
        )
        try:
            context = {
                'analysis_type': analysis_type,
                'trigger': trigger_reason,
                'system_prompt': system_prompt,
                'output_structure': output_structure,
            }
            result = pipeline.process(text, context)
            logger.info("Chunking pipeline analysis completed successfully")
            return result
        except Exception as e:
            logger.error(f"Chunking pipeline failed: {type(e).__name__}: {e}")
            return {'error': f'Pipeline processing failed: {str(e)}'}

    # structured_v1 always uses the chunking pipeline (chunk_extraction → refinement)
    # to match the AI Desktop's two-stage summary quality
    if analysis_type == 'structured_v1' and pipeline:
        logger.info("structured_v1 requested — routing through chunking pipeline")
        return process_with_pipeline('structured_v1')

    if text_length > MAX_INPUT_LENGTH and pipeline:
        # Use chunking pipeline for long texts
        logger.info(f"Text exceeds MAX_INPUT_LENGTH ({text_length} > {MAX_INPUT_LENGTH}), using chunking pipeline")
        return process_with_pipeline('length_limit')
    else:
        # Forward to LLM backend for short texts
        try:
            logger.info(f"Forwarding analysis to LLM backend")

            # Parse output_structure JSON for the direct path
            parsed_structure = None
            if output_structure:
                try:
                    parsed_structure = (
                        json.loads(output_structure)
                        if isinstance(output_structure, str)
                        else output_structure
                    )
                except (json.JSONDecodeError, TypeError):
                    logger.warning("Failed to parse output_structure JSON")

            # Create the analysis prompt based on the type
            prompt = build_prompt(text, analysis_type,
                                  system_prompt=system_prompt,
                                  output_structure=parsed_structure)

            estimated_input_tokens = estimate_token_count(prompt)
            available_context = max(0, LLM_CONTEXT_LIMIT - MAX_OUTPUT_LENGTH)

            if estimated_input_tokens > available_context:
                logger.info(
                    "Estimated prompt tokens exceed backend context window",
                    {
                        'analysis_type': analysis_type,
                        'estimated_tokens': estimated_input_tokens,
                        'available_context': available_context,
                        'context_limit': LLM_CONTEXT_LIMIT
                    }
                )
                if pipeline:
                    return process_with_pipeline('context_limit')
                warning_message = (
                    'Input is too long for the configured inference backend context window '
                    f'(estimated {estimated_input_tokens} tokens, limit {available_context}). '
                    'Try summarizing the transcript before retrying.'
                )
                logger.warning(warning_message)
                return {
                    'error': 'Input exceeds backend context limits',
                    'details': warning_message
                }

            # Send to LLM backend using OpenAI-compatible format
            llm_request = {
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": MAX_OUTPUT_LENGTH,
                "temperature": 0.7,
                "stop": ["<|im_end|>"]
            }

            response = requests.post(
                f"{LLM_BACKEND_URL}/v1/chat/completions",
                json=llm_request,
                timeout=SYNC_ANALYZE_TIMEOUT,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()

            llm_response = response.json()

            # Extract the analysis from LLM response
            if 'choices' in llm_response and len(llm_response['choices']) > 0:
                analysis_text = llm_response['choices'][0]['message']['content']
                result = parse_analysis_response(analysis_text, analysis_type)
            else:
                logger.error("Invalid response format from LLM backend")
                return {'error': 'Invalid response from processing backend'}

            logger.info("LLM backend analysis completed successfully")
            return result

        except requests.exceptions.RequestException as e:
            logger.error(f"LLM backend request failed: {type(e).__name__}: {e}")
            return {'error': f'Processing backend unavailable: {str(e)}'}
        except Exception as e:
            logger.error(f"LLM backend forwarding failed: {type(e).__name__}: {e}")
            return {'error': f'Processing failed: {str(e)}'}

# API-only service - all processing is forwarded to the LLM backend
logger.info("API-only service - forwarding requests to LLM backend")

def initialize_api_only_pipeline():
    """Initialize chunking pipeline for API-only mode"""
    global pipeline

    logger.info(f"Starting API-only pipeline initialization...")
    logger.info(f"PIPELINE_AVAILABLE={PIPELINE_AVAILABLE}")
    logger.info(f"LLM_BACKEND_URL={LLM_BACKEND_URL}")
    logger.info(f"redis_client={redis_client}")

    if PIPELINE_AVAILABLE:
        try:
            logger.info("Initializing chunking pipeline in API-only mode with LLM backend")
            # Pass None as local_instance since processing happens over HTTP via the GPU worker
            pipeline = create_pipeline(
                None,
                ANALYSIS_BACKEND,
                redis_client=redis_client,
                vllm_url=LLM_BACKEND_URL
            )
            logger.info("API-only chunking pipeline initialized successfully")
            logger.info(f"Pipeline object: {pipeline}")
        except Exception as e:
            logger.error(f"Failed to initialize API-only chunking pipeline: {e}")
            import traceback
            logger.error(f"API-only pipeline init traceback: {traceback.format_exc()}")
            pipeline = None
    else:
        logger.warning(f"Pipeline not available in API-only mode - PIPELINE_AVAILABLE is False")
        pipeline = None

    logger.info(f"Pipeline initialization complete. pipeline={pipeline is not None}")
    logger.info("Prompts are supplied per-request from the summaries service (DB-backed)")
def parse_analysis_response(analysis_text: str, analysis_type: str) -> dict:
    """Parse the analysis response from LLM backend"""
    try:
        # Try to extract JSON from the response
        import re

        # Look for JSON block in the response
        json_match = re.search(r'\{.*\}', analysis_text, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group())
            # Wrap under 'result' for compatibility with API consumers
            result = {
                "result": parsed,
            }
        else:
            # Fallback: create a simple response structure
            result = {
                "result": analysis_text,
                "result_is_text": True,
            }

        # Add metadata
        result.update({
            "analysis_type": analysis_type,
            "backend": "llamacpp",
            "timestamp": time.time()
        })

        return result

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse JSON response: {e}")
        # Return raw text in a structured format
        return {
            "result": analysis_text,
            "result_is_text": True,
            "analysis_type": analysis_type,
            "backend": "llamacpp",
            "timestamp": time.time(),
            "parse_error": str(e),
            "raw_response": True
        }
    except Exception as e:
        logger.error(f"Error parsing analysis response: {e}")
        return {
            "error": f"Failed to parse analysis: {str(e)}",
            "analysis_type": analysis_type,
            "backend": "llamacpp",
            "timestamp": time.time()
        }

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    device_info = get_device_info()

    # API service is healthy if Redis is connected and can reach the GPU worker
    is_healthy = True
    # API-only health check - verify Redis and backend connectivity
    if redis_client:
        try:
            is_healthy = redis_client.ping()
        except:
            is_healthy = False
    else:
        is_healthy = False

    health_status = {
        'status': 'healthy' if is_healthy else 'degraded',
        'service': 'llm',
        'role': 'api',  # Fixed to API role only
        'timestamp': time.time(),
        'analysis_backend': ANALYSIS_BACKEND,  # All processing forwarded to LLM backend
        'device': device_info,
        'redis': {
            'connected': redis_client.ping() if redis_client else False
        },
        'system': {
            'cpu_count': psutil.cpu_count(),
            'memory_percent': psutil.virtual_memory().percent,
            'disk_percent': psutil.disk_usage('/').percent,
            'total_memory_gb': psutil.virtual_memory().total / (1024**3)
        },
        'config': {
            'device': DEVICE,
            'notes': 'API service forwards requests to remote inference backend'
        }
    }

    return jsonify(health_status), 200 if is_healthy else 503

def apply_config_locally(data: Dict[str, Any]) -> Dict[str, Any]:
    """Apply configuration changes in the current process (API-only service)."""
    ignored_fields = sorted(set(data.keys()))

    response_data: Dict[str, Any] = {
        'success': True,
        'message': 'API-only service - configuration changes forwarded to LLM backend',
        'changes_applied': []
    }

    # Ignore any settings the API service cannot apply locally
    if ignored_fields:
        response_data.setdefault('warnings', []).append(
            f"Configuration fields ignored by API service: {', '.join(ignored_fields)}"
        )

    # Add current configuration to response
    response_data['current_config'] = {
        'device': DEVICE,
        'backend': 'api-only',
        'llm_backend_url': LLM_BACKEND_URL
    }

    # Publish updated status
    publish_status()

    return response_data


@app.route('/config', methods=['POST'])
def configure():
    """Configure LLM settings endpoint"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No configuration data provided'}), 400

        response_data = apply_config_locally(data)

        # If running in API role, also dispatch config to the worker via Celery
        if LLM_ROLE != 'worker':
            try:
                apply_config_task.delay(data)
                response_data['worker_dispatch'] = 'queued'
            except Exception as e:
                logger.warning(f"Failed to dispatch config to worker: {e}")
                response_data.setdefault('warnings', []).append('Worker dispatch failed')

        status_code = 200 if response_data.get('success', False) else 500
        return jsonify(response_data), status_code

    except Exception as e:
        logger.error(f"Configuration endpoint error: {e}")
        return jsonify({
            'success': False,
            'error': f'Configuration failed: {str(e)}'
        }), 500

@app.route('/analyze', methods=['POST'])
def analyze():
    """Synchronous analysis endpoint"""
    request_count.inc()
    active_requests.inc()
    
    try:
        data = request.json
        text = data.get('text', '')
        analysis_type = data.get('analysis_type') or data.get('type', 'full')
        system_prompt = data.get('system_prompt', None)
        output_structure = data.get('output_structure', None)

        if not text:
            return jsonify({'error': 'No text provided'}), 400

        if not system_prompt:
            return jsonify({'error': 'system_prompt is required (configure an active prompt template in Admin → Prompts)'}), 400

        # Use core analysis logic
        result = analyze_text_core(text, analysis_type,
                                   system_prompt=system_prompt,
                                   output_structure=output_structure)

        # Check for errors and return appropriate HTTP status
        if 'error' in result:
            if 'unavailable' in result['error'].lower():
                return jsonify(result), 503
            elif 'invalid response' in result['error'].lower():
                return jsonify(result), 502
            else:
                return jsonify(result), 500
        
        return jsonify(result)
        
    finally:
        active_requests.dec()

@app.route('/analyze/async', methods=['POST'])
def analyze_async():
    """Asynchronous analysis endpoint"""
    data = request.json
    
    # Create job
    job = celery_app.send_task('llama.analyze', args=[
        data.get('text', ''),
        data.get('type', 'full')
    ])
    
    return jsonify({
        'job_id': job.id,
        'status': 'processing'
    })

@celery_app.task(name='llama.analyze')
def analyze_task(text: str, analysis_type: str):
    """Celery task for async analysis"""
    return analyze_text_core(text, analysis_type)


@celery_app.task(name='llm.apply_config')
def apply_config_task(data: Dict[str, Any]):
    """Celery task to apply configuration (runs in worker)."""
    try:
        result = apply_config_locally(data)
        return result
    except Exception as e:
        logger.error(f"Worker apply_config error: {e}")
        return {'success': False, 'error': str(e)}

@app.route('/jobs/<job_id>', methods=['GET'])
def get_job_status(job_id):
    """Get job status"""
    job = celery_app.AsyncResult(job_id)
    
    if job.state == 'PENDING':
        return jsonify({'status': 'pending'})
    elif job.state == 'SUCCESS':
        return jsonify({
            'status': 'completed',
            'result': job.result
        })
    elif job.state == 'FAILURE':
        return jsonify({
            'status': 'failed',
            'error': str(job.info)
        })
    else:
        return jsonify({'status': job.state})

@app.route('/metrics', methods=['GET'])
def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest()

if __name__ == '__main__':
    # API-only service startup
    logger.info("Initializing LLM API service...")
    logger.info(f"API service ready - forwarding requests to LLM backend at {LLM_BACKEND_URL}")

    # Initialize the chunking pipeline for API-only mode
    initialize_api_only_pipeline()

    # Run Flask app
    app.run(host='0.0.0.0', port=8002, debug=False)
