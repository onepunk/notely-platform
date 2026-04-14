import { getPool } from '../lib/database';

export interface PromptTemplate {
  id: string;
  name: string;
  system_prompt: string;
  output_structure: string;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePromptInput {
  name: string;
  system_prompt: string;
  output_structure: string;
}

export interface UpdatePromptInput {
  name?: string;
  system_prompt?: string;
  output_structure?: string;
}

const TABLE = 'admin_settings.prompt_templates';

export async function getActivePromptTemplate(): Promise<PromptTemplate | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM ${TABLE} WHERE is_active = true LIMIT 1`
  );
  return result.rows[0] || null;
}

export async function listPromptTemplates(): Promise<PromptTemplate[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM ${TABLE} ORDER BY is_default DESC, created_at ASC`
  );
  return result.rows;
}

export async function getPromptTemplateById(id: string): Promise<PromptTemplate | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM ${TABLE} WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function createPromptTemplate(input: CreatePromptInput): Promise<PromptTemplate> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO ${TABLE} (name, system_prompt, output_structure, is_default, is_active)
     VALUES ($1, $2, $3, false, false)
     RETURNING *`,
    [input.name, input.system_prompt, input.output_structure]
  );
  return result.rows[0];
}

export async function updatePromptTemplate(
  id: string,
  input: UpdatePromptInput
): Promise<PromptTemplate | null> {
  const pool = getPool();

  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.system_prompt !== undefined) {
    fields.push(`system_prompt = $${paramIndex++}`);
    values.push(input.system_prompt);
  }
  if (input.output_structure !== undefined) {
    fields.push(`output_structure = $${paramIndex++}`);
    values.push(input.output_structure);
  }

  if (fields.length === 0) return getPromptTemplateById(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = $${paramIndex} AND is_default = false RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function deletePromptTemplate(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM ${TABLE} WHERE id = $1 AND is_default = false`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setActivePromptTemplate(id: string): Promise<void> {
  const pool = getPool();

  // Verify template exists
  const existing = await getPromptTemplateById(id);
  if (!existing) {
    throw new Error(`Prompt template not found: ${id}`);
  }

  // Deactivate all, then activate the selected one
  await pool.query(`UPDATE ${TABLE} SET is_active = false WHERE is_active = true`);
  await pool.query(`UPDATE ${TABLE} SET is_active = true, updated_at = NOW() WHERE id = $1`, [id]);
}
