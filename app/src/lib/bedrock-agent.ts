import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import logger from './logger';

const client = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION ?? 'us-west-2' });

function getAgentId(): string {
  const id = process.env.BEDROCK_AGENT_ID;
  if (!id) throw new Error('BEDROCK_AGENT_ID environment variable is required');
  return id;
}

function getAgentAliasId(): string {
  const id = process.env.BEDROCK_AGENT_ALIAS_ID;
  if (!id) throw new Error('BEDROCK_AGENT_ALIAS_ID environment variable is required');
  return id;
}

// === Types for Return of Control ===

export interface AgentActionRequest {
  actionGroup: string;
  function: string;
  parameters: Record<string, string>;
  invocationId: string;
}

export type AgentChunk =
  | { type: 'text'; content: string }
  | { type: 'action'; action: AgentActionRequest }
  | { type: 'citation'; text: string; location?: string };

/**
 * Invoke the Bedrock Agent and yield streaming chunks.
 * Handles Return of Control (ROC) — when the agent wants to call a tool,
 * it yields an 'action' chunk. The caller must execute the action and call
 * continueAgent() with the result.
 */
export async function* invokeAgent(
  inputText: string,
  sessionId: string,
): AsyncGenerator<AgentChunk> {
  const response = await client.send(new InvokeAgentCommand({
    agentId: getAgentId(),
    agentAliasId: getAgentAliasId(),
    sessionId,
    inputText,
  }));

  if (!response.completion) {
    throw new Error('No completion stream from Bedrock Agent');
  }

  for await (const event of response.completion) {
    if (event.chunk) {
      const text = new TextDecoder().decode(event.chunk.bytes);
      if (text) yield { type: 'text', content: text };

      // Extract citations from the chunk attribution
      if (event.chunk.attribution?.citations) {
        for (const citation of event.chunk.attribution.citations) {
          for (const ref of citation.retrievedReferences ?? []) {
            yield {
              type: 'citation',
              text: ref.content?.text ?? '',
              location: ref.location?.s3Location?.uri,
            };
          }
        }
      }
    }

    if (event.returnControl) {
      const invocation = event.returnControl.invocationInputs?.[0]?.functionInvocationInput;
      if (invocation) {
        const params: Record<string, string> = {};
        for (const p of invocation.parameters ?? []) {
          if (p.name && p.value) params[p.name] = p.value;
        }

        yield {
          type: 'action',
          action: {
                   actionGroup: invocation.actionGroup ?? '',
            function: invocation.function ?? '',
            parameters: params,
            invocationId: event.returnControl.invocationId ?? '',
          },
        };
      }
    }
  }

  logger.debug({ sessionId }, 'Agent invocation complete');
}

/**
 * Continue an agent session after executing a Return of Control action.
 * Sends the action result back and yields the remaining response.
 */
export async function* continueAgent(
  sessionId: string,
  invocationId: string,
  actionGroup: string,
  functionName: string,
  result: string,
): AsyncGenerator<AgentChunk> {
  const response = await client.send(new InvokeAgentCommand({
    agentId: getAgentId(),
    agentAliasId: getAgentAliasId(),
    sessionId,
    sessionState: {
      invocationId,
      returnControlInvocationResults: [{
        functionResult: {
          actionGroup,
          function: functionName,
          responseBody: {
            TEXT: { body: result },
          },
        },
      }],
    },
  }));

  if (!response.completion) return;

  for await (const event of response.completion) {
    if (event.chunk) {
      const text = new TextDecoder().decode(event.chunk.bytes);
      if (text) yield { type: 'text', content: text };

      if (event.chunk.attribution?.citations) {
        for (const citation of event.chunk.attribution.citations) {
          for (const ref of citation.retrievedReferences ?? []) {
            yield {
              type: 'citation',
              text: ref.content?.text ?? '',
              location: ref.location?.s3Location?.uri,
            };
          }
        }
      }
    }

    // Agent might request another action (multi-step)
    if (event.returnControl) {
      const invocation = event.returnControl.invocationInputs?.[0]?.functionInvocationInput;
      if (invocation) {
        const params: Record<string, string> = {};
        for (const p of invocation.parameters ?? []) {
          if (p.name && p.value) params[p.name] = p.value;
        }

        yield {
          type: 'action',
          action: {
            actionGroup: invocation.actionGroup ?? '',
            function: invocation.function ?? '',
            parameters: params,
            invocationId: event.returnControl.invocationId ?? '',
          },
        };
      }
    }
  }
}
