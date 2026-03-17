# Pepper AWS — Setup & Configuration Guide

> Everything you need to create and configure in AWS (and Azure AD) before running the app.
>
> Convention: all resources use the prefix **`pepper-`** so they're easy to find and clean up.

---

## 1. AWS IAM — Your Credentials

The app runs locally on your Mac and authenticates to AWS via IAM credentials. No Cognito, no API Gateway.

### Option A: Use `~/.aws/credentials` (recommended)

```ini
# ~/.aws/credentials
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

### Option B: Environment variables in `.env.local`

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-west-2
```

### IAM Policy

Create a dedicated IAM user (or use your existing one) with the following permissions. You can attach these as an inline policy named **`pepper-local-app`**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PepperS3",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::pepper-kb-data",
        "arn:aws:s3:::pepper-kb-data/*"
      ]
    },
    {
      "Sid": "PepperBedrockModels",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-20250514",
        "arn:aws:bedrock:us-west-2::foundation-model/amazon.titan-embed-text-v2*"
      ]
    },
    {
      "Sid": "PepperBedrockAgent",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeAgent",
        "bedrock:GetAgent",
        "bedrock:GetAgentAlias"
      ],
      "Resource": "arn:aws:bedrock:us-west-2:*:agent/*"
    },
    {
      "Sid": "PepperBedrockKB",
      "Effect": "Allow",
      "Action": [
        "bedrock:Retrieve",
        "bedrock:RetrieveAndGenerate",
        "bedrock:StartIngestionJob",
        "bedrock:GetIngestionJob",
        "bedrock:GetKnowledgeBase"
      ],
      "Resource": "arn:aws:bedrock:us-west-2:*:knowledge-base/*"
    }
  ]
}
```

> All ARNs above use `us-west-2`. Adjust if you change regions.

---

## 2. S3 Bucket — Content Storage

| Setting | Value |
|---|---|
| **Bucket name** | `pepper-kb-data` |
| **Region** | `us-west-2` |
| **Versioning** | Disabled (not needed) |
| **Encryption** | SSE-S3 (default) or SSE-KMS if you prefer |
| **Public access** | All blocked (default) |

### Create via CLI

```bash
aws s3 mb s3://pepper-kb-data --region us-west-2
```

### Bucket structure (created automatically by the app)

```
pepper-kb-data/
├── emails/{messageId}.json
├── emails/{messageId}.json.metadata.json
├── teams/{chatId}/{messageId}.json
├── teams/{chatId}/{messageId}.json.metadata.json
├── notes/{noteId}.json
├── notes/{noteId}.json.metadata.json
├── documents/{docId}.json
├── documents/{docId}.json.metadata.json
└── browser/{visitId}.json
    browser/{visitId}.json.metadata.json
```

Each `.metadata.json` sidecar file contains filterable attributes for Bedrock KB (source type, date, people, etc.).

---

## 3. Bedrock Model Access — Foundation Models

As of 2025, serverless foundation models are **automatically enabled** across all AWS commercial regions on first invocation — no manual activation required. The manual "Model access" page has been retired.

| Model | Model ID | Purpose |
|---|---|---|
| **Claude Sonnet 4** | `anthropic.claude-sonnet-4-20250514` | Chat, agent orchestration, extraction tasks |
| **Titan Text Embeddings V2** | `amazon.titan-embed-text-v2:0` | Embedding model for Knowledge Base |

> **Note:** First-time Anthropic users may need to submit use case details before access is granted. If prompted, fill out the form — approval is typically instant. Otherwise, just ensure your IAM policy (Step 1) includes `bedrock:InvokeModel` permissions and proceed to Step 4.

---

## 4. Bedrock Knowledge Base — Managed RAG

### Create Knowledge Base

| Setting | Value |
|---|---|
| **Name** | `pepper-knowledge-base` |
| **Description** | `Pepper personal assistant knowledge base — emails, notes, chats, browser history` |
| **IAM role** | Create new (auto-generated, e.g. `AmazonBedrockExecutionRoleForKnowledgeBase_pepper`) |
| **Embedding model** | Amazon Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`, 1024 dimensions) |

### Data Source

