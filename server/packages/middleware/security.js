const logger = require('../logger');

/**
 * Security Middleware Collection
 *
 * Provides security enhancements:
 * - Custom security headers
 * - Input sanitization
 * - Suspicious activity detection
 * - AJAX request detection
 */

class SecurityMiddleware {
  /**
   * Add security headers to response
   * (In addition to Helmet headers)
   *
   * @returns {Function} Express middleware
   */
  static addSecurityHeaders() {
    return (req, res, next) => {
      // Additional headers beyond Helmet
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Prevent caching of sensitive endpoints
      if (req.path.includes('/api/auth') || req.path.includes('/api/users')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }

      next();
    };
  }

  /**
   * Sanitize request input
   * Removes dangerous characters and patterns
   *
   * @returns {Function} Express middleware
   */
  static sanitizeInput() {
    return (req, res, next) => {
      try {
        /**
         * Sanitize a single value
         * @private
         */
        const sanitizeValue = (value) => {
          if (typeof value !== 'string') return value;

          return value
            // Remove null bytes
            .replace(/\0/g, '')
            // Remove control characters except newlines and tabs
            .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            // Trim whitespace
            .trim();
        };

        /**
         * Recursively sanitize object
         * @private
         */
        const sanitizeObject = (obj) => {
          if (!obj || typeof obj !== 'object') return obj;

          if (Array.isArray(obj)) {
            return obj.map(sanitizeObject);
          }

          const sanitized = {};
          for (const [key, value] of Object.entries(obj)) {
            const cleanKey = sanitizeValue(key);
            sanitized[cleanKey] = typeof value === 'object'
              ? sanitizeObject(value)
              : sanitizeValue(value);
          }
          return sanitized;
        };

        // Sanitize request body
        if (req.body) {
          req.body = sanitizeObject(req.body);
        }

        // Sanitize query parameters
        if (req.query) {
          req.query = sanitizeObject(req.query);
        }

        next();
      } catch (error) {
        logger.error('Input sanitization error', {
          error: error.message,
          request_id: req.requestId
        });

        res.status(500).json({
          success: false,
          error: 'Request processing failed',
          request_id: req.requestId
        });
      }
    };
  }

  /**
   * Detect AJAX requests
   * Adds req.isAjax boolean for conditional handling
   *
   * @returns {Function} Express middleware
   */
  static detectAjaxRequest() {
    return (req, res, next) => {
      req.isAjax = (req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
      next();
    };
  }

  /**
   * Detect suspicious activity patterns
   * Logs suspicious requests for monitoring
   *
   * @returns {Function} Express middleware
   */
  static detectSuspiciousActivity() {
    // Paths excluded from suspicious activity detection (internal health checks)
    const excludedPaths = ['/health', '/metrics', '/ready', '/live'];

    return (req, res, next) => {
      // Skip detection for internal health check endpoints
      if (excludedPaths.includes(req.path)) {
        return next();
      }

      const suspicious = [];

      // Check for suspicious user agents
      const userAgent = req.get('user-agent') || '';
      const suspiciousAgents = ['sqlmap', 'nikto', 'nmap', 'masscan', 'metasploit'];
      if (suspiciousAgents.some(agent => userAgent.toLowerCase().includes(agent)) || userAgent.length === 0) {
        suspicious.push('suspicious_user_agent');
      }

      // Check for suspicious proxy chains
      const xForwardedFor = req.headers['x-forwarded-for'];
      if (xForwardedFor && xForwardedFor.split(',').length > 5) {
        suspicious.push('suspicious_proxy_chain');
      }

      // Check for SQL injection patterns in query
      if (req.query) {
        const queryString = JSON.stringify(req.query).toLowerCase();
        const sqlPatterns = ['select', 'union', 'insert', 'update', 'delete', 'drop', 'exec', '--', '/*', '*/'];
        if (sqlPatterns.some(pattern => queryString.includes(pattern))) {
          suspicious.push('suspicious_query_params');
        }
      }

      // Check for path traversal attempts
      if (req.path.includes('../') || req.path.includes('..\\')) {
        suspicious.push('path_traversal_attempt');
      }

      if (suspicious.length > 0) {
        logger.warn('Suspicious activity detected', {
          request_id: req.requestId,
          ip: req.ip,
          path: req.path,
          method: req.method,
          user_agent: userAgent,
          suspicious_patterns: suspicious
        });

        req.suspiciousActivity = suspicious;
      }

      next();
    };
  }

  /**
   * Create security middleware stack
   *
   * @param {Object} options - Configuration options
   * @returns {Array} Array of middleware functions
   */
  static createSecurityStack(options = {}) {
    const stack = [];

    // Always add security headers
    stack.push(this.addSecurityHeaders());

    // Add AJAX detection if requested
    if (options.detectAjax !== false) {
      stack.push(this.detectAjaxRequest());
    }

    // Add input sanitization if requested
    if (options.sanitizeInput !== false) {
      stack.push(this.sanitizeInput());
    }

    // Add suspicious activity detection if requested
    if (options.detectSuspicious !== false) {
      stack.push(this.detectSuspiciousActivity());
    }

    return stack;
  }
}

module.exports = SecurityMiddleware;
