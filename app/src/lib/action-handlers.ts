import type { AgentActionRequest } from './bedrock-agent';
import { retrieve, retrieveFromKb } from './bedrock-kb';
import { loadConfig } from './config.node';
import { ingestNote } from './s3-ingest';
import { createTodo, listTodos, updateTodo, getTodoById } from './todos';
import { createOutboxItem } from './outbox';
import {
  toolSearchKnowledgeArgs,
  toolCreateNoteArgs,
  toolDraftEmailArgs,
  toolDraftTeamsArgs,
  toolCreateTodoArgs,
  toolCompleteTodoArgs,
  toolListTodosArgs,
} from './validation';
import logger from './logger';

/**
 * Dispatch a Return-of-Control action request to the appropriate local handler.
 * Returns a JSON string to send back via continueAgent().
 */
export async function handleAction(action: AgentActionRequest): Promise<string> {
  const fn = action.function;
  const params = action.parameters;

  logger.info({ actionGroup: action.actionGroup, function: fn }, 'Handling ROC action');

  try {
    switch (fn) {
      case 'searchKnowledge':
        return await handleSearchKnowledge(params);
      case 'createNote':
        return await handleCreateNote(params);
      case 'draftEmail':
        return handleDraftEmail(params);
      case 'draftTeamsMessage':
        return handleDraftTeams(params);
      case 'createTodo':
        return handleCreateTodo(params);
      case 'completeTodo':
        return handleCompleteTodo(params);
      case 'listTodos':
        return handleListTodos(params);
      default:
        logger.warn({ function: fn }, 'Unknown agent action');
        return JSON.stringify({ error: `Unknown action: ${fn}` });
    }
  } catch (err) {
    logger.error({ function: fn, err }, 'Action handler error');
    return JSON.stringify({ error: `Action failed: ${(err as Error).message}` });
  }
}

async function handleSearchKnowledge(params: Record<string, string>): Promise<string> {
  const args = toolSearchKnowledgeArgs.parse({
    query: params.query,
    limit: params.limit ? Number(params.limit) : undefined,
  });

  const topK = args.limit ?? 10;

  // Search the primary KB
  const mainResults = await retrieve(args.query, { topK });

  // Search any custom KBs configured by the user
  const config = loadConfig();
  const customKbs = config.knowledgeBases ?? [];

  const customResults: Array<{ source: string; content: string; location?: string; score?: number }> = [];

  if (customKbs.length > 0) {
    const customSearches = customKbs.map(async (kb) => {
      try {
        const results = await retrieveFromKb(kb.kbId, args.query, { topK: Math.min(topK, 5) });
        return results.map(r => ({
          source: kb.name,
          content: r.content.slice(0, 2000),
          location: r.location,
          score: r.score,
        }));
      } catch (err) {
        logger.warn({ kbId: kb.kbId, kbName: kb.name, err }, 'Custom KB search failed');
        return [];
      }
    });
    const allCustom = await Promise.all(customSearches);
    customResults.push(...allCustom.flat());
  }

  return JSON.stringify({
    results: mainResults.map(r => ({
      content: r.content.slice(0, 2000),
      location: r.location,
      score: r.score,
    })),
    ...(customResults.length > 0 ? { customKbResults: customResults } : {}),
  });
}

/** Safely parse a JSON array string, falling back to comma-split for unquoted values */
function safeParseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Agent may send unquoted values like [dispensing, cloud, personnel]
  }
  // Strip brackets and split by comma
  return value.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

async function handleCreateNote(params: Record<string, string>): Promise<string> {
  const args = toolCreateNoteArgs.parse({
    title: params.title,
    content: params.content,
    tags: params.tags ? safeParseArray(params.tags) : undefined,
  });

  const s3Key = await ingestNote(args);
  return JSON.stringify({ success: true, s3Key });
}

function handleDraftEmail(params: Record<string, string>): string {
  const args = toolDraftEmailArgs.parse({
    to: params.to ? safeParseArray(params.to) : undefined,
    subject: params.subject,
    body: params.body,
  });

  const item = createOutboxItem({
    destination: 'email',
    subject: args.subject,
    content: args.body,
    to: args.to,
  });

  return JSON.stringify({ success: true, outboxId: item.id, destination: 'email' });
}

function handleDraftTeams(params: Record<string, string>): string {
  const args = toolDraftTeamsArgs.parse({
    content: params.content,
  });

  const item = createOutboxItem({
    destination: 'teams',
    subject: 'Teams message',
    content: args.content,
  });

  return JSON.stringify({ success: true, outboxId: item.id, destination: 'teams' });
}

function handleCreateTodo(params: Record<string, string>): string {
  const args = toolCreateTodoArgs.parse({
    title: params.title,
    description: params.description,
    priority: params.priority as 'high' | 'medium' | 'low' | undefined,
    dueDate: params.dueDate,
  });

  const todo = createTodo({
    ...args,
    sourceType: 'chat',
  });

  return JSON.stringify({ success: true, todoId: todo.id, title: todo.title });
}

function handleCompleteTodo(params: Record<string, string>): string {
  const args = toolCompleteTodoArgs.parse({
    todoId: params.todoId,
  });

  const existing = getTodoById(args.todoId);
  if (!existing) return JSON.stringify({ error: 'Todo not found' });

  const updated = updateTodo(args.todoId, { status: 'done' });
  return JSON.stringify({ success: true, todoId: updated?.id, status: 'done' });
}

function handleListTodos(params: Record<string, string>): string {
  const args = toolListTodosArgs.parse({
    status: params.status as 'open' | 'done' | 'cancelled' | undefined,
    limit: params.limit ? Number(params.limit) : undefined,
  });

  const todos = listTodos({
    status: args.status,
    limit: args.limit ?? 20,
  });

  return JSON.stringify({
    todos: todos.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
    })),
    total: todos.length,
  });
}
