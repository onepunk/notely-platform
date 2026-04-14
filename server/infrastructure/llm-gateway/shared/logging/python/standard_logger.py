#!/usr/bin/env python3
"""
Standardized logging configuration for Python services in the Notely platform.
Provides consistent JSON logging with trace/request ID support.
"""

import os
import sys
import logging
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from flask import Flask, request, g, has_request_context


class JSONFormatter(logging.Formatter):
    """Custom JSON formatter that matches Node.js Winston format"""

    def __init__(self, service_name: str):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        # Base log entry
        log_entry = {
            'timestamp': datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            'level': record.levelname.lower(),
            'service': self.service_name,
            'message': record.getMessage(),
        }

        # Add trace/request IDs if available from Flask context
        if has_request_context():
            if hasattr(g, 'trace_id') and g.trace_id:
                log_entry['trace_id'] = g.trace_id
            if hasattr(g, 'request_id') and g.request_id:
                log_entry['request_id'] = g.request_id
            if hasattr(g, 'user_id') and g.user_id:
                log_entry['user_id'] = g.user_id

        # Add extra data if present
        if hasattr(record, 'extra_data') and record.extra_data:
            log_entry['metadata'] = record.extra_data

        # Add exception info if present
        if record.exc_info:
            log_entry['error'] = {
                'message': str(record.exc_info[1]) if record.exc_info[1] else 'Unknown error',
                'type': record.exc_info[0].__name__ if record.exc_info[0] else 'Unknown',
            }
            if record.exc_text:
                log_entry['stack'] = record.exc_text

        # Add any additional attributes from the log record
        extras = {}
        for key, value in record.__dict__.items():
            if key not in ['name', 'msg', 'args', 'levelname', 'levelno', 'pathname',
                          'filename', 'module', 'lineno', 'funcName', 'created',
                          'msecs', 'relativeCreated', 'thread', 'threadName',
                          'processName', 'process', 'getMessage', 'exc_info',
                          'exc_text', 'stack_info', 'extra_data']:
                if not key.startswith('_'):
                    extras[key] = value

        if extras:
            if 'metadata' in log_entry:
                log_entry['metadata'].update(extras)
            else:
                log_entry['metadata'] = extras

        return json.dumps(log_entry, default=str)


class PrettyFormatter(logging.Formatter):
    """Human-readable formatter for development"""

    def __init__(self, service_name: str):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        # Base format
        timestamp = datetime.fromtimestamp(record.created).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        level = record.levelname
        message = record.getMessage()

        log_message = f"{timestamp} [{self.service_name}] {level}: {message}"

        # Add trace/request IDs if available
        if has_request_context():
            ids = []
            if hasattr(g, 'trace_id') and g.trace_id:
                ids.append(f"trace:{g.trace_id[:8]}")
            if hasattr(g, 'request_id') and g.request_id:
                ids.append(f"req:{g.request_id[:8]}")
            if ids:
                log_message += f" [{','.join(ids)}]"
            if hasattr(g, 'user_id') and g.user_id:
                log_message += f" [user:{g.user_id}]"

        # Add extra data if present
        if hasattr(record, 'extra_data') and record.extra_data:
            log_message += f" {json.dumps(record.extra_data, default=str)}"

        # Add exception info if present
        if record.exc_info:
            log_message += f"\n  Error: {record.exc_info[1]}"
            if record.exc_text:
                log_message += f"\n{record.exc_text}"

        return log_message


def create_standard_logger(service_name: str, log_level: Optional[str] = None) -> logging.Logger:
    """
    Create a standardized logger for Python services

    Args:
        service_name: Name of the service (e.g., 'whisper', 'llm')
        log_level: Optional log level override

    Returns:
        Configured logger instance
    """
    # Determine log level and format
    log_level = log_level or os.getenv('LOG_LEVEL', 'INFO').upper()
    log_format = os.getenv('LOG_FORMAT', 'json' if os.getenv('NODE_ENV') == 'production' else 'pretty')

    # Create logger
    logger = logging.getLogger(service_name)
    logger.setLevel(getattr(logging, log_level))

    # Remove existing handlers to avoid duplicates
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)

    # Set formatter based on environment
    if log_format == 'json':
        formatter = JSONFormatter(service_name)
    else:
        formatter = PrettyFormatter(service_name)

    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # Don't propagate to root logger to avoid duplicates
    logger.propagate = False

    return logger


