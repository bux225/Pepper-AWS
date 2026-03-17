# Pepper AWS — Game Plan

> Rebuild Pepper as a local-first personal assistant backed by AWS managed services for RAG, memory, and intelligence.
> Single user. No public API. No multi-tenant infrastructure. Just your Mac, Next.js, and AWS SDK calls.
>
> Generated: March 16, 2026

---

## Why Start Over

The first Pepper build proved the concept — the UI, Microsoft 365 integration, tool calling, and chat workflow all work well. What didn't work:

| What Failed | Why |
|---|---|
| **Bedrock Knowledge Bases (managed RAG)** | Rudimentary chunking, no control over retrieval quality, poor analysis output |
| **Self-managed local RAG (sqlite-vec + FTS5 + RRF)** | Required building and tuning an entire retrieval pipeline from scratch — chunking, hybrid search, reranking, query decomposition, metadata enrichment, time-decay boosting. 7 major gaps identified and patched. Still fragile. |
| **Local embedding storage** | sqlite-vec works but is a maintenance burden — schema migrations, chunk tables, re-embedding workflows |

**The core insight**: the LLM (Claude) is excellent. The problem has always been **how context gets fed to it**. AWS now offers more mature managed services (Bedrock Knowledge Bases with advanced chunking/parsing, Bedrock Agents with built-in tool orchestration) that handle the hard parts we were building by hand.

**What we keep**: The Next.js UI, Microsoft 365 integration (MSAL + Graph), the chat UX, the todo/URL/people/digest feature set. All of that was solid.

**What we replace**: The entire local RAG pipeline, local vector storage, local embedding management, and local agentic orchestration.

---

## Design Principles

1. **Personal tool** — Single user, runs on your Mac, no public endpoints, no Cognito, no API Gateway
2. **AWS SDK direct** — Next.js API routes call AWS services directly using your IAM credentials (environment variables or `~/.aws/credentials`)
3. **Keep the UI** — Same/similar Next.js + Tailwind frontend. Chat panel, todos, URLs, people, digest, settings
4. **Managed RAG** — Let Bedrock Knowledge Bases handle chunking, embedding, indexing, and retrieval. Stop maintaining that ourselves
5. **Managed Agents** — Let Bedrock Agents handle tool orchestration instead of our custom 10-round agentic loop
6. **S3 as source of truth** — All ingested content lands in S3. Bedrock KB syncs from S3. Simple, durable, auditable
7. **Minimal infrastructure** — No Step Functions, no EventBridge, no Lambda, no DynamoDB unless there's no simpler option. Prefer local scheduling (node-cron) and local structured data (SQLite) for things that don't need cloud

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Your Mac — Pepper (Next.js + TypeScript)                           │
│                                                                     │
│  ┌─────────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  ┌───────┐ │
│  │ Chat Panel  │  │ Todos    │  │ URLs   │  │ People │  │Digest │ │
│  │ (streaming) │  │ Panel    │  │ Panel  │  │ Panel  │  │ Panel │ │
│  └──────┬──────┘  └────┬─────┘  └───┬────┘  └───┬────┘  └──┬────┘ │
│         │              │            │            │           │      │
│  ┌──────▼──────────────▼────────────▼────────────▼───────────▼────┐ │
│  │                    Next.js API Routes                          │ │
│  │  /api/chat  /api/todos  /api/urls  /api/people  /api/ingest   │ │
│  └──────┬─────────────────────────────────────────────────────────┘ │
│         │                                                           │
│  ┌──────▼──────────────────────────────────────────────────────────┐│
│  │                      Core Library (src/lib/)                    ││
│  │                                                                 ││
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────┐              ││
│  │  │ bedrock-   │  │ s3-        │  │ graph.ts     │              ││
│  │  │ agent.ts   │  │ ingest.ts  │  │ (MS 365)     │              ││
│  │  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘              ││
│  │        │               │                │                       ││
│  │  ┌─────▼───────────────▼────────────────▼───────────────────┐   ││
│  │  │  SQLite (local structured data only)                     │   ││
│  │  │  • todos, people, urls, chat_sessions, settings          │   ││
│  │  │  • poll watermarks, sync journal                         │   ││
│  │  │  • NO embeddings, NO vectors, NO card content            │   ││
│  │  └──────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────┬──────────────────────┬───────────────────────────────────┘
          │ (AWS SDK)            │ (MS Graph API)
          ▼                      ▼
