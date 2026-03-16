#!/usr/bin/env node

/**
 * AI Snake Bot — spawns a random compiled Temper client (JS, Rust, or
 * Python) as a subprocess and controls it via stdin/stdout, using a
 * local LLM via Ollama to decide moves.
 *
 * Usage:
 *   node snake-bot.js [personality] [model] [backend]
 *
 * Examples:
 *   node snake-bot.js greedy llama3.2:3b          # random backend
 *   node snake-bot.js cautious mistral-small js    # force JS backend
 *   node snake-bot.js aggressive mistral-small rust
 *   node snake-bot.js chaotic mistral-small python
 */

import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { PERSONALITIES, DEFAULT_PERSONALITY } from './personalities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const personality = process.argv[2] || DEFAULT_PERSONALITY;
const model = process.argv[3] || 'llama3.2:3b';
const forcedBackend = process.argv[4] || null;
const ollamaUrl = process.argv[5] || 'http://localhost:11434';

const systemPrompt = PERSONALITIES[personality];
if (!systemPrompt) {
  console.error(`Unknown personality: ${personality}`);
  console.error(`Available: ${Object.keys(PERSONALITIES).join(', ')}`);
  process.exit(1);
}

// --- Pick a random backend ---
const BACKENDS = ['js', 'rust', 'python'];
const backend = forcedBackend || BACKENDS[Math.floor(Math.random() * BACKENDS.length)];

function spawnClient() {
  switch (backend) {
    case 'js':
      return spawn('node', [resolve(root, 'temper.out/js/snake-client/index.js')], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
    case 'rust':
      return spawn(resolve(root, 'temper.out/rust/snake-client/target/debug/snake-client'), [], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
    case 'python': {
      const pyCode = `
import sys
sys.path.insert(0, '${resolve(root, 'temper.out/py')}')
from temper_core import init_simple_logging, await_safe_to_exit
init_simple_logging()
from snake_client import snake_client
await_safe_to_exit()
`.trim();
      return spawn(
        resolve(root, 'temper.out/py/.venv/bin/python3'),
        ['-c', pyCode],
        { stdio: ['pipe', 'pipe', 'inherit'] },
      );
    }
    default:
      console.error(`Unknown backend: ${backend}`);
      process.exit(1);
  }
}

console.log(`🐍 Snake Bot [${personality}] using ${model} via ${backend} client`);

// --- State ---
let latestFrame = null;
let thinking = false;
let moveCount = 0;

// --- Strip ANSI escape codes ---
function cleanFrame(frame) {
  return frame.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
}

// --- Parse direction from LLM response ---
function parseDirection(text) {
  const lower = text.toLowerCase().trim();
  if (/\bu\b/.test(lower) || lower.includes('up')) return 'w';
  if (/\bd\b/.test(lower) || lower.includes('down')) return 's';
  if (/\bl\b/.test(lower) || lower.includes('left')) return 'a';
  if (/\br\b/.test(lower) || lower.includes('right')) return 'd';
  const first = lower.charAt(0);
  if (first === 'u') return 'w';
  if (first === 'd') return 's';
  if (first === 'l') return 'a';
  if (first === 'r') return 'd';
  return null;
}

// --- Call Ollama ---
async function askOllama(frame) {
  const clean = cleanFrame(frame);
  if (!clean || clean.length < 20) return null; // skip non-frame output
  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Current board:\n\n${clean}\n\nYou are one of the snakes. Your info is at the bottom. Respond with ONLY one letter: u d l or r`,
          },
        ],
        stream: false,
        options: {
          temperature: personality === 'chaotic' ? 1.5 : 0.3,
          num_predict: 8,
        },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return parseDirection(data.message?.content || '');
  } catch {
    return null;
  }
}

// --- Spawn the client ---
const child = spawnClient();

// Collect stdout chunks into frames (split on ANSI clear)
let outputBuffer = '';
child.stdout.on('data', (chunk) => {
  outputBuffer += chunk.toString();
  // Each frame starts with clear-screen escape or has the board border
  // Just keep the latest complete chunk
  if (outputBuffer.includes('##')) {
    latestFrame = outputBuffer;
    outputBuffer = '';
  }
});

child.on('exit', (code) => {
  console.log(`   ${backend} client exited (code ${code})`);
  process.exit(0);
});

// --- Decision loop ---
async function decisionLoop() {
  // Give the client a moment to connect
  await new Promise((r) => setTimeout(r, 2000));

  while (true) {
    if (latestFrame && !thinking) {
      thinking = true;
      const frame = latestFrame;
      latestFrame = null;

      const key = await askOllama(frame);
      if (key && !child.killed) {
        child.stdin.write(key + '\n');
        moveCount++;
        if (moveCount % 10 === 0) {
          console.log(`   [${personality}/${backend}] ${moveCount} moves`);
        }
      }
      thinking = false;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

decisionLoop();
