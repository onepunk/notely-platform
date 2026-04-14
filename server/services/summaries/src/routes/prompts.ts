import { Router, Request, Response } from 'express';
import {
  listPromptTemplates,
  getPromptTemplateById,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  setActivePromptTemplate,
} from '../services/promptStore';

export const promptsRouter = Router();

// GET /api/admin/prompts — list all templates
promptsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const templates = await listPromptTemplates();
    res.json({ templates });
  } catch (error) {
    console.error('Failed to list prompt templates:', error);
    res.status(500).json({ error: 'Failed to list prompt templates' });
  }
});

// GET /api/admin/prompts/:id — get one
promptsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const template = await getPromptTemplateById(req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Prompt template not found' });
      return;
    }
    res.json(template);
  } catch (error) {
    console.error('Failed to get prompt template:', error);
    res.status(500).json({ error: 'Failed to get prompt template' });
  }
});

// POST /api/admin/prompts — create
promptsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, system_prompt, output_structure } = req.body;
    if (!name || !system_prompt || !output_structure) {
      res.status(400).json({ error: 'name, system_prompt, and output_structure are required' });
      return;
    }
    const template = await createPromptTemplate({ name, system_prompt, output_structure });
    res.status(201).json(template);
  } catch (error) {
    console.error('Failed to create prompt template:', error);
    res.status(500).json({ error: 'Failed to create prompt template' });
  }
});

// PUT /api/admin/prompts/:id — update
promptsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await getPromptTemplateById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Prompt template not found' });
      return;
    }
    if (existing.is_default) {
      res.status(403).json({ error: 'Cannot modify the default template' });
      return;
    }
    const template = await updatePromptTemplate(req.params.id, req.body);
    res.json(template);
  } catch (error) {
    console.error('Failed to update prompt template:', error);
    res.status(500).json({ error: 'Failed to update prompt template' });
  }
});

// DELETE /api/admin/prompts/:id — delete (block if default)
promptsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await getPromptTemplateById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Prompt template not found' });
      return;
    }
    if (existing.is_default) {
      res.status(403).json({ error: 'Cannot delete the default template' });
      return;
    }
    await deletePromptTemplate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete prompt template:', error);
    res.status(500).json({ error: 'Failed to delete prompt template' });
  }
});

// POST /api/admin/prompts/:id/activate — set as active
promptsRouter.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    await setActivePromptTemplate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to activate prompt template:', error);
    res.status(400).json({ error: message });
  }
});
