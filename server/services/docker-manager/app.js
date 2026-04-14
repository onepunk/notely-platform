const express = require('express');
const helmet = require('helmet');
const axios = require('axios');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Import standardized logging
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

// Create standardized logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.LOG_FORMAT === 'pretty' ?
    winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.printf(info => `${info.timestamp} [docker-manager] ${info.level}: ${info.message}`)
    ) :
    winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(info => JSON.stringify({
        timestamp: info.timestamp,
        level: info.level,
        service: 'docker-manager',
        message: info.message,
        ...(info.metadata && {metadata: info.metadata})
      }))
    ),
  transports: [new winston.transports.Console()]
});

// Simple request tracing middleware
const requestTracingMiddleware = () => (req, res, next) => {
  req.traceId = req.headers['x-trace-id'] || uuidv4();
  req.requestId = uuidv4();
  res.setHeader('x-trace-id', req.traceId);
  res.setHeader('x-request-id', req.requestId);
  next();
};

// Container monitoring state
let containerStates = new Map();
let monitoringActive = false;

// Docker proxy configuration
const dockerHost = process.env.DOCKER_HOST || 'http://docker-proxy:2375';
const dockerAPI = axios.create({
  baseURL: dockerHost.replace('tcp://', 'http://'),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});
const app = express();
const PORT = process.env.PORT || 8005;

// Security middleware
app.use(helmet());
// CORS is handled by nginx at the edge layer - no application-level CORS needed
// Docker-manager is an internal service accessed only via the gateway

// Add request tracing middleware
app.use(requestTracingMiddleware());

// Body size limit to prevent DoS attacks - 100KB for container management commands
app.use(express.json({ limit: '100kb' }));

