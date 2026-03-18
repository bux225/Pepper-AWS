export const runtime = 'nodejs';
import { NextRequest } from 'next/server';
import { chatSchema } from '@/lib/validation';
import { invokeAgent, continueAgent, type AgentChunk } from '@/lib/bedrock-agent';
import { handleAction } from '@/lib/action-handlers';
import { createSession, addMessage, autoTitleSession, getMessages } from '@/lib/chat-history';
import logger from '@/lib/logger';

/**
 * POST /api/chat
 *
 * Streams an agent response via Server-Sent Events.
 * Handles Bedrock Agent Return-of-Control (ROC) by executing tools locally
 * and continuing the agent conversation.
 *
 * Body: { message: string, sessionId?: string }
 * Response: SSE stream with events: text, citation, action, done, error
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('sessionId') ?? undefined;

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { message } = parsed.data;

  // Create or resume session
  const chatSessionId = sessionId ?? createSession().id;

  // Save user message
  addMessage(chatSessionId, 'user', message);

  // Build context from recent history for the agent prompt
  const history = getMessages(chatSessionId);
  const contextMessages = history.slice(-10); // last 10 messages for context
  const prompt = contextMessages.length > 1
    ? contextMessages.map(m => `${m.role}: ${m.content}`).join('\n') + `\nuser: ${message}`
    : message;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        let fullResponse = '';
        const MAX_ROC_DEPTH = 15;
        let rocCount = 0;

        // Process agent stream, handling ROC loops
        async function processStream(chunks: AsyncGenerator<AgentChunk>) {
          for await (const chunk of chunks) {
            switch (chunk.type) {
              case 'text':
                fullResponse += chunk.content;
                send('text', { content: chunk.content, sessionId: chatSessionId });
                break;

              case 'citation':
                send('citation', { text: chunk.text, location: chunk.location });
                break;

              case 'action': {
                rocCount++;
                if (rocCount > MAX_ROC_DEPTH) {
                  logger.warn({ sessionId: chatSessionId, rocCount }, 'ROC loop limit reached');
                  send('text', { content: '\n\n⚠️ Too many tool calls — stopping to prevent an infinite loop.', sessionId: chatSessionId });
                  fullResponse += '\n\n⚠️ Too many tool calls — stopping to prevent an infinite loop.';
                  return;
                }

                send('action', {
                  function: chunk.action.function,
                  parameters: chunk.action.parameters,
                });

                // Execute the action locally
                const result = await handleAction(chunk.action);

                // Log action for chat history
                addMessage(chatSessionId, 'action', JSON.stringify({
                  function: chunk.action.function,
                  parameters: chunk.action.parameters,
                  result: JSON.parse(result),
                }));

                // Continue agent with action result — may yield more chunks including more ROC
                const continuation = continueAgent(
                  chatSessionId,
                  chunk.action.invocationId,
                  chunk.action.actionGroup,
                  chunk.action.function,
                  result,
                );

                await processStream(continuation);
                break;
              }
            }
          }
        }

        await processStream(invokeAgent(prompt, chatSessionId));

        // Save assistant response
        if (fullResponse) {
          addMessage(chatSessionId, 'assistant', fullResponse);
        }

        // Auto-title on first exchange
        if (history.length <= 1) {
          autoTitleSession(chatSessionId);
        }

        send('done', { sessionId: chatSessionId });
        controller.close();
      } catch (err) {
        logger.error({ err, sessionId: chatSessionId }, 'Chat stream error');
        send('error', { message: 'An error occurred during the conversation' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
