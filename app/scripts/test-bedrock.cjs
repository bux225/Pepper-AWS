/**
 * Bedrock smoke tests — tests the same SDK calls the app makes.
 * Usage: cd app && node scripts/test-bedrock.cjs
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { randomUUID } = require('crypto');

// Load .env.local
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local */ }

const REGION = process.env.AWS_REGION || 'us-west-2';
const AGENT_ID = process.env.BEDROCK_AGENT_ID;
const AGENT_ALIAS = process.env.BEDROCK_AGENT_ALIAS_ID;
const KB_ID = process.env.BEDROCK_KB_ID;
const MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function pass(label, detail) { console.log(`${green('✓ PASS')}: ${label}${detail ? ' — ' + detail : ''}`); }
function fail(label, err) { console.log(`${red('✗ FAIL')}: ${label}\n  ${err}`); }

async function main() {
  console.log('=========================================');
  console.log(' Bedrock Smoke Tests (Node.js SDK)');
  console.log(` Region: ${REGION}`);
  console.log('=========================================\n');

  // --- Test 1: InvokeModel ---
  console.log(yellow('→') + ` Test 1: InvokeModel (${MODEL_ID})`);
  try {
    const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: REGION });
    const res = await client.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say hello in exactly 5 words.' }],
      }),
    }));
    const body = JSON.parse(Buffer.from(res.body).toString());
    pass('InvokeModel', body.content[0].text.trim());
  } catch (e) {
    fail('InvokeModel', e.message);
  }

  console.log('');

  // --- Test 2: InvokeAgent ---
  console.log(yellow('→') + ` Test 2: InvokeAgent (Agent: ${AGENT_ID}, Alias: ${AGENT_ALIAS})`);
  try {
    const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
    const client = new BedrockAgentRuntimeClient({ region: REGION });
    const res = await client.send(new InvokeAgentCommand({
      agentId: AGENT_ID,
      agentAliasId: AGENT_ALIAS,
      sessionId: randomUUID(),
      inputText: 'Hello, what can you help me with?',
    }));

    let text = '';
    if (res.completion) {
      for await (const event of res.completion) {
        if (event.chunk && event.chunk.bytes) {
          text += Buffer.from(event.chunk.bytes).toString();
        }
      }
    }
    pass('InvokeAgent', (text.slice(0, 200) || '(empty response)'));
  } catch (e) {
    fail('InvokeAgent', e.message);
  }

  console.log('');

  // --- Test 3: KB Retrieve ---
  console.log(yellow('→') + ` Test 3: KB Retrieve (KB: ${KB_ID})`);
  try {
    const { BedrockAgentRuntimeClient, RetrieveCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
    const client = new BedrockAgentRuntimeClient({ region: REGION });
    const res = await client.send(new RetrieveCommand({
      knowledgeBaseId: KB_ID,
      retrievalQuery: { text: 'test query' },
    }));
    pass('KB Retrieve', `${(res.retrievalResults || []).length} results`);
  } catch (e) {
    fail('KB Retrieve', e.message);
  }

  console.log('\n=========================================')
  console.log(' Done');
  console.log('=========================================');
}

main().catch(console.error);