// Authentication middleware - trusts gateway auth headers
const authenticate = async (req, res, next) => {
  try {
    // Gateway already validates tokens and sets auth headers
    const authType = req.headers['x-auth-type'];
    const authEmail = req.headers['x-auth-email'];
    const authRole = req.headers['x-auth-role'];
    const authSubject = req.headers['x-auth-subject'];

    // If no auth headers, gateway didn't authenticate the request
    if (!authType || !authEmail || !authRole) {
      logger.warn('Request missing gateway auth headers');
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Check if user has admin privileges
    if (!['admin', 'super_admin'].includes(authRole)) {
      logger.warn('Non-admin user attempted access', { email: authEmail, role: authRole });
      return res.status(403).json({ success: false, error: 'Admin privileges required' });
    }

    // Set user context from gateway headers
    req.user = {
      id: authSubject,
      email: authEmail,
      role: authRole,
      is_admin: true
    };

    next();
  } catch (error) {
    logger.error('Authentication failed', { error: error.message });
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
};

// Single source of truth - services to display in Admin Portal (V3)
const REQUIRED_SERVICES = [
  // Core data stores
  'postgres-v3', 'redis-v3', 'rabbitmq-v3',
  // Core services
  'auth-v3', 'users-v3', 'license-v3', 'calendar-v3', 'email-v3',
  'summaries-v3', 'support-v3', 'sync-v3',
  // API layer
  'gateway-v3', 'ws-gateway-v3', 'portal-v3', 'portal-bff-v3', 'nginx-v3',
  // AI / ML
  'llm-gateway-v3', 'llm-worker-v3',
  // Admin
  'admin-config-v3', 'admin-database-v3', 'flyway-v3',
  // Infrastructure
  'docker-manager-v3', 'docker-proxy-v3', 'crowdsec-v3', 'clamav-v3',
  'watchtower-v3', 'logs-v3',
  // Observability
  'grafana-v3', 'prometheus-v3', 'loki-v3', 'promtail-v3',
  // Exporters / metrics
  'cadvisor-v3', 'node-exporter-v3', 'nginx-exporter-v3',
  'postgres-exporter-v3', 'redis-exporter-v3', 'dcgm-exporter-v3'
];

const getServiceDefinitions = () => {
  return REQUIRED_SERVICES;
};

// Helper function to map Docker state to our status format
const mapDockerStateToStatus = (state, statusText) => {
  let status = 'unknown';
  let health = 'unknown';
  
  if (state === 'running') {
    status = 'running';
    health = statusText.includes('healthy') ? 'healthy' : 
             statusText.includes('unhealthy') ? 'unhealthy' : 
             statusText.includes('starting') ? 'starting' : 'unknown';
  } else if (state === 'exited') {
    status = 'stopped';
  } else if (statusText.includes('Restarting')) {
    status = 'restarting';
  }
  
  return { status, health };
};

// Helper function to build service status object
const buildServiceStatus = (serviceName, containerInfo = null, fullContainerName = null) => {
  const containerName = fullContainerName || `notely-${serviceName}`;
  const info = serviceDisplayInfo[serviceName] || { 
    displayName: serviceName, 
    description: `${serviceName} service`, 
    icon: 'api' 
  };
  
  if (!containerInfo) {
    // Container doesn't exist
    return {
      name: containerName,
      containerName: containerName,
      displayName: info.displayName,
      status: 'not_found',
      health: 'unknown',
      description: info.description,
      icon: info.icon,
      canControl: false,
      ports: [],
      uptime: null
    };
  }
  
  const { state, statusText, ports } = containerInfo;
  const { status, health } = mapDockerStateToStatus(state, statusText);
  
  // Parse ports
  const portList = ports ? ports.split(', ').filter(p => p.trim()) : [];
  
  return {
    name: containerName,
    containerName: containerName,
    displayName: info.displayName,
    status: status,
    health: health,
    description: info.description,
    icon: info.icon,
    canControl: true,
    ports: portList,
    uptime: statusText
  };
};

// Service display information for Admin Portal
// Keys must match REQUIRED_SERVICES entries (v3 suffixed names)
const serviceDisplayInfo = {
  // Core data stores
  'postgres-v3': { displayName: 'Database', description: 'Primary database for user data and sessions', icon: 'storage' },
  'redis-v3': { displayName: 'Cache', description: 'In-memory cache and session storage', icon: 'redis' },
  'rabbitmq-v3': { displayName: 'Message Broker', description: 'Message queue for async service communication', icon: 'api' },
  // Core services
  'auth-v3': { displayName: 'Auth Service', description: 'Authentication and authorization service', icon: 'api' },
  'users-v3': { displayName: 'Users Service', description: 'User management and profiles', icon: 'api' },
  'license-v3': { displayName: 'License Service', description: 'License verification and management', icon: 'api' },
  'calendar-v3': { displayName: 'Calendar Service', description: 'Calendar integration and meeting management', icon: 'calendar' },
  'email-v3': { displayName: 'Email Service', description: 'Email notifications and communication service', icon: 'email' },
  'summaries-v3': { displayName: 'Summaries Service', description: 'Meeting summary generation service', icon: 'api' },
  'support-v3': { displayName: 'Support Service', description: 'Customer support and ticketing service', icon: 'api' },
  'sync-v3': { displayName: 'Sync Service', description: 'Data synchronization service', icon: 'api' },
  // API layer
  'gateway-v3': { displayName: 'API Gateway', description: 'Central API gateway for routing requests', icon: 'api' },
  'ws-gateway-v3': { displayName: 'WebSocket Gateway', description: 'Real-time WebSocket connection gateway', icon: 'api' },
  'portal-v3': { displayName: 'Portal', description: 'Web-based admin and user portal', icon: 'admin' },
  'portal-bff-v3': { displayName: 'Portal BFF', description: 'Backend-for-Frontend for portal service', icon: 'api' },
  'nginx-v3': { displayName: 'Proxy', description: 'Reverse proxy and load balancer', icon: 'api' },
  // AI / ML
  'llm-gateway-v3': { displayName: 'LLM Gateway', description: 'AI model routing and request gateway', icon: 'psychology' },
  'llm-worker-v3': { displayName: 'LLM Worker', description: 'LLM background processing worker', icon: 'psychology' },
  // Admin
  'admin-config-v3': { displayName: 'Admin Config', description: 'Admin configuration management service', icon: 'api' },
  'admin-database-v3': { displayName: 'Admin Database', description: 'Admin-specific database service', icon: 'storage' },
  'flyway-v3': { displayName: 'Database Migration', description: 'Flyway database migration tool', icon: 'storage' },
  // Infrastructure
  'docker-manager-v3': { displayName: 'Docker Manager', description: 'Container management service', icon: 'api' },
  'docker-proxy-v3': { displayName: 'Docker Proxy', description: 'Secure Docker socket proxy', icon: 'api' },
  'crowdsec-v3': { displayName: 'CrowdSec', description: 'Collaborative security and WAF engine', icon: 'api' },
  'clamav-v3': { displayName: 'ClamAV', description: 'Antivirus and malware scanning service', icon: 'api' },
  'watchtower-v3': { displayName: 'Watchtower', description: 'Automatic container image updates', icon: 'api' },
  'logs-v3': { displayName: 'Log Processing', description: 'Centralized log processing service', icon: 'api' },
  // Observability
  'grafana-v3': { displayName: 'Grafana', description: 'Observability dashboards and log explorer', icon: 'dashboard' },
  'prometheus-v3': { displayName: 'Prometheus', description: 'Metrics collection and alerting', icon: 'dashboard' },
  'loki-v3': { displayName: 'Loki', description: 'Centralized log storage and query engine', icon: 'storage' },
  'promtail-v3': { displayName: 'Promtail', description: 'Docker log shipper feeding Loki', icon: 'api' },
  // Exporters / metrics
  'cadvisor-v3': { displayName: 'cAdvisor', description: 'Container resource usage and performance metrics', icon: 'dashboard' },
  'node-exporter-v3': { displayName: 'Node Exporter', description: 'Host hardware and OS metrics exporter', icon: 'dashboard' },
  'nginx-exporter-v3': { displayName: 'Nginx Exporter', description: 'Nginx metrics exporter for Prometheus', icon: 'dashboard' },
  'postgres-exporter-v3': { displayName: 'Postgres Exporter', description: 'PostgreSQL metrics exporter for Prometheus', icon: 'dashboard' },
  'redis-exporter-v3': { displayName: 'Redis Exporter', description: 'Redis metrics exporter for Prometheus', icon: 'dashboard' },
  'dcgm-exporter-v3': { displayName: 'DCGM Exporter', description: 'NVIDIA GPU metrics exporter', icon: 'dashboard' }
};

// Get all container statuses via Docker API
const getAllContainerStatuses = async (services) => {
  try {
    // Query all notely containers via API
    const filters = JSON.stringify({ name: ['notely-'] });
    const response = await dockerAPI.get('/containers/json', {
      params: { all: true, filters }
    });
    
    // Parse the API response into a map
    const containerMap = new Map();
    response.data.forEach(container => {
      const name = container.Names[0].replace('/', ''); // Remove leading slash
      const state = container.State;
      const statusText = container.Status;
      const ports = container.Ports.map(p => 
        p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : `${p.PrivatePort}`
      ).join(', ');
      containerMap.set(name, { state, statusText, ports });
    });
    
    // Build status for each required service
    return services.map(serviceName => {
      const containerName = `notely-${serviceName}`;
      const containerInfo = containerMap.get(containerName);
      
      return buildServiceStatus(serviceName, containerInfo, containerName);
    });
  } catch (error) {
    logger.error('Failed to get container statuses', { error: error.message });
    
    // Fallback to individual queries if bulk query fails
    return await Promise.all(
      services.map(service => getContainerStatus(service))
    );
  }
};

// Container restart monitoring system
const monitorContainerRestarts = async () => {
  if (!monitoringActive) return;
  
  try {
    const services = await getServiceDefinitions();
    const currentStatuses = await getAllContainerStatuses(services);
    
    // Check for state changes that indicate restarts
    for (const status of currentStatuses) {
      const serviceName = status.name.replace('notely-', '');
      const previousState = containerStates.get(serviceName);
      
      if (previousState) {
        // Look for restart patterns
        const restartDetected = 
          // Container was running, now starting/restarting
          (previousState.status === 'running' && status.status === 'restarting') ||
          // Container was down, now running (automatic restart)
          (previousState.status !== 'running' && status.status === 'running' && 
           status.uptime && status.uptime.includes('second')) || // Recent restart
          // Container restart count increased (if available in status)
          (status.uptime && status.uptime.includes('Restart'));
          
        if (restartDetected) {
          logger.warn(`Automatic restart detected for ${serviceName}`, {
            previous: previousState,
            current: status
          });
        }
      }
      
      // Update the stored state
      containerStates.set(serviceName, {
        status: status.status,
        uptime: status.uptime,
        lastChecked: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error( 'Container monitoring error', { error: error.message });
  }
  
  // Schedule next check
  if (monitoringActive) {
    setTimeout(monitorContainerRestarts, 30000); // Check every 30 seconds
  }
};

// Start container monitoring
const startMonitoring = async () => {
  if (monitoringActive) return;
  
  logger.info( 'Starting container restart monitoring');
  monitoringActive = true;
  
  // Initialize container states
  try {
    const services = await getServiceDefinitions();
    const currentStatuses = await getAllContainerStatuses(services);
    
    for (const status of currentStatuses) {
      const serviceName = status.name.replace('notely-', '');
      containerStates.set(serviceName, {
        status: status.status,
        uptime: status.uptime,
        lastChecked: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error( 'Failed to initialize monitoring', { error: error.message });
  }
  
  // Start monitoring loop
  setTimeout(monitorContainerRestarts, 30000);
};

// Stop container monitoring
const stopMonitoring = () => {
  logger.info( 'Stopping container restart monitoring');
  monitoringActive = false;
  containerStates.clear();
};

// Get container status via Docker API
// Now expects full container name like 'notely-redis'
const getContainerStatus = async (containerName) => {
  try {
    // Query Docker API for this specific container
    const filters = JSON.stringify({ name: [containerName] });
    const response = await dockerAPI.get('/containers/json', {
      params: { all: true, filters }
    });
    
    if (!response.data || response.data.length === 0) {
      // Extract service name from container name for buildServiceStatus
      const serviceName = containerName.replace('notely-', '');
      return buildServiceStatus(serviceName);
    }

    const container = response.data[0];
    const name = container.Names[0].replace('/', '');
    const state = container.State;
    const statusText = container.Status;
    const ports = container.Ports.map(p => 
      p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : `${p.PrivatePort}`
    ).join(', ');
    
    // Extract service name from container name
    const serviceName = containerName.replace('notely-', '');
    return buildServiceStatus(serviceName, { state, statusText, ports }, containerName);
  } catch (error) {
    logger.error( `Failed to get status for ${containerName}`, { error: error.message });
    
    const serviceName = containerName.replace('notely-', '');
    const status = buildServiceStatus(serviceName);
    status.status = 'error';
    status.error = error.message;
    return status;
  }
};

// Helper function to send error responses
const sendErrorResponse = (res, statusCode, message) => {
  res.status(statusCode).json({ 
    success: false, 
    error: message 
  });
};

// Generic Docker action handler
const executeDockerAction = async (req, res, actionType) => {
  const { containerName } = req.params;
  const startTime = Date.now();
  
  try {
    logger.info( `${actionType} container: ${containerName}`, { user: req.user.email });
    
    // Execute Docker API command
    const endpoint = `/containers/${containerName}/${actionType}`;
    await dockerAPI.post(endpoint);
    
    // Wait and get updated status
    const waitTime = actionType === 'restart' ? 3000 : 2000;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    const status = await getContainerStatus(containerName);
    
    const executionTime = Date.now() - startTime;
    
    logger.info( `Container ${actionType}ed: ${containerName}`, { status: status.status });
    
    // Determine success status for logging
    res.json({
      success: true,
      message: `Container ${containerName} ${actionType}ed successfully`,
      data: status
    });
  } catch (error) {
    logger.error( `Failed to ${actionType} container: ${containerName}`, { error: error.message });
    sendErrorResponse(res, 500, `Failed to ${actionType} container: ${error.message}`);
  }
};

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    service: 'docker-manager',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Get status of all containers (optimized to use single Docker query)
app.get('/api/admin/docker/status', authenticate, async (req, res) => {
  try {
    logger.info( 'Getting Docker container status', { user: req.user.email });
    
    const services = await getServiceDefinitions();
    const statuses = await getAllContainerStatuses(services);

    // Return in the format the Admin Portal expects
    res.json({
      success: true,
      data: {
        services: statuses
      }
    });
  } catch (error) {
    logger.error( 'Failed to get container status', { error: error.message });
    sendErrorResponse(res, 500, 'Failed to get container status');
  }
});

// Start a service
app.post('/api/admin/docker/start/:containerName', authenticate, async (req, res) => {
  await executeDockerAction(req, res, 'start');
});

// Stop a service
app.post('/api/admin/docker/stop/:containerName', authenticate, async (req, res) => {
  await executeDockerAction(req, res, 'stop');
});

// Restart a service
app.post('/api/admin/docker/restart/:containerName', authenticate, async (req, res) => {
  await executeDockerAction(req, res, 'restart');
});

// Reload nginx configuration (graceful - no connection interruption)
// Uses nginx -s reload which:
// 1. Validates the new configuration
// 2. Starts new worker processes with new config
// 3. Gracefully shuts down old workers
// 4. Does NOT interrupt existing connections
app.post('/api/admin/docker/nginx/reload', authenticate, async (req, res) => {
  const startTime = Date.now();
  const containerName = 'notely-nginx-v3';

  try {
    logger.info('Reloading nginx configuration', { user: req.user.email });

    // Step 1: Validate nginx config before reload
    logger.info('Validating nginx configuration...');
    const testExecResponse = await dockerAPI.post(`/containers/${containerName}/exec`, {
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ['nginx', '-t']
    });

    const testExecId = testExecResponse.data.Id;
    const testStartResponse = await dockerAPI.post(`/exec/${testExecId}/start`, {
      Detach: false
    }, {
      responseType: 'text'
    });

    // Check if config test passed (nginx -t outputs to stderr on success)
    const testOutput = testStartResponse.data || '';
    if (testOutput.includes('failed') || testOutput.includes('error')) {
      logger.error('Nginx configuration validation failed', { output: testOutput });
      return res.status(400).json({
        success: false,
        error: 'nginx_config_invalid',
        message: 'Nginx configuration validation failed',
        details: testOutput
      });
    }

    logger.info('Nginx configuration valid, proceeding with reload');

    // Step 2: Send reload signal to nginx
    const reloadExecResponse = await dockerAPI.post(`/containers/${containerName}/exec`, {
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ['nginx', '-s', 'reload']
    });

    const reloadExecId = reloadExecResponse.data.Id;
    await dockerAPI.post(`/exec/${reloadExecId}/start`, {
      Detach: false
    }, {
      responseType: 'text'
    });

    // Brief wait for reload to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    const executionTime = Date.now() - startTime;

    logger.info('Nginx configuration reloaded successfully', {
      executionTimeMs: executionTime
    });

    res.json({
      success: true,
      message: 'Nginx configuration reloaded successfully',
      executionTimeMs: executionTime
    });

  } catch (error) {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      responseData: error.response?.data,
      responseStatus: error.response?.status
    };
    logger.error(`Failed to reload nginx configuration: ${JSON.stringify(errorDetails)}`);
    res.status(500).json({
      success: false,
      error: 'reload_failed',
      message: `Failed to reload nginx: ${error.message}`
    });
  }
});

// Recreate a service with updated environment variables
app.post('/api/admin/docker/recreate/:serviceName', authenticate, async (req, res) => {
  const { serviceName } = req.params;
  const startTime = Date.now();

  // SECURITY: Validate serviceName to prevent command injection
  // Docker Compose service names must only contain lowercase letters, numbers, and hyphens
  // Pattern allows: auth, admin-config, llm-worker, ws-gateway, etc.
  if (!serviceName || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(serviceName) || serviceName.length > 63) {
    logger.warn(`Invalid service name rejected: ${serviceName}`, { user: req.user?.email });
    return sendErrorResponse(res, 400, 'Invalid service name. Must contain only lowercase letters, numbers, and hyphens.');
  }

  try {
    logger.info(`Recreating service: ${serviceName}`, { user: req.user.email });

    // Use docker-compose to recreate the service
    // This automatically picks up changes from .env file
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    // Change to server directory where docker-compose.yml lives
    const composeDir = '/app/server';
    const command = `cd ${composeDir} && docker compose up -d --force-recreate --no-deps ${serviceName}`;

    logger.info(`Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000, // 60 second timeout
      env: { ...process.env }
    });

    if (stderr && !stderr.includes('Creating') && !stderr.includes('Starting') && !stderr.includes('Recreate')) {
      logger.warn(`Recreate stderr output: ${stderr}`);
    }

    logger.info(`Recreate stdout: ${stdout}`);

    // Wait for container to stabilize
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get updated status
    const containerName = `notely-${serviceName}-v3`;
    const status = await getContainerStatus(containerName);

    const executionTime = Date.now() - startTime;

    logger.info(`Service recreated: ${serviceName}`, {
      status: status.status,
      execution_time: executionTime
    });

    res.json({
      success: true,
      message: `Service ${serviceName} recreated successfully`,
      data: status
    });
  } catch (error) {
    logger.error(`Failed to recreate service: ${serviceName}`, {
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout
    });

    sendErrorResponse(res, 500, `Failed to recreate service: ${error.message}`);
  }
});

// Get logs for a container
app.get('/api/admin/docker/logs/:containerName', authenticate, async (req, res) => {
  const { containerName } = req.params;
  const { lines = 50 } = req.query;
  
  try {
    logger.info( `Getting logs for container: ${containerName}`, { user: req.user.email });
    
    // Use Docker API to get container logs
    const response = await dockerAPI.get(`/containers/${containerName}/logs`, {
      params: {
        stdout: true,
        stderr: true,
        tail: lines,
        timestamps: false
      },
      responseType: 'text'
    });
    
    // Parse the logs (Docker API returns logs with header bytes, but axios text mode handles this)
    const logLines = response.data.split('\n').filter(line => line.trim());
    
    res.json({
      success: true,
      data: {
        container: containerName,
        logs: logLines,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error( `Failed to get logs for container: ${containerName}`, { error: error.message });
    sendErrorResponse(res, 500, `Failed to get logs: ${error.message}`);
  }
});

// Get Docker container list (lightweight - just names and IDs for skeleton cards)
app.get('/api/admin/docker/containers', authenticate, async (req, res) => {
  try {
    logger.info('Getting Docker container list', { user: req.user.email });

    // Get list of containers first
    const containersResponse = await dockerAPI.get('/containers/json?all=true');
    const containers = containersResponse.data;

    // Filter for Notely containers only
    const notelyContainers = containers.filter(container =>
      container.Names.some(name => name.includes('notely-'))
    );

    const containerList = notelyContainers.map(container => {
      let containerName = container.Names[0].replace('/', ''); // Remove leading slash

      // Remove Docker hash prefix if present (e.g., "abc123_notely-service" -> "notely-service")
      containerName = containerName.replace(/^[a-f0-9]+_/, '');

      const serviceName = containerName.replace('notely-', '');

      return {
        containerId: container.Id.substring(0, 12),
        name: containerName,
        serviceName: serviceName,
        status: container.State
      };
    });

    res.json({
      success: true,
      data: containerList
    });

  } catch (error) {
    logger.error('Failed to get Docker container list', { error: error.message });
    sendErrorResponse(res, 500, `Failed to get container list: ${error.message}`);
  }
});

// Get Docker container stats
app.get('/api/admin/docker/stats', authenticate, async (req, res) => {
  try {
    logger.info('Getting Docker container stats', { user: req.user.email });

    // Get list of containers first
    const containersResponse = await dockerAPI.get('/containers/json?all=true');
    const containers = containersResponse.data;

    // Filter for Notely containers only
    const notelyContainers = containers.filter(container =>
      container.Names.some(name => name.includes('notely-'))
    );

    // Get stats for each container IN PARALLEL to avoid timeout
    const containerStatsPromises = notelyContainers.map(async (container) => {
      try {
        let containerName = container.Names[0].replace('/', ''); // Remove leading slash

        // Remove Docker hash prefix if present (e.g., "abc123_notely-service" -> "notely-service")
        // Docker adds these hashes when recreating containers with naming conflicts
        containerName = containerName.replace(/^[a-f0-9]+_/, '');

        const serviceName = containerName.replace('notely-', '');

        // First, check if the container is running
        const inspectResponse = await dockerAPI.get(`/containers/${container.Id}/json`, { timeout: 5000 });
        const containerConfig = inspectResponse.data;
        const isRunning = containerConfig.State?.Running === true;

        // For stopped containers, return a skeleton stats object
        if (!isRunning) {
          logger.info(`Container ${containerName} is not running, returning zero stats`);

          const formatBytes = (bytes) => {
            if (bytes === 0) return '0B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
          };

          return {
            containerId: container.Id.substring(0, 12),
            name: containerName,
            serviceName: serviceName,
            isRunning: false,
            state: containerConfig.State?.Status || 'unknown',
            status: container.Status,
            cpu: {
              usage: 0,
              usageText: '0%'
            },
            memory: {
              used: 0,
              total: 0,
              usage: 0,
              usageText: formatBytes(0) + ' / ' + formatBytes(0),
              usagePercent: '0%',
              cache: 0,
              cacheText: formatBytes(0)
            },
            network: {
              input: formatBytes(0),
              output: formatBytes(0),
              total: formatBytes(0) + ' / ' + formatBytes(0)
            },
            blockIO: {
              input: formatBytes(0),
              output: formatBytes(0),
              total: formatBytes(0) + ' / ' + formatBytes(0)
            }
          };
        }

        // For running containers, get stats as normal
        const statsResponse = await dockerAPI.get(`/containers/${container.Id}/stats?stream=false`, { timeout: 5000 });
        const stats = statsResponse.data;

        // Calculate CPU percentage (fixed to prevent over 100%)
        let cpuUsage = 0;
        if (stats.cpu_stats && stats.precpu_stats) {
          const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
          const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
          const numCPUs = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;

          if (systemDelta > 0 && cpuDelta >= 0) {
            cpuUsage = (cpuDelta / systemDelta) * 100;
            // Cap at 100% to prevent impossible values
            cpuUsage = Math.min(cpuUsage, 100);
          }
        }

        // Memory stats - use actual configured limit from container config
        const rawMemUsed = stats.memory_stats?.usage || 0;
        const memCache = (stats.memory_stats?.stats && stats.memory_stats.stats.cache) ? stats.memory_stats.stats.cache : 0;
        const memUsed = Math.max(rawMemUsed - memCache, 0);
        // Get the actual memory limit from container configuration (HostConfig.Memory)
        let memLimit = containerConfig.HostConfig?.Memory || 0;

        // Handle containers with no memory limit (0 = unlimited)
        if (memLimit === 0) {
          logger.warn(`Container ${containerName} has no memory limit configured in docker-compose`);
          // Skip this container or use a warning in the display
          memLimit = 0; // Keep as 0 to indicate unlimited
        }

        const memUsagePercent = memLimit > 0 ? (memUsed / memLimit) * 100 : 0;

        // Network stats
        const networks = stats.networks || {};
        let netRxBytes = 0, netTxBytes = 0;
        Object.values(networks).forEach(net => {
          netRxBytes += net.rx_bytes || 0;
          netTxBytes += net.tx_bytes || 0;
        });

        // Block I/O stats
        const blkRead = stats.blkio_stats?.io_service_bytes_recursive?.find(item => item.op === 'read')?.value || 0;
        const blkWrite = stats.blkio_stats?.io_service_bytes_recursive?.find(item => item.op === 'write')?.value || 0;

        // Format memory values
        const formatBytes = (bytes) => {
          if (bytes === 0) return '0B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
        };

        // GPU stats for llm-worker containers (execute nvidia-smi in container)
        let gpuStats = null;
        if (serviceName.startsWith('llm-worker')) {
          try {
            // Create exec instance to run nvidia-smi in the container
            const execResponse = await dockerAPI.post(`/containers/${container.Id}/exec`, {
              AttachStdout: true,
              AttachStderr: true,
              Cmd: ['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits']
            });

            const execId = execResponse.data.Id;

            // Start the exec instance
            const startResponse = await dockerAPI.post(`/exec/${execId}/start`, {
              Detach: false
            }, {
              responseType: 'text'
            });

            if (startResponse.data && startResponse.data.trim()) {
              const gpuData = startResponse.data.trim().split('\n')[0].split(',').map(s => s.trim());
              if (gpuData.length >= 5) {
                gpuStats = {
                  index: 0,
                  name: gpuData[0] || 'Unknown',
                  utilization: parseInt(gpuData[1]) || 0,
                  memoryUsed: parseInt(gpuData[2]) || 0,
                  memoryTotal: parseInt(gpuData[3]) || 0,
                  temperature: parseInt(gpuData[4]) || null
                };
              }
            }
          } catch (gpuError) {
            logger.warn(`Failed to get GPU stats from ${containerName} via nvidia-smi`, {
              error: gpuError.message,
              stack: gpuError.stack,
              response: gpuError.response?.data
            });
            // GPU stats are optional, continue without them
          }
        }

        const containerStats = {
          containerId: container.Id.substring(0, 12),
          name: containerName,
          serviceName: serviceName,
          isRunning: true,
          state: containerConfig.State?.Status || 'running',
          status: container.Status,
          cpu: {
            usage: Math.round(cpuUsage * 100) / 100,
            usageText: `${Math.round(cpuUsage * 100) / 100}%`
          },
          memory: {
            used: memUsed,
            total: memLimit,
            usage: Math.round(memUsagePercent * 100) / 100,
            usageText: `${formatBytes(memUsed)} / ${formatBytes(memLimit)}`,
            usagePercent: `${Math.round(memUsagePercent * 100) / 100}%`,
            cache: memCache,
            cacheText: `${formatBytes(memCache)}`
          },
          network: {
            input: formatBytes(netRxBytes),
            output: formatBytes(netTxBytes),
            total: `${formatBytes(netRxBytes)} / ${formatBytes(netTxBytes)}`
          },
          blockIO: {
            input: formatBytes(blkRead),
            output: formatBytes(blkWrite),
            total: `${formatBytes(blkRead)} / ${formatBytes(blkWrite)}`
          }
        };

        // Add GPU stats if available
        if (gpuStats) {
          containerStats.gpu = gpuStats;
        }

        return containerStats;

      } catch (statsError) {
        const containerName = container.Names[0]?.replace('/', '') || 'unknown';
        const serviceName = containerName.replace('notely-', '');
        logger.warn(`Failed to get stats for container ${containerName}`, { error: statsError.message });

        // Return skeleton stats for failed containers
        const formatBytes = (bytes) => {
          if (bytes === 0) return '0B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
        };

        return {
          containerId: container.Id.substring(0, 12),
          name: containerName,
          serviceName: serviceName,
          isRunning: false,
          state: 'error',
          status: 'Failed to retrieve container information',
          cpu: {
            usage: 0,
            usageText: '0%'
          },
          memory: {
            used: 0,
            total: 0,
            usage: 0,
            usageText: formatBytes(0) + ' / ' + formatBytes(0),
            usagePercent: '0%',
            cache: 0,
            cacheText: formatBytes(0)
          },
          network: {
            input: formatBytes(0),
            output: formatBytes(0),
            total: formatBytes(0) + ' / ' + formatBytes(0)
          },
          blockIO: {
            input: formatBytes(0),
            output: formatBytes(0),
            total: formatBytes(0) + ' / ' + formatBytes(0)
          }
        };
      }
    });

    // Wait for all container stats to complete
    const results = await Promise.all(containerStatsPromises);

    // All containers are now included (running, stopped, and failed)
    const statsData = results;

    logger.info(`Successfully collected stats for ${statsData.length}/${notelyContainers.length} containers (including stopped containers)`);

    res.json({
      success: true,
      data: {
        containers: statsData,
        timestamp: new Date().toISOString(),
        totalContainers: statsData.length
      }
    });

  } catch (error) {
    logger.error('Failed to get Docker container stats', { error: error.message });
    sendErrorResponse(res, 500, `Failed to get container stats: ${error.message}`);
  }
});

// Update Loki retention configuration
app.post('/api/admin/docker/config/loki/retention', authenticate, async (req, res) => {
  const startTime = Date.now();
  const { retention_days } = req.body;

  try {
    logger.info('Updating Loki retention configuration', {
      user: req.user.email,
      retention_days
    });

    // Validate retention_days parameter
    if (!retention_days || typeof retention_days !== 'number') {
      return sendErrorResponse(res, 400, 'retention_days must be a number');
    }

    if (retention_days < 1 || retention_days > 365) {
      return sendErrorResponse(res, 400, 'retention_days must be between 1 and 365');
    }

    // Path to .env file (mounted in container)
    const envFilePath = '/app/server/.env';

    // Read current .env file
    let envContent;
    try {
      envContent = fs.readFileSync(envFilePath, 'utf8');
    } catch (readError) {
      logger.error('Failed to read .env file', { error: readError.message });
      return sendErrorResponse(res, 500, `Failed to read .env file: ${readError.message}`);
    }

    // Parse .env content and find existing LOKI_RETENTION_DAYS
    const lines = envContent.split('\n');
    let oldValue = null;
    let foundIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('LOKI_RETENTION_DAYS=')) {
        foundIndex = i;
        oldValue = line.split('=')[1];
        break;
      }
    }

    // Update or append LOKI_RETENTION_DAYS
    const newLine = `LOKI_RETENTION_DAYS=${retention_days}`;

    if (foundIndex >= 0) {
      // Replace existing value
      lines[foundIndex] = newLine;
    } else {
      // Append to end of file
      lines.push(newLine);
    }

    // Write updated content back to .env file
    const updatedContent = lines.join('\n');
    try {
      fs.writeFileSync(envFilePath, updatedContent, 'utf8');
      logger.info('Updated .env file with new retention value', {
        old_value: oldValue,
        new_value: retention_days
      });
    } catch (writeError) {
      logger.error('Failed to write .env file', { error: writeError.message });
      return sendErrorResponse(res, 500, `Failed to write .env file: ${writeError.message}`);
    }

    // Wait briefly before recreating container
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Recreate Loki container to reload environment variables
    const serviceName = 'loki';
    const containerName = 'notely-loki-v3';
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const composeDir = '/app/server';
      const command = `cd ${composeDir} && docker compose up -d --force-recreate --no-deps ${serviceName}`;

      logger.info('Recreating Loki container with updated environment', {
        command,
        retention_days
      });

      await execAsync(command, {
        timeout: 60000,
        env: { ...process.env }
      });

      logger.info('Loki container recreation completed');
    } catch (recreateError) {
      logger.error('Failed to recreate Loki container', { error: recreateError.message });
      return sendErrorResponse(res, 500, `Failed to recreate Loki container: ${recreateError.message}`);
    }

    // Wait for container to stabilize
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get updated container status
    const status = await getContainerStatus(containerName);
    const executionTime = Date.now() - startTime;

    logger.info('Loki retention configuration updated successfully', {
      old_value: oldValue,
      new_value: retention_days,
      container_status: status.status
    });

    res.json({
      success: true,
      message: `Loki retention updated to ${retention_days} days and container restarted`,
      data: {
        retention_days: retention_days,
        container_status: status.status
      }
    });

  } catch (error) {
    logger.error('Failed to update Loki retention configuration', { error: error.message });
    sendErrorResponse(res, 500, `Failed to update Loki retention: ${error.message}`);
  }
});

// Get system performance metrics
app.get('/api/admin/system/performance', authenticate, async (req, res) => {
  try {
    const os = require('os');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    logger.info('Getting system performance metrics', { user: req.user.email });

    // Helper: Get CPU usage over 100ms
    const getCpuUsage = () => {
      return new Promise((resolve) => {
        const cpus = os.cpus();
        const start = cpus.map(cpu => {
          const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
          return { total, idle: cpu.times.idle };
        });

        setTimeout(() => {
          const current = os.cpus().map(cpu => {
            const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
            return { total, idle: cpu.times.idle };
          });

          const totalUsage = start.reduce((acc, prev, index) => {
            const totalDiff = current[index].total - prev.total;
            const idleDiff = current[index].idle - prev.idle;
            const usage = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
            return acc + Math.max(usage, 0);
          }, 0);

          resolve(totalUsage / cpus.length);
        }, 100);
      });
    };

    // Helper: Get disk usage
    const getDiskUsage = async () => {
      const parseSizeToMB = (sizeStr = '') => {
        const size = parseFloat(sizeStr);
        if (Number.isNaN(size)) return 0;
        if (sizeStr.includes('T')) return size * 1024 * 1024;
        if (sizeStr.includes('G')) return size * 1024;
        if (sizeStr.includes('K')) return size / 1024;
        return size;
      };

      try {
        const { stdout } = await execAsync('df -h / | tail -1');
        const parts = stdout.trim().split(/\s+/);
        return {
          total: parseSizeToMB(parts[1]),
          used: parseSizeToMB(parts[2]),
          free: parseSizeToMB(parts[3]),
          usagePercent: parseFloat((parts[4] || '').replace('%', '')) || 0
        };
      } catch (error) {
        logger.warn('Failed to get disk usage', { error: error.message });
        return { total: 0, used: 0, free: 0, usagePercent: 0 };
      }
    };

    // Helper: Get GPU info
    const getGpuInfo = async () => {
      try {
        const { stdout } = await execAsync('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits');
        return stdout.trim().split('\n').filter(Boolean).map(line => {
          const [name, utilization, memoryUsed, memoryTotal, temperature] = line.split(', ').map(val => val.trim());
          return {
            name,
            utilization: Number(utilization) || 0,
            memoryUsed: Number(memoryUsed) || 0,
            memoryTotal: Number(memoryTotal) || 0,
            temperature: Number(temperature) || 0
          };
        });
      } catch (error) {
        return [];
      }
    };

    // Helper: Get process count
    const getProcessCount = async () => {
      try {
        const { stdout } = await execAsync('ps aux | wc -l');
        return Math.max((parseInt(stdout.trim(), 10) || 1) - 1, 0);
      } catch (error) {
        return 0;
      }
    };

    // Helper: Get detailed memory info
    const getDetailedMemoryInfo = async () => {
      try {
        const { stdout } = await execAsync('cat /proc/meminfo');
        const lines = stdout.split('\n');
        const info = {};
        for (const line of lines) {
          if (line.startsWith('Cached:')) {
            info.cached = parseInt(line.split(/\s+/)[1], 10) * 1024;
          }
          if (line.startsWith('Buffers:')) {
            info.buffers = parseInt(line.split(/\s+/)[1], 10) * 1024;
          }
        }
        return info;
      } catch (error) {
        return {};
      }
    };

    // Helper: Get network interfaces
    const getNetworkInterfaces = async () => {
      const interfaces = [];
      try {
        const { stdout } = await execAsync('cat /proc/net/dev 2>/dev/null || echo ""');
        if (!stdout) return interfaces;
        const lines = stdout.split('\n').slice(2);
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.trim().split(/\s+/);
          const name = parts[0].replace(':', '');
          if (name.startsWith('lo')) continue;
          interfaces.push({
            name,
            bytesReceived: parseInt(parts[1], 10) || 0,
            packetsReceived: parseInt(parts[2], 10) || 0,
            bytesSent: parseInt(parts[9], 10) || 0,
            packetsSent: parseInt(parts[10], 10) || 0
          });
        }
      } catch (error) {
        logger.warn('Failed to read network stats', { error: error.message });
      }
      if (interfaces.length === 0) {
        interfaces.push({
          name: 'eth0',
          bytesReceived: 0,
          packetsReceived: 0,
          bytesSent: 0,
          packetsSent: 0
        });
      }
      return interfaces;
    };

    // Gather all metrics
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    const [cpuUsage, diskUsage, gpuInfo, processCount, detailedMemory, interfaces] = await Promise.all([
      getCpuUsage(),
      getDiskUsage(),
      getGpuInfo(),
      getProcessCount(),
      getDetailedMemoryInfo(),
      getNetworkInterfaces()
    ]);

    const metrics = {
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
        model: cpus[0]?.model || 'Unknown',
        frequency: cpus[0]?.speed || 0,
        load: os.loadavg()
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        usagePercent: Math.round((usedMemory / totalMemory) * 100 * 100) / 100,
        ...detailedMemory
      },
      disk: diskUsage,
      ...(gpuInfo.length > 0 ? { gpu: gpuInfo } : {}),
      network: { interfaces },
      system: {
        uptime: os.uptime(),
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        nodeVersion: process.version,
        processes: processCount
      },
      timestamp: Date.now()
    };

    res.json({ success: true, data: metrics });

  } catch (error) {
    logger.error('Failed to fetch system performance metrics', { error: error.message });
    sendErrorResponse(res, 500, `Failed to fetch system performance: ${error.message}`);
  }
});

// Error handling middleware with tracing support

// Fallback error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error', { error: error.message, stack: error.stack });
  sendErrorResponse(res, 500, 'Internal server error');
});

// 404 handler
app.use('*', (req, res) => {
  sendErrorResponse(res, 404, 'Endpoint not found');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Docker Manager service started', { port: PORT });

  // Start container monitoring after server starts
  setTimeout(startMonitoring, 5000); // Wait 5 seconds for startup
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info( 'Docker Manager service shutting down');
  stopMonitoring();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info( 'Docker Manager service shutting down');
  stopMonitoring();
  process.exit(0);
});