┌─────────────────────────┐   ┌──────────────────┐
│  AWS (your account)     │   │ Microsoft 365    │
│                         │   │ • Email (Graph)  │
│  ┌───────────────────┐  │   │ • Teams (Graph)  │
│  │ S3 Bucket         │  │   └──────────────────┘
│  │ pepper-kb-data/   │  │
│  │  ├── emails/      │  │
│  │  ├── teams/       │  │
│  │  ├── notes/       │  │
│  │  ├── documents/   │  │
│  │  ├── browser/     │  │
│  │  └── metadata/    │  │
│  └────────┬──────────┘  │
│           │ (data sync) │
│  ┌────────▼──────────┐  │
│  │ Bedrock KB        │  │
│  │ • Chunking        │  │
│  │ • Embedding       │  │
│  │ • Vector store    │  │
│  │ • Retrieval       │  │
│  └────────┬──────────┘  │
│           │              │
│  ┌────────▼──────────┐  │
│  │ Bedrock Agent     │  │
│  │ • Claude Sonnet   │  │
│  │ • KB integration  │  │
│  │ • Action groups   │  │
│  │   (tool calling)  │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ Bedrock LLM       │  │
│  │ (direct invoke    │  │
│  │  for extraction   │  │
│  │  & analysis)      │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

---

## AWS Services & Their Roles

### S3 — Content Storage (Source of Truth)

**What**: Single bucket holding all ingested content as structured JSON/text files.

**Why**: Bedrock KB syncs from S3. Having all content in S3 means the KB always has the complete picture. It's also a natural backup of everything Pepper has ever ingested.

**Bucket structure**:
```
s3://pepper-kb-{account-id}/
├── emails/
│   └── {messageId}.json          # { subject, from, to, body, date, conversationId, ... }
├── teams/
│   └── {chatId}/{messageId}.json # { from, body, date, chatId, ... }
├── notes/
│   └── {noteId}.json             # { title, content, date, tags }
├── documents/
│   └── {docId}.json              # { filename, content, date, source }
├── browser/
│   └── {visitId}.json            # { url, title, visitTime }
└── metadata/
    └── {sourceId}.metadata.json  # Bedrock KB metadata files for filtering
```

**Metadata files**: Bedrock KB supports [metadata files](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-ds-s3.html) (`.metadata.json` sidecar) that let you attach filterable attributes (source type, date, people, etc.) to each document. This replaces our hand-built query decomposition and metadata filtering.

**Cost**: Negligible. S3 storage for personal data (emails, notes) will be pennies/month.

---

### Bedrock Knowledge Bases — Managed RAG

**What**: Bedrock KB handles the entire RAG pipeline — chunking, embedding, vector indexing, and retrieval — from the S3 data source.

**Why**: This replaces everything we built by hand in v1: `sqlite-vec`, `card_chunks` table, `buildEmbeddingText()`, `retrieveContext()`, `applyRecencyBoost()`, `decomposeQuery()`, `rerankWithLLM()`, reciprocal rank fusion, FTS5 sync triggers. All of it.

**Configuration choices**:

| Setting | Choice | Rationale |
|---|---|---|
| **Embedding model** | Titan Embeddings V2 (1024-dim) | Same as v1, best on Bedrock, good balance of quality and cost |
| **Vector store** | **Amazon OpenSearch Serverless** | Best retrieval quality, supports metadata filtering. For a personal KB the cost is manageable with the low-OCU serverless model (~$3-7/day at minimal usage) |
| **Chunking strategy** | **Hierarchical chunking** | Bedrock KB now supports hierarchical chunking — parent + child chunks. This is the "parent document retriever" pattern we built manually in v1 Gap 6. Let Bedrock handle it. |
| **Parsing strategy** | **Bedrock Data Automation (BDA)** or **Foundation Model parsing** | For rich documents (PDFs, HTML emails), use FM-based parsing to extract clean text. Better than our naive `htmlToText()` regex. |
| **Metadata filtering** | S3 metadata sidecar files | Attach `source`, `date`, `people[]`, `conversationId` to each doc. Enables filtered retrieval ("emails from Sarah this week"). |

**Alternative — S3 as vector store**: If OpenSearch cost is a concern, Bedrock KB now offers S3-based vector storage. Cheaper but higher query latency. Could start here and upgrade to OpenSearch if retrieval speed matters.

