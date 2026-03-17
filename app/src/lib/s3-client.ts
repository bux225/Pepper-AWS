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
      metadataAttributes: metadata,
    }),
    ContentType: 'application/json',
  }));

  logger.debug({ key }, 'Uploaded document to S3');
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
