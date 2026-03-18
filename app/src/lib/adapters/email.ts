import { fetchEmails, type GraphEmail } from '../graph';
import { ingestEmail, type EmailDoc } from '../s3-ingest';
import { extractPeopleFromDoc } from '../people';
import { extractAndRecommendUrls } from '../reference-links';
import { getWatermark, upsertWatermark } from '../tokens';
import { loadConfig } from '../config.node';
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

interface DismissRule {
  type: 'from' | 'subject' | 'contains';
  value: string;
}

function parseDismissRules(): DismissRule[] {
  const config = loadConfig();
  const text = config.review?.emailRulesText ?? '';
  if (!text.trim()) return [];

  const rules: DismissRule[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const prefix = trimmed.slice(0, colonIdx).toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim().toLowerCase();
    if (!value) continue;

    if (prefix === 'from' || prefix === 'subject' || prefix === 'contains') {
      rules.push({ type: prefix, value });
    }
  }
  return rules;
}

function shouldDismissEmail(
  email: GraphEmail,
  rules: DismissRule[],
): boolean {
  if (rules.length === 0) return false;

  const fromAddress = (email.from?.emailAddress?.address ?? '').toLowerCase();
  const fromName = (email.from?.emailAddress?.name ?? '').toLowerCase();
  const subject = (email.subject ?? '').toLowerCase();
  const bodyPreview = (email.bodyPreview ?? '').toLowerCase();

  for (const rule of rules) {
    switch (rule.type) {
      case 'from':
        if (fromAddress.includes(rule.value) || fromName.includes(rule.value)) return true;
        break;
      case 'subject':
        if (subject.includes(rule.value)) return true;
        break;
      case 'contains':
        if (subject.includes(rule.value) || bodyPreview.includes(rule.value)) return true;
        break;
    }
  }
  return false;
}

/**
 * Poll emails for a given account and ingest to S3.
 * Uses delta queries for incremental polling.
 */
export async function pollEmails(
  account: AccountConfig,
): Promise<{ imported: number; dismissed: number; errors: string[] }> {
  const watermark = getWatermark(account.id, 'email');
  const { emails, deltaLink } = await fetchEmails(account, watermark?.deltaLink);

  let imported = 0;
  let dismissed = 0;
  const errors: string[] = [];
  const dismissRules = parseDismissRules();

  for (const email of emails) {
    if (isMeetingEmail(email)) continue;
    if (shouldDismissEmail(email, dismissRules)) {
      dismissed++;
      continue;
    }

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
        // Extract URLs as recommended reference links
        extractAndRecommendUrls(plainContent, 'email', s3Key);
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

  if (dismissed > 0) {
    logger.info({ dismissed }, 'Dismissed emails by rules');
  }

  return { imported, dismissed, errors };
}
