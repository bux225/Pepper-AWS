import * as cheerio from 'cheerio';

/**
 * Decode Outlook Safe Links back to their original URLs.
 * Safe Links wrap real URLs: https://*.safelinks.protection.outlook.com/?url=ENCODED&data=...
 */
function decodeSafeLink(href: string): string {
  if (!href.includes('safelinks.protection.outlook.com')) return href;
  try {
    const url = new URL(href);
    const realUrl = url.searchParams.get('url');
    return realUrl ? decodeURIComponent(realUrl) : href;
  } catch {
    // Fallback regex extraction
    const match = href.match(/[?&]url=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : href;
  }
}

/**
 * Convert HTML into readable plain text.
 * Uses cheerio for robust parsing. Decodes Outlook Safe Links.
 */
export function htmlToText(html: string): string {
  try {
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();

    $('a[href]').each((_, el) => {
      const $el = $(el);
      const rawHref = $el.attr('href') ?? '';
      const href = decodeSafeLink(rawHref);
      const text = $el.text().trim();
      // Only include URL if it adds value beyond the link text
      if (href.startsWith('http') && text !== href && !text.includes(href)) {
        $el.text(`${text} (${href}) `);
      } else if (href.startsWith('http')) {
        $el.text(`${text} `);
      }
    });

    $('br').replaceWith('\n');
    $('p, div, tr, li, h1, h2, h3, h4, h5, h6, blockquote, pre').each((_, el) => {
      $(el).prepend('\n').append('\n');
    });

    const text = $.root().text();
    return text
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return html
      // Decode safe links in href attributes before extracting
      .replace(/href="https?:\/\/[^"]*safelinks\.protection\.outlook\.com[^"]*[?&]url=([^&"]+)[^"]*"/gi,
        (_, encodedUrl) => `href="${decodeURIComponent(encodedUrl)}"`)
      .replace(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1) ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;!?]+$/g, '');
    try {
      const parsed = new URL(cleaned);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const normalized = normalizeUrl(cleaned);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(cleaned);
      }
    } catch {
      // Ignore invalid URL candidates
    }
  }

  return urls;
}

export function normalizeUrl(value: string): string {
  try {
    const parsed = new URL(value.trim());
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    const pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = pathname || '/';
    return parsed.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}