**Sync strategy**: After uploading new content to S3, trigger a KB `StartIngestionJob` via the SDK. Can be done on-demand or on a schedule (e.g., after each polling cycle).

---

### Bedrock Agents — Conversational Tool Use

**What**: A Bedrock Agent wraps Claude with knowledge base access and custom action groups (tools).

**Why**: Replaces our custom agentic loop (`ragChatStream()` with 10-round tool iteration). The agent natively:
- Queries the KB for context (RAG)
- Calls action groups (tools) when needed
- Handles multi-turn conversation
- Manages the orchestration loop (when to retrieve, when to call tools, when to respond)

**Agent setup**:
- **Foundation model**: Claude 3.5 Sonnet v2 (or Claude 4 Sonnet when available)
- **Knowledge base**: Associate the Pepper KB for grounded retrieval
- **Instruction prompt**: Same system prompt from v1 — "You are Pepper, a personal assistant..." with persona and behavioral guidelines
- **Session management**: Use `sessionId` to maintain multi-turn conversations

**Action Groups** (tools the agent can invoke):

| Action Group | Actions | Implementation |
|---|---|---|
| **Todo Management** | `create_todo`, `list_todos`, `complete_todo`, `update_todo` | Lambda-less: Return control to app, mutate local SQLite |
| **Note Taking** | `create_note` | Upload to S3, trigger KB sync, record in local SQLite |
| **People Lookup** | `search_people`, `get_person_details` | Local SQLite query → return |
| **Email Draft** | `draft_email` | Save to local SQLite outbox |
| **Recent Activity** | `scan_recent` | S3 list + local metadata |

**Key architectural decision**: Use **Return of Control (ROC)** action groups where possible. Instead of deploying Lambda functions for each tool, the agent returns control to your Next.js app code, which executes the action locally and sends the result back. This means:
- No Lambda functions to deploy or manage
- Tools execute against your local SQLite just like v1
- The agent handles the "when to use which tool" orchestration
- You keep local control of all data mutations

---

### Bedrock LLM (Direct InvokeModel) — Extraction & Analysis

**What**: Direct Claude invocations for structured extraction tasks that don't need RAG or tools.

**Why**: Some tasks are pure extraction — no KB search needed, no tool calling. Cheaper and faster to call the model directly.

**Use cases**:
- **Todo extraction** from newly ingested emails/chats (batch analysis)
- **URL extraction and categorization** from content
- **People/entity extraction** from new content
- **Morning digest generation** (summarize recent activity)
- **Email classification** (actionable vs. informational vs. junk)

These run as background jobs (node-cron) in your Next.js app, just like v1.

---

### Other AWS Services

| Service | Use | Why |
|---|---|---|
| **IAM** | Your personal credentials for all SDK calls | No Cognito needed — it's your AWS account |
| **KMS** (optional) | Encrypt S3 bucket with a CMK | Defense in depth for personal data. SSE-S3 is fine too. |
| **CloudWatch** (automatic) | Bedrock invocation logs | Comes free with Bedrock usage. Useful for debugging. |

**Services we are NOT using**:

| Service | Why Not |
|---|---|
| API Gateway | No public API. Next.js API routes serve one user locally. |
| Lambda | Action groups use Return of Control. Extraction runs in Next.js. |
| DynamoDB | SQLite handles structured data (todos, people, sessions) locally. |
| Step Functions | node-cron handles scheduling. No complex orchestration. |
| EventBridge | No event-driven architecture needed for single user. |
| Cognito | No auth needed — it's your machine. |
| OpenSearch (standalone) | Bedrock KB manages the vector store internally. |
| ECS / Fargate | App runs locally with `npm run dev`. |

---

## Data Flow

### Ingestion Flow (Content → S3 → KB)

```
1. Polling (node-cron, every 5 min)
   ├── Microsoft Graph → emails, Teams messages
   ├── Edge History DB → browser visits
   └── Manual → file uploads, notes

2. Normalize (in Next.js)
   ├── Convert to canonical JSON
   ├── Extract metadata (from, to, date, people, conversationId)
   ├── Generate metadata sidecar for Bedrock KB filtering
   └── Compute content hash (SHA-256) for dedup

3. Upload to S3
   ├── PUT content JSON → s3://pepper-kb/emails/{id}.json
   ├── PUT metadata → s3://pepper-kb/metadata/{id}.metadata.json
   └── Record in local sync journal (SQLite)

4. Trigger KB Sync
   └── bedrock.startIngestionJob({ knowledgeBaseId, dataSourceId })

5. Background Analysis (direct InvokeModel, after upload)
   ├── Extract todos → save to local SQLite
   ├── Extract URLs → save to local SQLite
   ├── Extract people → save to local SQLite
   └── Classify content (actionable/informational/junk)
```