def add_tracing_to_logger(logger: logging.Logger):
    """
    Add convenience methods to logger for structured logging with metadata

    Args:
        logger: Logger instance to enhance
    """
    original_methods = {}

    # Store original methods
    for level in ['debug', 'info', 'warning', 'error', 'critical']:
        original_methods[level] = getattr(logger, level)

    def make_enhanced_method(level_name: str, original_method):
        def enhanced_method(msg: str, extra_data: Optional[Dict[str, Any]] = None, **kwargs):
            # Create a new LogRecord with extra data
            if extra_data:
                # Use extra parameter to pass additional data
                return original_method(msg, extra={'extra_data': extra_data}, **kwargs)
            else:
                return original_method(msg, **kwargs)
        return enhanced_method

    # Replace methods with enhanced versions
    for level_name, original_method in original_methods.items():
        setattr(logger, level_name, make_enhanced_method(level_name, original_method))

    return logger


def create_flask_tracing_middleware(app: Flask, logger: logging.Logger):
    """
    Add request tracing middleware to Flask app

    Args:
        app: Flask application instance
        logger: Logger instance for logging requests
    """

    @app.before_request
    def before_request():
        # Extract or generate trace ID
        g.trace_id = request.headers.get('x-trace-id')
        if not g.trace_id:
            g.trace_id = str(uuid.uuid4())

        # Always generate new request ID
        g.request_id = str(uuid.uuid4())

        # Extract user ID if available (from auth headers or JWT)
        g.user_id = request.headers.get('x-user-id')  # Or extract from JWT

        # Log the incoming request
        logger.info(f"{request.method} {request.path}", {
            'http_method': request.method,
            'http_path': request.path,
            'http_remote_addr': request.remote_addr,
            'http_user_agent': request.headers.get('User-Agent'),
            'source': 'request_start'
        })

    @app.after_request
    def after_request(response):
        # Log the response
        logger.info(f"{request.method} {request.path} - {response.status_code}", {
            'http_method': request.method,
            'http_path': request.path,
            'http_status_code': response.status_code,
            'source': 'request_end'
        })

        # Add tracing headers to response
        if hasattr(g, 'trace_id'):
            response.headers['x-trace-id'] = g.trace_id
        if hasattr(g, 'request_id'):
            response.headers['x-request-id'] = g.request_id

        return response

    @app.errorhandler(Exception)
    def handle_exception(error):
        # Log the error with tracing context
        logger.error(f"Unhandled exception: {str(error)}", {
            'error_type': type(error).__name__,
            'error_message': str(error),
            'http_method': request.method if has_request_context() else None,
            'http_path': request.path if has_request_context() else None,
        }, exc_info=True)

        # Return error response
        response_data = {
            'success': False,
            'error': 'Internal server error'
        }

        # Add trace IDs to error response
        if hasattr(g, 'trace_id'):
            response_data['trace_id'] = g.trace_id
        if hasattr(g, 'request_id'):
            response_data['request_id'] = g.request_id

        # Don't expose error details in production
        if os.getenv('NODE_ENV') != 'production':
            response_data['error'] = str(error)

        return response_data, 500


# Example usage:
if __name__ == "__main__":
    # Create logger
    logger = create_standard_logger('example-service')
    add_tracing_to_logger(logger)

    # Test logging
    logger.info("Service starting", {'version': '1.0.0', 'environment': 'development'})
    logger.warning("This is a warning", {'component': 'auth'})
    logger.error("This is an error", {'error_code': 'AUTH_001', 'details': 'Authentication failed'})