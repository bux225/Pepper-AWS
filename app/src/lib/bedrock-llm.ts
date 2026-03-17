import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import logger from './logger';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-west-2' });

const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Call Claude directly via Bedrock InvokeModel.
 * Use for extraction tasks that don't need RAG or tools.
 */
export async function invokeModel(
  messages: LlmMessage[],
  options?: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  },
): Promise<string> {
  const model = options?.model ?? DEFAULT_MODEL;

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.3,
    ...(options?.system ? { system: options.system } : {}),
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  });

  const response = await client.send(new InvokeModelCommand({
    modelId: model,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  const text = result.content?.[0]?.text ?? '';

  logger.debug({ model, inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens }, 'InvokeModel complete');

  return text;
}

/**
 * Extract structured JSON from content using Claude.
 * Parses the response and returns the parsed object.
 */
export async function extractJson<T>(
  systemPrompt: string,
  userContent: string,
  options?: { maxTokens?: number },
): Promise<T> {
  const response = await invokeModel(
    [{ role: 'user', content: userContent }],
    {
      system: systemPrompt + '\n\nRespond with valid JSON only. No markdown, no explanation.',
      maxTokens: options?.maxTokens ?? 4096,
      temperature: 0.1,
    },
  );

  // Strip markdown code fences if present
  const cleaned = response.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(cleaned) as T;
}
