import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveAndGenerateCommand,
  type RetrievalResultLocation,
  type KnowledgeBaseRetrievalResult,
} from '@aws-sdk/client-bedrock-agent-runtime';
import logger from './logger';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const RAG_MODEL = process.env.BEDROCK_RAG_MODEL ?? 'us.anthropic.claude-sonnet-4-20250514-v1:0';

const agentClient = new BedrockAgentClient({ region: REGION });
const runtimeClient = new BedrockAgentRuntimeClient({ region: REGION });

function getKbId(): string {
  const id = process.env.BEDROCK_KB_ID;
  if (!id) throw new Error('BEDROCK_KB_ID environment variable is required');
  return id;
}

function getDataSourceId(): string {
  const id = process.env.BEDROCK_KB_DATA_SOURCE_ID;
  if (!id) throw new Error('BEDROCK_KB_DATA_SOURCE_ID environment variable is required');
  return id;
}

// === Ingestion (sync S3 → KB) ===

export async function startKbSync(): Promise<string> {
  return startKbSyncWithRetry(0);
}

async function startKbSyncWithRetry(attempt: number): Promise<string> {
  try {
    const response = await agentClient.send(new StartIngestionJobCommand({
      knowledgeBaseId: getKbId(),
      dataSourceId: getDataSourceId(),
    }));

    const jobId = response.ingestionJob?.ingestionJobId;
    if (!jobId) throw new Error('Failed to start KB ingestion job');

    logger.info({ jobId }, 'Started KB ingestion sync');
    return jobId;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'ConflictException') {
      if (attempt < 3) {
        const delayMs = (attempt + 1) * 30_000; // 30s, 60s, 90s
        logger.info({ attempt: attempt + 1, delayMs }, 'KB sync already in progress, will retry');
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return startKbSyncWithRetry(attempt + 1);
      }
      logger.warn('KB sync conflict persisted after 3 retries, giving up');
      return 'ALREADY_RUNNING';
    }
    throw err;
  }
}

export async function getKbSyncStatus(jobId: string): Promise<string> {
  const response = await agentClient.send(new GetIngestionJobCommand({
    knowledgeBaseId: getKbId(),
    dataSourceId: getDataSourceId(),
    ingestionJobId: jobId,
  }));

  return response.ingestionJob?.status ?? 'UNKNOWN';
}

// === Retrieval ===

export interface KbRetrievalResult {
  content: string;
  location?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Retrieve relevant documents from the Knowledge Base.
 */
export async function retrieve(
  query: string,
  options?: {
    topK?: number;
    filters?: Record<string, unknown>;
  },
): Promise<KbRetrievalResult[]> {
  return retrieveFromKb(getKbId(), query, options);
}

/**
 * Retrieve relevant documents from a specific Knowledge Base by ID.
 */
export async function retrieveFromKb(
  knowledgeBaseId: string,
  query: string,
  options?: {
    topK?: number;
    filters?: Record<string, unknown>;
  },
): Promise<KbRetrievalResult[]> {
  const response = await runtimeClient.send(new RetrieveCommand({
    knowledgeBaseId,
    retrievalQuery: { text: query },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: options?.topK ?? 10,
        ...(options?.filters ? { filter: options.filters as never } : {}),
      },
    },
  }));

  return (response.retrievalResults ?? []).map((r: KnowledgeBaseRetrievalResult) => ({
    content: r.content?.text ?? '',
    location: getLocationUri(r.location),
    score: r.score,
    metadata: r.metadata as Record<string, unknown> | undefined,
  }));
}

function getLocationUri(location?: RetrievalResultLocation): string | undefined {
  if (!location) return undefined;
  if (location.s3Location) return location.s3Location.uri;
  return undefined;
}

/**
 * Retrieve + Generate: RAG query that returns a grounded LLM response with citations.
 */
export async function retrieveAndGenerate(
  query: string,
  sessionId?: string,
): Promise<{
  output: string;
  citations: Array<{
    text: string;
    location?: string;
  }>;
  sessionId?: string;
}> {
  const response = await runtimeClient.send(new RetrieveAndGenerateCommand({
    input: { text: query },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId: getKbId(),
        modelArn: RAG_MODEL,
      },
    },
    ...(sessionId ? { sessionId } : {}),
  }));

  const citations = (response.citations ?? []).flatMap(c =>
    (c.retrievedReferences ?? []).map(ref => ({
      text: ref.content?.text ?? '',
      location: getLocationUri(ref.location),
    }))
  );

  return {
    output: response.output?.text ?? '',
    citations,
    sessionId: response.sessionId,
  };
}
