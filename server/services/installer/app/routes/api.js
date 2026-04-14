/**
 * Installer API Routes
 *
 * REST API endpoints for the 9-step installation wizard.
 */

import { Router } from 'express';
import wizardRoutes from './wizard.js';

const router = Router();

// Mount wizard routes
router.use('/wizard', wizardRoutes);

// Get installer status
router.get('/status', (req, res) => {
  const workspacePath = process.env.WORKSPACE_PATH || '/workspace';

  res.json({
    status: 'ready',
    version: '1.0.0',
    workspacePath,
    timeoutMinutes: parseInt(process.env.INSTALLER_TIMEOUT_MINUTES || '30', 10),
  });
});

// Get current installation state
router.get('/state', async (req, res) => {
  try {
    const state = req.app.locals.installationState || {
      currentStep: 1,
      completedSteps: [],
      configuration: {},
      startedAt: null,
    };

    res.json(state);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update installation state
router.put('/state', async (req, res) => {
  try {
    const { currentStep, configuration } = req.body;

    req.app.locals.installationState = {
      ...req.app.locals.installationState,
      currentStep,
      configuration: {
        ...req.app.locals.installationState?.configuration,
        ...configuration,
      },
      updatedAt: new Date().toISOString(),
    };

    res.json(req.app.locals.installationState);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
