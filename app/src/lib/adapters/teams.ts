import { fetchChats, fetchChatMessages, fetchCurrentUserId, type GraphChat, type GraphChatMessage } from '../graph';
import { ingestTeamsMessage, type TeamsMessageDoc } from '../s3-ingest';
import { extractPeopleFromDoc } from '../people';
import { getWatermark, upsertWatermark } from '../tokens';
import logger from '../logger';
import type { AccountConfig } from '../types';
import { htmlToText } from '../text';

/**
 * Poll Teams chats for a given account and ingest messages to S3.
 */
export async function pollTeams(
  account: AccountConfig,
): Promise<{ imported: number; errors: string[] }> {
  const watermark = getWatermark(account.id, 'teams');
  const since = watermark?.lastPolledAt ?? undefined;

  const chats = await fetchChats(account);

  let imported = 0;
  const errors: string[] = [];

  for (const chat of chats) {
    try {
      const messages = await fetchChatMessages(account, chat.id, since);
      if (messages.length === 0) continue;

      for (const msg of messages) {
        if (msg.messageType !== 'message') continue;

        const text = msg.body.contentType === 'html'
          ? htmlToText(msg.body.content)
          : msg.body.content;

        if (!text.trim()) continue;

        const doc: TeamsMessageDoc = {
          messageId: msg.id,
          chatId: chat.id,
          from: msg.from?.user?.displayName ?? 'Unknown',
          body: text,
          createdAt: msg.createdDateTime,
        };

        const s3Key = await ingestTeamsMessage(doc);
        if (s3Key) {
          const people: string[] = [];
          if (msg.from?.user?.displayName) people.push(msg.from.user.displayName);
          if (chat.members) {
            for (const m of chat.members) {
              if (m.displayName) people.push(m.displayName);
            }
          }

          const title = chat.topic || `Teams: ${msg.from?.user?.displayName ?? 'Unknown'}`;
          extractPeopleFromDoc(s3Key, title, [...new Set(people)]);
          imported++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to poll chat "${chat.topic ?? chat.id}": ${msg}`);
    }
  }

  upsertWatermark(account.id, 'teams', null);

  return { imported, errors };
}