### Chat Flow (User → Agent → Response)

```
1. User sends message in chat panel

2. Next.js API route: POST /api/chat
   ├── Get or create sessionId
   └── Call bedrock-agent-runtime.invokeAgent({
         agentId, agentAliasId, sessionId,
         inputText: userMessage
       })

3. Bedrock Agent (managed orchestration)
   ├── Decides: does this need KB retrieval? → queries Pepper KB
   ├── Decides: does this need a tool? → returns control with action
   ├── App executes action locally (SQLite mutation)
   ├── App sends result back to agent
   └── Agent generates final response

4. Stream response back to chat panel (SSE)
   └── Display with citations from KB
```

### Background Jobs (node-cron)

| Job | Schedule | What It Does |
|---|---|---|
| Email poll | Every 5 min | Graph delta query → normalize → S3 upload → KB sync → extract todos/URLs/people |
| Teams poll | Every 5 min | Graph delta query → normalize → S3 upload → KB sync → extract todos/URLs/people |
| Edge history | Every 30 min | Read History DB → normalize → S3 upload → KB sync |
| Morning digest | Daily 7:00 AM | Direct InvokeModel to summarize yesterday's activity |
| Follow-up check | Every 15 min | Check for stale conversations awaiting reply |
| KB sync reconciliation | Every 2 hours | Ensure KB is in sync with S3 (catch any missed syncs) |

---

## What Stays Local (SQLite)

SQLite remains the local structured data store. It no longer holds content, embeddings, or vectors.

**Tables**:

| Table | Purpose |
|---|---|
| `todos` | Todo items (title, priority, status, source_card_id, created_at) |
| `urls` | Extracted URL references (url, title, category, source_id) |
| `people` | Extracted people entities (name, email, org, mention_count) |
| `card_people` | Many-to-many: which people appear in which S3 documents |
| `chat_sessions` | Conversation sessions (id, title, created_at) |
| `chat_messages` | Message history for UI display (role, content, session_id) |
| `outbox` | Draft emails/Teams messages awaiting approval |
| `tokens` | Encrypted OAuth tokens (AES-256-GCM) |
| `poll_watermarks` | Delta link tracking for Graph API polling |
| `sync_journal` | S3 upload tracking (content_hash, s3_key, uploaded_at) — dedup & idempotency |
| `settings` | App preferences |
| `dismiss_rules` | Sender/pattern rules for filtering noise |
| `follow_ups` | Conversations awaiting reply |

**What's gone from SQLite**: `cards`, `card_embeddings`, `card_chunks`, `cards_fts` — all replaced by S3 + Bedrock KB.

---

## Cost Estimate (Personal Usage)

| Service | Monthly Estimate | Notes |
|---|---|---|
| **S3 storage** | < $0.10 | Personal email/chat volume is trivially small |
| **Bedrock KB (OpenSearch Serverless)** | $90–$210 | 0.5 OCU minimum × 2 (indexing + search) = ~$3.50–$7/day. This is the biggest cost. |
| **Bedrock KB (S3 vector store)** | $5–$15 | Much cheaper alternative. Higher query latency (~2-5s). |
| **Bedrock LLM (Claude Sonnet)** | $5–$20 | ~50-100 chat queries/day + background extraction jobs |
| **Bedrock Titan Embeddings** | $1–$3 | Embedding new content only (not re-embedding existing) |
| **Bedrock Agent invocations** | included in LLM cost | Agent orchestration is free; you pay for underlying model calls |
| **Total (OpenSearch)** | **~$100–$235/mo** | Premium option, fast retrieval |
| **Total (S3 Vector Store)** | **~$12–$40/mo** | Budget option, acceptable latency for personal use |

**Recommendation**: Start with **S3 as the vector store** to keep costs low. It's ~$15/mo vs ~$150/mo. Query latency of 2-5s is fine for a personal assistant — you're not running a production API. Upgrade to OpenSearch only if retrieval speed becomes annoying.

