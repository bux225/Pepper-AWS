import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import logger from './logger';

const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-west-2' });

function getBucket(): string {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) throw new Error('S3_BUCKET_NAME environment variable is required');
  return bucket;
}

/**
 * Sanitize metadata for Bedrock KB sidecar files.
 * - Strips empty arrays and undefined/null values (rejected as invalid attributes)
 * - Truncates string arrays so the total sidecar stays under 1024 bytes
 */
function sanitizeMetadata(metadata: object): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    clean[k] = v;
  }

  // Bedrock KB rejects metadata sidecars > 1024 bytes.
  // Progressively trim the longest array until we fit.
  const MAX_BYTES = 1000; // leave headroom for the wrapper
  while (JSON.stringify({ metadataAttributes: clean }).length > MAX_BYTES) {
    let longestKey = '';
    let longestLen = 0;
    for (const [k, v] of Object.entries(clean)) {
      if (Array.isArray(v) && v.length > longestLen) {
        longestLen = v.length;
        longestKey = k;
      }
    }
    if (!longestKey || longestLen <= 1) {
      // Nothing left to trim — drop entire arrays if still too big
      for (const [k, v] of Object.entries(clean)) {
        if (Array.isArray(v)) { delete clean[k]; break; }
      }
      if (JSON.stringify({ metadataAttributes: clean }).length > MAX_BYTES) break;
    } else {
      (clean[longestKey] as unknown[]).length = Math.max(1, Math.floor(longestLen / 2));
    }
  }

  return clean;
}

/**
 * Upload a JSON document and its Bedrock KB metadata sidecar to S3.
 */
export async function uploadDocument(
  key: string,
  content: object,
  metadata: object,
): Promise<void> {
  const bucket = getBucket();

  // Upload the content document
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(content, null, 2),
    ContentType: 'application/json',
  }));

  // Upload the Bedrock KB metadata sidecar
  // Bedrock KB expects .metadata.json next to the source file
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${key}.metadata.json`,
    Body: JSON.stringify({
      metadataAttributes: sanitizeMetadata(metadata),
    }),
    ContentType: 'application/json',
  }));

  logger.debug({ key }, 'Uploaded document to S3');
}

/**
 * Upload a plain-text document with its Bedrock KB metadata sidecar to S3.
 * Plain text produces better vector embeddings than JSON for KB retrieval.
 */
export async function uploadTextDocument(
  key: string,
  textContent: string,
  metadata: object,
): Promise<void> {
  const bucket = getBucket();

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: textContent,
    ContentType: 'text/plain; charset=utf-8',
  }));

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${key}.metadata.json`,
    Body: JSON.stringify({
      metadataAttributes: sanitizeMetadata(metadata),
    }),
    ContentType: 'application/json',
  }));

  logger.debug({ key }, 'Uploaded text document to S3');
}

/**
 * List all object keys under a prefix.
 */
export async function listKeys(prefix: string, maxKeys = 1000): Promise<string[]> {
  const bucket = getBucket();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(maxKeys - keys.length, 1000),
      ContinuationToken: continuationToken,
    }));

    for (const obj of response.Contents ?? []) {
      if (obj.Key && !obj.Key.endsWith('.metadata.json')) {
        keys.push(obj.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken && keys.length < maxKeys);

  return keys;
}

/**
 * Check if an object exists in S3.
 */
export async function objectExists(key: string): Promise<boolean> {
  const bucket = getBucket();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a JSON document from S3.
 */
export async function getDocument<T = unknown>(key: string): Promise<T | null> {
  const bucket = getBucket();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await response.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * Read a document from S3 as raw text. Works for both .txt and .json files.
 */
export async function getDocumentText(key: string): Promise<string | null> {
  const bucket = getBucket();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await response.Body?.transformToString();
    return body ?? null;
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * Delete a document and its metadata sidecar from S3.
 */
export async function deleteDocument(key: string): Promise<void> {
  const bucket = getBucket();
  await Promise.all([
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${key}.metadata.json` })),
  ]);
  logger.debug({ key }, 'Deleted document from S3');
}

/**
 * Count objects under a prefix (excluding metadata sidecars).
 */
export async function countObjects(prefix: string): Promise<number> {
  const keys = await listKeys(prefix, 100000);
  return keys.length;
}
