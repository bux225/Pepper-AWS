import { fetchEmails, type GraphEmail } from '../graph';
import { ingestEmail, type EmailDoc } from '../s3-ingest';
import { extractPeopleFromDoc } from '../people';
import { getWatermark, upsertWatermark } from '../tokens';
import logger from '../logger';
import type { AccountConfig } from '../types';
import { htmlToText } from '../text';

function isMeetingEmail(email: GraphEmail): boolean {
  const meetingType = (email.meetingMessageType ?? '').toLowerCase();
  if (meetingType && meetingType !== 'none') return true;

  const subject = (email.subject ?? '').toLowerCase();
  if (
    subject.startsWith('accepted:') ||
    subject.startsWith('declined:') ||
    subject.startsWith('tentative:') ||
    subject.startsWith('canceled:') ||
    subject.startsWith('cancelled:')
  ) return true;

  return false;
}

/**
 * Poll emails for a given account and ingest to S3.
 * Uses delta queries for incremental polling.
 */
export async function pollEmails(
  account: AccountConfig,
): Promise<{ imported: number; errors: string[] }> {
  const watermark = getWatermark(account.id, 'email');
  const { emails, deltaLink } = await fetchEmails(account, watermark?.deltaLink);

  let imported = 0;
  const errors: string[] = [];

  for (const email of emails) {
    if (isMeetingEmail(email)) continue;

    try {
      const plainContent = email.body.contentType === 'html'
        ? htmlToText(email.body.content)
        : email.body.content;

      const people: string[] = [];
      if (email.from?.emailAddress?.name) people.push(email.from.emailAddress.name);
      for (const r of email.toRecipients ?? []) {
        if (r.emailAddress?.name) people.push(r.emailAddress.name);
      }

      const doc: EmailDoc = {
        messageId: email.id,
        subject: email.subject || '(No subject)',
        from: email.from?.emailAddress?.name ?? '',
        fromEmail: email.from?.emailAddress?.address ?? '',
        to: (email.toRecipients ?? []).map(r => ({
          name: r.emailAddress?.name ?? '',
          email: r.emailAddress?.address ?? '',
        })),
        body: plainContent || email.bodyPreview || '',
        receivedAt: email.receivedDateTime,
        conversationId: email.conversationId,
        webLink: email.webLink,
      };

      const s3Key = await ingestEmail(doc);
      if (s3Key) {
        // Index people from this email
        extractPeopleFromDoc(
          s3Key,
          email.subject || '(No subject)',
          [...new Set(people)],
          email.from?.emailAddress?.address,
          (email.toRecipients ?? []).map(r => r.emailAddress?.address).filter(Boolean),
        );
        imported++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to import email "${email.subject}": ${msg}`);
    }
  }

  if (deltaLink) {
    upsertWatermark(account.id, 'email', deltaLink);
  }

  return { imported, errors };
}