---

## Migration Strategy (v1 → v2)

### What We Keep (Copy Forward)

| Component | Notes |
|---|---|
| Next.js project structure | Same monolithic layout |
| UI components | Chat panel, todo panel, URL directory, people panel, digest, settings |
| Microsoft Graph integration | MSAL auth, email polling, Teams polling — unchanged |
| Edge history import | Same Chromium SQLite reader |
| Tailwind styling | Same UI look and feel |
| Zod validation | Same input validation patterns |
| Pino logging | Same structured logging |
| Security hardening | Token encryption, CSP headers, rate limiting, CSRF — carry forward |
| node-cron scheduler | Same background job pattern |
| OAuth token management | Same encrypted token storage |

### What We Replace

| v1 Component | v2 Replacement |
|---|---|
| `cards` table (SQLite) | S3 objects (JSON files) |
| `card_embeddings` table | Bedrock KB managed embeddings |
| `card_chunks` table | Bedrock KB hierarchical chunking |
| `cards_fts` (FTS5) | Bedrock KB semantic + keyword search |
| `sqlite-vec` ANN search | Bedrock KB vector retrieval |
| `rag.ts` (entire file) | Bedrock KB `Retrieve` / `RetrieveAndGenerate` API |
| `embeddings.ts` | Deleted — Bedrock handles embedding |
| `ragChatStream()` agentic loop | Bedrock Agent `InvokeAgent` |
| `chat-tools.ts` tool dispatch | Bedrock Agent action groups (Return of Control) |
| `retrieveContext()` + RRF fusion | Bedrock KB managed retrieval |
| `rewriteQueryForRetrieval()` | Bedrock Agent handles query understanding |
| `decomposeQuery()` | Bedrock KB metadata filtering |
| `rerankWithLLM()` | Bedrock KB built-in ranking |
| `applyRecencyBoost()` | Metadata filter on date ranges |
| `buildEmbeddingText()` | Bedrock KB document parsing + metadata |

### What We Add (New)

| Component | Purpose |
|---|---|
| `src/lib/s3-client.ts` | S3 upload/list/delete operations |
| `src/lib/bedrock-kb.ts` | Knowledge Base sync, retrieve, retrieve-and-generate |
| `src/lib/bedrock-agent.ts` | Agent invocation, session management, ROC handling |
| `src/lib/bedrock-llm.ts` | Direct InvokeModel for extraction tasks |
| `sync_journal` table | Track what's been uploaded to S3 (dedup) |
| Metadata sidecar generation | Create `.metadata.json` files for KB filtering |

---

## Execution Plan

### Phase 0: AWS Infrastructure Setup
> One-time setup. No Terraform/CDK needed — AWS Console or CLI is fine for a personal project.

- [ ] Create S3 bucket (`pepper-kb-{account-id}`) with SSE-S3 encryption
- [ ] Enable Bedrock model access (Claude Sonnet, Titan Embeddings V2) in your region
- [ ] Create Bedrock Knowledge Base
  - Data source: S3 bucket
  - Vector store: S3 (start cheap) or OpenSearch Serverless
  - Chunking: Hierarchical (parent 1500 tokens, child 300 tokens)
  - Embedding model: Titan V2
  - Metadata: Enable attribute filtering
- [ ] Create Bedrock Agent
  - Model: Claude Sonnet
  - Associate Knowledge Base
  - Define action groups (todo, note, people, email, recent) with Return of Control
  - Write agent instruction prompt
- [ ] Create IAM user/role with scoped permissions (S3, Bedrock) — no admin access
- [ ] Test: upload a sample doc to S3, sync KB, query it, invoke agent

### Phase 1: Project Scaffolding & S3 Ingestion
> New Next.js project with S3 upload pipeline. No UI yet.

- [ ] Initialize Next.js + TypeScript project (or fork Pepper v1 UI shell)
- [ ] Set up AWS SDK v3 clients (`@aws-sdk/client-s3`, `@aws-sdk/client-bedrock-agent-runtime`, `@aws-sdk/client-bedrock-runtime`)
- [ ] Implement `s3-client.ts` — upload, list, delete, presigned URLs
- [ ] Implement `sync-journal` SQLite table — content hash tracking for dedup
- [ ] Implement content normalizer — convert email/Teams/notes to canonical JSON + metadata sidecar
- [ ] Implement S3 upload pipeline — normalize → hash check → upload content + metadata → record in journal
- [ ] Wire up Microsoft Graph polling → S3 upload (email + Teams)
- [ ] Wire up Edge history import → S3 upload
- [ ] Wire up manual note/file upload → S3 upload
- [ ] Trigger `StartIngestionJob` after each upload batch
- [ ] Test: poll real emails, verify they land in S3, KB syncs and indexes them

