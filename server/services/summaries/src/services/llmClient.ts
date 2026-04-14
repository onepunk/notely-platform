import { config } from '../config/env';
import { getActivePromptTemplate } from './promptStore';

export interface SummaryRequest {
  transcriptionText: string;
  summaryType: 'full' | 'brief' | 'action_items' | 'key_points';
  transcriptionId: string;
  userId: string;
}

export interface SummaryResponse {
  success: boolean;
  summary?: string;
  error?: string;
  metadata?: {
    model: string;
    tokensUsed: number;
    processingTimeMs: number;
  };
}

// Map our summary types to LLM gateway analysis types
// Note: 'full' maps to 'structured_v1' to get the JSON schema that desktop expects
const SUMMARY_TYPE_TO_ANALYSIS: Record<string, string> = {
  full: 'structured_v1',
  brief: 'summary',
  action_items: 'action_items',
  key_points: 'key_points',
};

interface LLMAnalyzeResponse {
  result: string | Record<string, unknown>;
  analysis_type: string;
  backend: string;
  result_is_text: boolean;
  timestamp: number;
  error?: string;
}

export async function generateSummary(request: SummaryRequest): Promise<SummaryResponse> {
  const startTime = Date.now();

  // Map our summary type to LLM gateway analysis type
  const analysisType = SUMMARY_TYPE_TO_ANALYSIS[request.summaryType] || 'full';

  try {
    // Fetch active prompt template from DB (required — no fallback prompts)
    const activePrompt = await getActivePromptTemplate();
    if (!activePrompt) {
      return {
        success: false,
        error: 'No active prompt template configured. Create and activate one in Admin → Prompts.',
      };
    }

    // Call LLM gateway's /analyze endpoint (internal Docker URL)
    const response = await fetch(`${config.llmGateway.url}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: request.transcriptionText,
        analysis_type: analysisType,
        system_prompt: activePrompt.system_prompt,
        output_structure: activePrompt.output_structure,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LLM Gateway error:', response.status, errorText);
      return {
        success: false,
        error: `LLM service error: ${response.status}`,
      };
    }

    const data = (await response.json()) as LLMAnalyzeResponse;
    const processingTimeMs = Date.now() - startTime;

    if (data.error) {
      return {
        success: false,
        error: data.error,
      };
    }

    if (!data.result) {
      return {
        success: false,
        error: 'No summary content in response',
      };
    }

    // Transform LLM output to StructuredSummaryV1 JSON string.
    // This matches what notely-ai does in SummaryHandlers.ts:268-382
    let summaryJson: string;

    if (!data.result_is_text && typeof data.result === 'object' && data.result !== null) {
      // LLM returned structured JSON — map to StructuredSummaryV1 schema
      const r = data.result as Record<string, any>;

      // Map keyPoints / key_points → topics_highlights
      const keyPoints: any[] = r.keyPoints ?? r.key_points ?? [];
      const topicsHighlights = keyPoints.map(
        (kp: any) => ({
          title: kp.topic || kp.title || 'Key Point',
          entries: [{
            type: 'Key Point',
            text: kp.summary || kp.text || '',
            owner: null,
            due_date: null,
          }],
        })
      );

      // Map actionItems / action_items → next_steps
      const actionItems: any[] = r.actionItems ?? r.action_items ?? [];
      const nextSteps = actionItems.map(
        (ai: any) => ({
          text: ai.text || '',
          owner: ai.owner ?? null,
          due_date: ai.dueDate ?? ai.due_date ?? null,
        })
      );

      const decisions: any[] = r.decisions ?? [];
      const participants: string[] = r.participants ?? [];

      // Build summary narrative from available fields.
      // The chunk_extraction template returns structured JSON without a top-level
      // summary field.  Synthesise a narrative from the extracted key_points,
      // action_items and decisions so the UI has something to display.
      let summaryNarrative = r.summary ?? r['Executive Summary'] ?? r.executive_summary ?? '';
      if (typeof summaryNarrative === 'string') {
        // Strip code fences and HTML that LLMs sometimes emit
        if (summaryNarrative.includes('```')) {
          const fenceMatch = summaryNarrative.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenceMatch) {
            try {
              const parsed = JSON.parse(fenceMatch[1].trim());
              summaryNarrative = parsed['Executive Summary'] || parsed.executive_summary
                || parsed.summary || summaryNarrative;
            } catch { /* not JSON inside fence, keep original */ }
          }
        }
        summaryNarrative = summaryNarrative.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
      }

      // If no explicit summary, synthesise one from key_points
      if (!summaryNarrative && keyPoints.length > 0) {
        const topicNames = (r.topics ?? []).length > 0
          ? (r.topics as string[]).join(', ')
          : keyPoints.map((kp: any) => kp.topic || 'General').join(', ');
        const kpSummaries = keyPoints
          .map((kp: any) => kp.summary || kp.text || '')
          .filter(Boolean);
        const title = `Topics: ${topicNames}`;
        const body = kpSummaries.join(' ');
        summaryNarrative = `${title}\n${body}`;
        if (decisions.length > 0) {
          summaryNarrative += '\nKey Decisions:\n' + decisions.map((d: any) => `- ${d.text || d}`).join('\n');
        }
        if (actionItems.length > 0) {
          summaryNarrative += '\nAction Items:\n' + actionItems
            .map((ai: any) => `- ${ai.owner ? ai.owner + ': ' : ''}${ai.text}${ai.due_date || ai.dueDate ? ' (' + (ai.due_date || ai.dueDate) + ')' : ''}`)
            .join('\n');
        }
      }

      const structured = {
        summary: summaryNarrative,
        next_steps: nextSteps,
        decisions,
        topics_highlights: topicsHighlights,
        participants: participants.length === 0 ? ['Unknown'] : participants,
        ai_insights: null,
        date: null,
        metadata: null,
      };

      summaryJson = JSON.stringify(structured);
    } else {
      // LLM returned raw text (markdown) — wrap in minimal StructuredSummaryV1
      const rawText = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
      const structured = {
        summary: rawText,
        next_steps: [],
        decisions: [],
        topics_highlights: [],
        participants: ['Unknown'],
        ai_insights: null,
        date: null,
        metadata: null,
      };
      summaryJson = JSON.stringify(structured);
    }

    return {
      success: true,
      summary: summaryJson,
      metadata: {
        model: data.backend || 'vllm',
        tokensUsed: 0, // Not provided by /analyze endpoint
        processingTimeMs,
      },
    };
  } catch (error) {
    console.error('LLM client error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function checkLLMHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${config.llmGateway.url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
