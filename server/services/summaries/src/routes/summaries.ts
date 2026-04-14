import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth';
import { licenseCheckMiddleware } from '../middleware/licenseCheck';
import { generateSummary } from '../services/llmClient';
import {
  createSummary,
  getSummaryById,
  getSummariesByNoteId,
  getSummariesByTranscriptionId,
  deleteSummary,
} from '../services/summaryStore';
import { notifySyncNeeded } from '../services/syncNotifier';
import { getPool } from '../lib/database';

export const summariesRouter = Router();

// Summary type mapping: desktop types -> server types
const SUMMARY_TYPE_MAP: Record<string, string> = {
  structured_v1: 'full',
  full: 'full',
  brief: 'brief',
  action_items: 'action_items',
  key_points: 'key_points',
};

const generateSummarySchema = z.object({
  transcriptionId: z.string().uuid(),
  summaryType: z.string().default('full'),
});

// POST /api/summaries/generate - Generate a new AI summary
summariesRouter.post(
  '/generate',
  licenseCheckMiddleware('ai-summarisation'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      console.log('[summaries] generate request', {
        transcriptionId: req.body?.transcriptionId,
        summaryType: req.body?.summaryType,
      });

      const parsed = generateSummarySchema.safeParse(req.body);

      if (!parsed.success) {
        console.error('[summaries] Validation errors:', JSON.stringify(parsed.error.errors, null, 2));
        res.status(400).json({
          error: 'Invalid request body',
          details: parsed.error.errors,
        });
        return;
      }

      const { transcriptionId, summaryType } = parsed.data;
      const userId = req.user!.userId;

      // Look up transcription text from the synced data
      const pool = getPool();
      const txResult = await pool.query(
        'SELECT text FROM client_sync.transcription_content WHERE user_id = $1 AND entity_id = $2 AND deleted = false',
        [userId, transcriptionId]
      );
      if (!txResult.rows[0]?.text) {
        res.status(404).json({ error: 'Transcription not found or not yet synced' });
        return;
      }
      const transcriptionText = txResult.rows[0].text;

      // Map summary type
      const mappedType = SUMMARY_TYPE_MAP[summaryType] || 'full';

      // Generate summary using LLM
      const llmResponse = await generateSummary({
        transcriptionText,
        summaryType: mappedType as 'full' | 'brief' | 'action_items' | 'key_points',
        transcriptionId,
        userId,
      });

      if (!llmResponse.success || !llmResponse.summary) {
        res.status(500).json({
          error: 'Failed to generate summary',
          details: llmResponse.error,
        });
        return;
      }

      const summary = await createSummary({
        userId,
        transcriptionId,
        summaryText: llmResponse.summary,
        modelVersion: llmResponse.metadata?.model,
      });

      // Notify for sync (use entity_id for sync operations)
      await notifySyncNeeded(userId, summary.entity_id, 'create', req.user?.deviceId);

      // Response uses proper field names
      res.status(201).json({
        success: true,
        summary: {
          id: summary.id,
          entity_id: summary.entity_id,
          transcription_id: summary.transcription_id,
          note_id: summary.note_id,
          summary_text: summary.summary_text,
          created_at: summary.created_at,
          model_version: summary.model_version,
        },
      });
    } catch (error) {
      console.error('Generate summary error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/summaries/:id - Get a specific summary
summariesRouter.get(
  '/:id',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;

      const summary = await getSummaryById(id, userId);

      if (!summary) {
        res.status(404).json({ error: 'Summary not found' });
        return;
      }

      res.json({
        id: summary.id,
        entity_id: summary.entity_id,
        transcription_id: summary.transcription_id,
        note_id: summary.note_id,
        summary_text: summary.summary_text,
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        model_version: summary.model_version,
      });
    } catch (error) {
      console.error('Get summary error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/summaries/:id - Delete a summary
summariesRouter.delete(
  '/:id',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;
      const deviceId = req.user?.deviceId;

      // Get summary first to get entity_id for sync notification
      const existing = await getSummaryById(id, userId);
      if (!existing) {
        res.status(404).json({ error: 'Summary not found' });
        return;
      }

      const deleted = await deleteSummary(id, userId);

      if (!deleted) {
        res.status(404).json({ error: 'Summary not found' });
        return;
      }

      // Notify for sync using entity_id
      await notifySyncNeeded(userId, existing.entity_id, 'delete', deviceId);

      res.status(204).send();
    } catch (error) {
      console.error('Delete summary error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/summaries/transcription/:transcriptionId - Get summaries for a transcription
summariesRouter.get(
  '/transcription/:transcriptionId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { transcriptionId } = req.params;
      const userId = req.user!.userId;

      const summaries = await getSummariesByTranscriptionId(transcriptionId, userId);

      res.json({
        summaries: summaries.map((s) => ({
          id: s.id,
          entity_id: s.entity_id,
          transcription_id: s.transcription_id,
          note_id: s.note_id,
          summary_text: s.summary_text,
          created_at: s.created_at,
          updated_at: s.updated_at,
          model_version: s.model_version,
        })),
      });
    } catch (error) {
      console.error('Get summaries by transcription error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
