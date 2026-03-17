import { graphFetch } from '../graph';
import type { AccountConfig, OutboxItem } from '../types';

/**
 * Send an email via Microsoft Graph.
 */
export async function sendEmail(
  account: AccountConfig,
  item: OutboxItem,
): Promise<void> {
  if (item.to.length === 0) {
    throw new Error('No recipients specified');
  }

  const message = {
    subject: item.subject || '(No subject)',
    body: { contentType: 'Text', content: item.content },
    toRecipients: item.to.map(addr => ({ emailAddress: { address: addr } })),
  };

  if (item.metadata.replyToId) {
    await graphFetch(account, `/me/messages/${encodeURIComponent(item.metadata.replyToId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: item.content }),
    });
  } else {
    await graphFetch(account, '/me/sendMail', {
      method: 'POST',
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
  }
}

/**
 * Send a Teams chat message via Microsoft Graph.
 */
export async function sendTeamsMessage(
  account: AccountConfig,
  item: OutboxItem,
): Promise<void> {
  const chatId = item.metadata.chatId;
  if (!chatId) {
    throw new Error('No chatId in metadata — specify which Teams chat to send to');
  }

  await graphFetch(account, `/me/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      body: { contentType: 'text', content: item.content },
    }),
  });
}