### Phase 2: Chat with Bedrock Agent
> Core RAG + conversational experience.

- [ ] Implement `bedrock-agent.ts` — `invokeAgent()` with streaming, session management
- [ ] Implement Return of Control handler — dispatch agent action requests to local functions
- [ ] Implement agent action executors: `create_todo`, `list_todos`, `create_note`, `search_people`, `draft_email`, `scan_recent`
- [ ] Build chat API route (`POST /api/chat`) — stream agent responses via SSE
- [ ] Build chat UI — reuse v1 chat panel component
- [ ] Implement chat session persistence (SQLite)
- [ ] Test: ask questions about ingested content, verify KB retrieval + citations
- [ ] Test: tool calling works ("create a todo for X" → agent invokes action → local SQLite mutated)

### Phase 3: Background Intelligence
> Extract structured data from content using direct LLM calls.

- [ ] Implement `bedrock-llm.ts` — direct `InvokeModel` for extraction
- [ ] Implement todo extraction pipeline — batch new S3 content → Claude extracts action items → SQLite
- [ ] Implement URL extraction + categorization pipeline
- [ ] Implement people/entity extraction pipeline
- [ ] Implement follow-up detection (stale conversations)
- [ ] Set up node-cron scheduler for all background jobs
- [ ] Implement morning digest generation
- [ ] Test: ingest emails with action items, verify todos are auto-created

### Phase 4: Full UI
> Bring over and adapt Pepper v1 UI components.

- [ ] Todo panel — checkbox list, filters, AI suggestions, follow-ups
- [ ] URL directory — searchable, categorized
- [ ] People panel — list, detail view, related content
- [ ] Digest panel — daily summary with stats
- [ ] File ingest UI — drag-and-drop upload
- [ ] Note input UI
- [ ] Settings panel — AWS config display, MS auth
- [ ] Collapsible/expandable chat panel (1/3 → full → hidden)
- [ ] Keyboard shortcuts (Cmd+K, Cmd+N, Cmd+J, Cmd+1/2/3)
- [ ] Dark mode

### Phase 5: Polish & Daily Driver
> Make it reliable enough to use every day.

- [ ] Chat streaming quality — handle agent response chunks cleanly
- [ ] Citation display — show KB source references in chat responses
- [ ] Error handling — graceful degradation when AWS is unreachable
- [ ] Retry logic — exponential backoff on SDK calls
- [ ] Sync status indicator — show when KB is syncing, how fresh the data is
- [ ] Performance tuning — batch S3 uploads, optimize KB sync frequency
- [ ] Outbox workflow — draft → approve → send emails
- [ ] Dismiss rules — filter noise from automated senders
- [ ] Data export — dump SQLite + list S3 contents for backup

---

## Key Technical Decisions

### ADR-001: S3 Vector Store Over OpenSearch Serverless
**Decision**: Start with S3 as the KB vector store.
**Rationale**: OpenSearch Serverless minimum is ~$3.50–$7/day ($100–$210/mo). S3 vector store is ~$0.50/day. For a personal app with <100 queries/day, 2-5s latency is acceptable. Upgrade path to OpenSearch exists if needed.

### ADR-002: Bedrock Agent with Return of Control (No Lambda)
**Decision**: Use Return of Control for agent action groups instead of Lambda functions.
**Rationale**: Keeps all data mutations local. No Lambda to deploy/manage/pay for. Tools execute in the same Next.js process. Agent still handles orchestration logic.

### ADR-003: SQLite for Structured Data, S3 for Content
**Decision**: SQLite keeps todos, people, sessions, settings. S3 keeps ingested content (emails, notes, documents).
**Rationale**: Todos and people are rapidly mutated structured data — SQLite is perfect. Content is write-once, read-via-KB — S3 is perfect. Clean separation of concerns.

