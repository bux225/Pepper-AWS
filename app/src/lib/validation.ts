import { z } from 'zod';

// === Chat schemas ===

export const chatSchema = z.object({
  message: z.string().min(1).max(50000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(100000),
  })).max(50).optional(),
});

// === Outbox schemas ===

export const outboxCreateSchema = z.object({
  destination: z.enum(['clipboard', 'email', 'teams']),
  subject: z.string().max(1000),
  content: z.string().min(1).max(100000),
  to: z.array(z.string().max(500)).max(50).optional(),
  metadata: z.record(z.string(), z.string().max(5000)).optional(),
});

export const outboxPatchSchema = z.object({
  subject: z.string().max(1000).optional(),
  content: z.string().max(100000).optional(),
  to: z.array(z.string().max(500)).max(50).optional(),
  metadata: z.record(z.string(), z.string().max(5000)).optional(),
  status: z.enum(['draft', 'approved', 'sent']).optional(),
});

// === Account schemas ===

export const createAccountSchema = z.object({
  name: z.string().min(1).max(200),
  provider: z.enum(['microsoft']),
  clientId: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200).optional(),
  scopes: z.array(z.string().max(100)).min(1).max(20),
  envKey: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
});

// === Settings schemas ===

export const settingsSchema = z.object({
  review: z.object({
    emailRulesText: z.string().max(10000).optional(),
  }).optional(),
});

// === Note schemas ===

export const ingestNoteSchema = z.object({
  title: z.string().min(1).max(1000),
  content: z.string().min(1).max(500000),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

// === Todo schemas ===

export const createTodoSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  dueDate: z.string().max(30).optional(),
  sourceDocId: z.string().max(500).optional(),
  sourceType: z.enum(['manual', 'email', 'teams', 'chat']).optional(),
});

export const updateTodoSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(['open', 'done', 'cancelled', 'suggested']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  dueDate: z.string().max(30).nullable().optional(),
});

export const todoQuerySchema = z.object({
  status: z.enum(['open', 'done', 'cancelled', 'suggested']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

// === Edge history schemas ===

export const edgeHistorySchema = z.object({
  daysBack: z.number().int().min(1).max(365).optional(),
  minVisits: z.number().int().min(1).optional(),
  urlFilter: z.string().max(500).optional(),
});

// === Dismiss sender schema ===

export const dismissSenderSchema = z.object({
  sender: z.string().min(1).max(500),
  note: z.string().max(2000).optional(),
});

// === Tool call argument schemas (used by Bedrock Agent ROC handlers) ===

export const toolSearchKnowledgeArgs = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).optional(),
});

export const toolCreateNoteArgs = z.object({
  title: z.string().min(1).max(1000),
  content: z.string().min(1).max(100000),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

export const toolDraftEmailArgs = z.object({
  to: z.array(z.string().max(500)).max(50).optional(),
  subject: z.string().min(1).max(1000),
  body: z.string().min(1).max(100000),
});

export const toolDraftTeamsArgs = z.object({
  content: z.string().min(1).max(100000),
});

export const toolCreateTodoArgs = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  dueDate: z.string().max(30).optional(),
});

export const toolCompleteTodoArgs = z.object({
  todoId: z.string().min(1).max(100),
});

export const toolListTodosArgs = z.object({
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
