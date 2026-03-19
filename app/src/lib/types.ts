// === Shared types for Pepper AWS ===

// === Todo: actionable work items ===

export type TodoStatus = 'open' | 'done' | 'cancelled' | 'suggested';
export type TodoPriority = 'high' | 'medium' | 'low';
export type TodoSourceType = 'manual' | 'email' | 'teams' | 'chat';

export interface Todo {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  dueDate?: string;
  sourceDocId?: string;      // S3 key of source document
  sourceType: TodoSourceType;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  priority?: TodoPriority;
  dueDate?: string;
  sourceDocId?: string;
  sourceType?: TodoSourceType;
  status?: TodoStatus;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  dueDate?: string | null;
}

// === Outbox: pending outputs ===

export type DestinationType = 'clipboard' | 'email' | 'teams';
export type OutboxStatus = 'draft' | 'approved' | 'sent';

export interface OutboxItem {
  id: string;
  destination: DestinationType;
  subject: string;
  content: string;
  to: string[];
  status: OutboxStatus;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOutboxInput {
  destination: DestinationType;
  subject: string;
  content: string;
  to?: string[];
  metadata?: Record<string, string>;
}

// === Service interfaces (config-driven) ===

export type AccountProvider = 'microsoft';

export interface AccountConfig {
  id: string;
  name: string;
  provider: AccountProvider;
  tenantId?: string;
  clientId: string;
  scopes: string[];
  envKey: string;
  enabled: boolean;
}

export interface CustomKnowledgeBase {
  id: string;
  name: string;
  description: string;
  kbId: string;
}

export interface AppConfig {
  accounts: AccountConfig[];
  userName?: string;
  userEmail?: string;
  knowledgeBases?: CustomKnowledgeBase[];
  sharePointAllowlist?: string[];
  polling: {
    emailIntervalSeconds: number;
    teamsIntervalSeconds: number;
  };
  review?: {
    emailRulesText?: string;
  };
}

// === S3 Document metadata (written as .metadata.json sidecar for Bedrock KB) ===

export type DocSourceType = 'email' | 'teams' | 'note' | 'document' | 'browser';

export interface DocMetadata {
  source: DocSourceType;
  title: string;
  from?: string;
  to?: string[];
  people: string[];
  date: string;               // ISO 8601
  conversationId?: string;
  tags?: string[];
  url?: string;
}

// === URL references ===

export type ReferenceLinkStatus = 'confirmed' | 'recommended' | 'dismissed';

export interface UrlReference {
  id: string;
  url: string;
  title: string;
  tags: string[];
  category: string;
  sourceType: string;
  status: ReferenceLinkStatus;
  sourceDocId?: string;
  createdAt: string;
  updatedAt: string;
}

// === People ===

export interface Person {
  id: number;
  name: string;
  normalizedName: string;
  email?: string;
  firstSeen: string;
  lastSeen: string;
  mentionCount: number;
}

// === Follow-ups ===

export interface FollowUp {
  id: number;
  sourceDocId: string;
  sourceType: 'email' | 'teams';
  status: 'waiting' | 'resolved' | 'dismissed';
  direction: 'awaiting_reply' | 'needs_response';
  contactName: string;
  contactEmail?: string;
  summary: string;
  detectedAt: string;
  staleDays: number;
}

// === Chat ===

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'action';
  content: string;
  createdAt: string;
}