### ADR-004: Direct InvokeModel for Extraction, Agent for Chat
**Decision**: Background extraction jobs (todos, URLs, people) call Claude directly. Interactive chat goes through the Bedrock Agent.
**Rationale**: Extraction is a stateless batch operation — no KB retrieval needed, no tools needed. Agent adds overhead (session management, orchestration) that extraction doesn't need. Cheaper and faster to call the model directly.

### ADR-005: Keep Microsoft Graph Integration Unchanged
**Decision**: Carry forward the MSAL + Graph polling code from v1 with minimal changes.
**Rationale**: It works. OAuth, delta queries, email/Teams parsing — all battle-tested. Only change is the output destination (S3 instead of SQLite cards table).

### ADR-006: No IaC for Personal Project
**Decision**: Set up AWS resources via Console/CLI, not Terraform/CDK.
**Rationale**: It's one S3 bucket, one KB, one Agent. Infrastructure-as-code is overhead for a personal project with ~5 resources. Document the setup steps instead.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js + TypeScript |
| **UI** | React + Tailwind CSS |
| **Local DB** | SQLite (better-sqlite3) — structured data only |
| **Cloud Storage** | Amazon S3 |
| **RAG** | Amazon Bedrock Knowledge Bases (S3 vector store) |
| **Agent** | Amazon Bedrock Agents (Claude Sonnet + Return of Control) |
| **LLM** | Amazon Bedrock — Claude Sonnet (via Agent + direct InvokeModel) |
| **Embeddings** | Amazon Bedrock — Titan Embeddings V2 (managed by KB) |
| **Auth (MS 365)** | MSAL (OAuth 2.0 + PKCE) |
| **AWS SDK** | `@aws-sdk/client-s3`, `@aws-sdk/client-bedrock-agent-runtime`, `@aws-sdk/client-bedrock-runtime` |
| **Scheduling** | node-cron |
| **Validation** | Zod |
| **Logging** | Pino |
| **Testing** | Vitest |

---

## What We're NOT Building

- ❌ API Gateway — no public API, it's localhost
- ❌ Lambda functions — Return of Control keeps tools local
- ❌ DynamoDB — SQLite for structured data
- ❌ Step Functions — node-cron for scheduling
- ❌ EventBridge — no event-driven architecture
- ❌ Cognito — no auth, it's your machine
- ❌ CloudFormation / CDK / Terraform — ~5 resources, use Console
- ❌ Multi-user / multi-tenant — personal tool
- ❌ Custom embedding pipeline — Bedrock KB handles it
- ❌ Custom chunking code — Bedrock KB hierarchical chunking
- ❌ Custom vector storage — Bedrock KB manages vectors
- ❌ Custom retrieval/reranking — Bedrock KB handles retrieval

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Bedrock KB retrieval quality is poor (like v1) | HIGH | Hierarchical chunking + metadata filtering is significantly more advanced than when we first tried it. Test early in Phase 0. If still poor, fall back to OpenSearch Serverless or managed Kendra. |
| S3 vector store latency is too slow | MEDIUM | Accept 2-5s for chat. If unacceptable, upgrade to OpenSearch Serverless (~$150/mo). |
| Agent orchestration makes wrong tool choices | MEDIUM | Write detailed agent instructions. Review agent trace logs. Fall back to direct KB `RetrieveAndGenerate` for simple Q&A if agent adds too much latency/error. |
| Monthly cost exceeds budget | LOW | S3 vector store path is ~$15-40/mo. Monitor via AWS Cost Explorer. Set billing alarm. |
| KB sync lag (content not immediately searchable) | LOW | Trigger sync after each upload batch. Accept 1-5 min delay for new content to be searchable. Show sync status in UI. |
| AWS SDK version churn | LOW | Pin SDK versions. Update quarterly. |

---

## Success Criteria

1. **Chat with grounded retrieval**: Ask "what did Daniel say about the Q3 budget?" and get an answer grounded in actual email content, with citations
2. **Auto-generated todos**: New emails with action items automatically produce todo suggestions in the UI
3. **Filtered retrieval**: Ask "emails from Sarah this week" and get only Sarah's recent emails — not everything mentioning budgets
4. **Tool calling via agent**: Say "remind me to review the proposal" and a todo appears in the panel
5. **Cost under $50/mo**: Using S3 vector store, personal usage should stay well under $50/mo
6. **Sub-5s chat response**: Agent responses stream within 5 seconds for typical queries
7. **Daily driver**: Use it every workday for 2 weeks without needing to fall back to email/Teams apps for recall
