/**
 * One-time script to fix all .metadata.json sidecar files in S3:
 * 1. Strip empty arrays (invalid for Bedrock KB)
 * 2. Truncate large arrays to keep total under 1024 bytes
 */
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION || 'us-west-2';
const BUCKET = process.env.S3_BUCKET_NAME || 'pepper-kb-data';
const MAX_BYTES = 1000;

const s3 = new S3Client({ region: REGION });

function sanitize(meta) {
  const clean = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    clean[k] = v;
  }
  // Trim arrays to stay under byte limit
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
      for (const [k, v] of Object.entries(clean)) {
        if (Array.isArray(v)) { delete clean[k]; break; }
      }
      if (JSON.stringify({ metadataAttributes: clean }).length > MAX_BYTES) break;
    } else {
      clean[longestKey].length = Math.max(1, Math.floor(longestLen / 2));
    }
  }
  return clean;
}

async function listAllMetadataKeys() {
  const keys = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents || []) {
      if (obj.Key && obj.Key.endsWith('.metadata.json')) {
        keys.push(obj.Key);
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  console.log(`Scanning ${BUCKET} for .metadata.json files...`);
  const keys = await listAllMetadataKeys();
  console.log(`Found ${keys.length} metadata files`);

  let fixed = 0;
  let alreadyOk = 0;
  let errors = 0;

  for (const key of keys) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const body = await res.Body.transformToString();
      const parsed = JSON.parse(body);
      const original = parsed.metadataAttributes || {};
      const cleaned = sanitize(original);

      const newBody = JSON.stringify({ metadataAttributes: cleaned });
      if (newBody === body.trim()) {
        alreadyOk++;
        continue;
      }

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: newBody,
        ContentType: 'application/json',
      }));
      fixed++;
      if (fixed % 50 === 0) console.log(`  fixed ${fixed} so far...`);
    } catch (err) {
      console.error(`Error on ${key}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${fixed} fixed, ${alreadyOk} already ok, ${errors} errors`);
}

main().catch(console.error);
