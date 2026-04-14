import { Router } from 'express';
import { collectDefaultMetrics, register, Counter, Histogram } from 'prom-client';

export const metricsRouter = Router();

// Collect default metrics
collectDefaultMetrics({ register });

// Custom metrics
export const summaryGenerationCounter = new Counter({
  name: 'summaries_generated_total',
  help: 'Total number of summaries generated',
  labelNames: ['summary_type', 'status'],
});

export const summaryGenerationDuration = new Histogram({
  name: 'summary_generation_duration_seconds',
  help: 'Duration of summary generation in seconds',
  labelNames: ['summary_type'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
});

export const llmRequestCounter = new Counter({
  name: 'llm_requests_total',
  help: 'Total number of LLM requests',
  labelNames: ['status'],
});

metricsRouter.get('/', async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(String(error));
  }
});
