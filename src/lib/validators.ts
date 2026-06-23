import { z } from "zod";

export const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
]);

export const projectSourceSchema = z.object({
  integration_id: z.number().int(),
  type: z.enum(["sentry", "clickup"]),
  filter: z.record(z.string(), z.unknown()),
});

export const projectInputSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  repo_path: z.string().min(1, "La ruta del repo es obligatoria"),
  base_branch: z.string().optional(),
  target_branch: z.string().optional(),
  prompt_rules: z.string().optional(),
  auto_mode: z.boolean().optional(),
  permission_mode: permissionModeSchema.optional(),
  allowed_tools: z.string().nullable().optional(),
  disallowed_tools: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  max_turns: z.number().int().nullable().optional(),
  sources: z.array(projectSourceSchema).optional(),
  enabled: z.boolean().optional(),
  resolve_source_on_done: z.boolean().optional(),
  auth_method: z.enum(["inherit", "subscription", "api-key"]).optional(),
});

export const integrationInputSchema = z.object({
  type: z.enum(["sentry", "clickup"]),
  name: z.string().min(1, "El nombre es obligatorio"),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

export const settingsSchema = z.object({
  poll_interval_seconds: z.number().int().min(5).optional(),
  max_concurrent_runs: z.number().int().min(1).optional(),
  claude_binary_path: z.string().min(1).optional(),
  auto_run_enabled: z.boolean().optional(),
});

export const testConnectionSchema = z.object({
  type: z.enum(["sentry", "clickup"]),
  config: z.record(z.string(), z.unknown()),
});

export const manualTaskSchema = z.object({
  project_id: z.number().int(),
  title: z.string().min(1),
  description: z.string().optional(),
  url: z.string().nullable().optional(),
});

// ---------- planning ----------
export const planCreateSchema = z.object({
  // Either seed from an existing pulled task...
  from_task_id: z.number().int().optional(),
  // ...or provide the fields manually.
  title: z.string().optional(),
  objective: z.string().optional(),
  source_type: z.enum(["manual", "sentry", "clickup"]).optional(),
  source_integration_id: z.number().int().nullable().optional(),
  source_external_id: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
});

export const planStepInputSchema = z.object({
  title: z.string().min(1),
  spec: z.string().optional(),
});

export const planUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  objective: z.string().optional(),
  refined_spec: z.string().optional(),
  steps: z.array(planStepInputSchema).optional(),
});

export const planEnqueueSchema = z.object({
  scheduled_for: z.string().nullable().optional(),
});