| Setting | Value |
|---|---|
| **Name** | `pepper-s3-source` |
| **Source type** | Amazon S3 |
| **S3 URI** | `s3://pepper-kb-data/` |
| **Chunking strategy** | Hierarchical chunking (parent: 1500 tokens, child: 300 tokens) — or Default if unavailable |
| **Parsing strategy** | Default (no need for FM parser — the app writes clean JSON) |

> **Metadata**: No toggle needed. Bedrock KB automatically detects `.metadata.json` sidecar files next to your data files in S3. The app creates these automatically.

### Vector Store

| Setting | Value |
|---|---|
| **Type** | Quick create with Amazon OpenSearch Serverless — **OR** — Amazon S3 (vector store) |

**Recommended**: Start with **S3 as vector store** to keep costs under ~$15/mo. Switch to OpenSearch Serverless later if query latency (2–5s) becomes an issue (but costs ~$100–200/mo).

### After creation, note these IDs:

```
Knowledge Base ID  → BEDROCK_KB_ID          (e.g., ABCDEFGHIJ)
Data Source ID     → BEDROCK_KB_DATA_SOURCE_ID  (e.g., KLMNOPQRST)
```

---

## 5. Bedrock Agent — Conversational Assistant

### Create Agent

| Setting | Value |
|---|---|
| **Name** | `pepper-agent` |
| **Description** | `Pepper personal assistant — manages knowledge, todos, email drafts, and notes` |
| **Foundation model** | Anthropic Claude Sonnet 4 (`anthropic.claude-sonnet-4-20250514`) |
| **Idle session timeout** | 30 minutes |

### Agent Instructions (system prompt)

Paste this into the **Instructions** field:

```
You are Pepper, a personal AI assistant. You help the user manage their knowledge, emails, Teams messages, todos, and notes.

Behavioral guidelines:
- Be concise and direct. The user is a professional and prefers brief answers.
- When the user asks about something, search their knowledge base first before answering.
- When you identify action items, offer to create todos.
- When drafting emails or Teams messages, always save them to the outbox for review — never claim you sent them.
- If the user asks you to remember something, create a note.
- Cite your sources when referencing stored knowledge.
```

### Associate Knowledge Base

| Setting | Value |
|---|---|
| **Knowledge base** | `pepper-knowledge-base` (the one from step 4) |
| **KB instruction** | `Use this knowledge base to search the user's emails, Teams chats, notes, documents, and browser history. Always search here when the user asks about their data.` |

### Action Groups (Return of Control)

Create **one** action group with ROC (Return of Control) — no Lambda needed:

| Setting | Value |
|---|---|
| **Action group name** | `pepper-tools` |
| **Action group type** | Return control (the app handles execution) |

Define these functions in the action group:

#### `searchKnowledge`
> Search the user's knowledge base for relevant documents.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | The search query |
| `limit` | integer | No | Max results to return (default 5, max 50) |

#### `createNote`
> Save a note to the user's knowledge base.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Note title |
| `content` | string | Yes | Note body content |
| `tags` | array of string | No | Tags for categorization |

#### `draftEmail`
> Draft an email and save it to the outbox for user review.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `to` | array of string | No | Recipient email addresses |
| `subject` | string | Yes | Email subject |
| `body` | string | Yes | Email body content |

#### `draftTeamsMessage`
> Draft a Teams message and save it to the outbox for user review.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | Message content |

#### `createTodo`
> Create a new todo item.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Todo title |
| `description` | string | No | Additional details |
| `priority` | string | No | `high`, `medium`, or `low` |
| `dueDate` | string | No | Due date (ISO 8601) |

#### `completeTodo`
> Mark a todo item as done.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `todoId` | string | Yes | The ID of the todo to complete |

#### `listTodos`
> List the user's todo items.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | Filter: `open`, `done`, or `cancelled` |
| `limit` | integer | No | Max results (default 20, max 50) |

### Create an Alias

After saving the agent, create an alias:

| Setting | Value |
|---|---|
| **Alias name** | `live` |
| **Description** | `Production alias for Pepper app` |
| **Version** | Associate with latest draft or a specific version |

### After creation, note these IDs:

```
Agent ID       → BEDROCK_AGENT_ID        (e.g., UVWXYZ1234)
Agent Alias ID → BEDROCK_AGENT_ALIAS_ID  (e.g., ALIAS56789)
```

---

## 6. Azure AD App Registration — Microsoft 365 OAuth

This is identical to v1. Register an app for accessing Email and Teams via Microsoft Graph.

### Create at [portal.azure.com → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)

| Setting | Value |
|---|---|
| **Name** | `Pepper Assistant` |
| **Supported account types** | Personal Microsoft accounts (or your org) |
| **Redirect URI (Web)** | `http://localhost:3000/api/auth/microsoft/callback` |

### After creation:

1. Go to **Certificates & secrets** → New client secret → copy the value
2. Note the **Application (client) ID** and **Directory (tenant) ID**

```
Client ID      → entered in the app's Settings UI
Tenant ID      → entered in the app's Settings UI ("consumers" for personal)
Client Secret  → MS_CLIENT_SECRET in .env.local
```

### API Permissions (delegated)

| Permission | Type | Required for |
|---|---|---|
| `Mail.Read` | Delegated | Reading emails |
| `Chat.Read` | Delegated | Reading Teams chats |
| `User.Read` | Delegated | User profile info |
| `Mail.ReadWrite` | Delegated | Sending email — requires org admin approval |
| `Chat.ReadWrite` | Delegated | Sending Teams messages — requires org admin approval |

> **Note:** If your org restricts `Mail.ReadWrite` / `Chat.ReadWrite`, skip those. Pepper will still poll and ingest emails/Teams messages. Drafted emails and messages will be saved to the outbox for you to copy/paste and send manually.

---

## 7. Complete `.env.local`

```env
# Microsoft OAuth
MS_CLIENT_SECRET=<your-azure-ad-client-secret>

# Token encryption (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
TOKEN_ENCRYPTION_KEY=<64-hex-chars>

# AWS
AWS_REGION=us-west-2
# Uncomment if not using ~/.aws/credentials:
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...

# S3
S3_BUCKET_NAME=pepper-kb-data

# Bedrock Knowledge Base
BEDROCK_KB_ID=<from step 4>
BEDROCK_KB_DATA_SOURCE_ID=<from step 4>

# Bedrock Agent
BEDROCK_AGENT_ID=<from step 5>
BEDROCK_AGENT_ALIAS_ID=<from step 5>

# Logging
LOG_LEVEL=info
```

---

## Quick Reference — Resource Names

| Resource | Name / ID | Where used |
|---|---|---|
| S3 bucket | `pepper-kb-data` | `S3_BUCKET_NAME` |
| Knowledge Base | `pepper-knowledge-base` | `BEDROCK_KB_ID` |
| KB Data Source | `pepper-s3-source` | `BEDROCK_KB_DATA_SOURCE_ID` |
| Bedrock Agent | `pepper-agent` | `BEDROCK_AGENT_ID` |
| Agent Alias | `live` | `BEDROCK_AGENT_ALIAS_ID` |
| Agent Action Group | `pepper-tools` | Configured in agent console |
| IAM Policy | `pepper-local-app` | Attached to your IAM user |
| Azure AD App | `Pepper Assistant` | MS_CLIENT_SECRET + Settings UI |
| Foundation Model | `anthropic.claude-sonnet-4-20250514` | Hardcoded in app |
| Embedding Model | `amazon.titan-embed-text-v2:0` | Selected during KB creation |

---

## Setup Order

1. **Enable model access** in Bedrock console (Claude Sonnet 4 + Titan Embeddings V2)
2. **Create S3 bucket** `pepper-kb-data`
3. **Create Knowledge Base** `pepper-knowledge-base` with S3 data source `pepper-s3-source`
4. **Create Agent** `pepper-agent` with instructions, KB association, and `pepper-tools` action group
5. **Create Agent Alias** `live`
6. **Configure IAM** — attach `pepper-local-app` policy to your user
7. **Register Azure AD app** `Pepper Assistant` (if not already done from v1)
8. **Fill in `.env.local`** with all the IDs
9. **`npm install && npm run dev`**
10. **Open Settings** in the app → Add your Microsoft account → Connect
