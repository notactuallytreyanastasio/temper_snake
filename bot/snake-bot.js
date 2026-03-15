#!/usr/bin/env node

/**
 * AI Snake Bot — connects to a multiplayer snake server and plays
 * using a local LLM via Ollama.
 *
 * Usage:
 *   node snake-bot.js [personality] [model] [server-url] [ollama-url]
 *
 * Examples:
 *   node snake-bot.js greedy llama3.2:3b
 *   node snake-bot.js cautious llama3.2:3b
 *   node snake-bot.js aggressive phi3:mini
 *   node snake-bot.js chaotic llama3.2:3b ws://192.168.1.5:8080
 */

import WebSocket from 'ws';
import { PERSONALITIES, DEFAULT_PERSONALITY } from './personalities.js';

const personality = process.argv[2] || DEFAULT_PERSONALITY;
const model = process.argv[3] || 'llama3.2:3b';
const serverUrl = process.argv[4] || 'ws://localhost:8080';
const ollamaUrl = process.argv[5] || 'http://localhost:11434';

const systemPrompt = PERSONALITIES[personality];
if (!systemPrompt) {
  console.error(`Unknown personality: ${personality}`);
  console.error(`Available: ${Object.keys(PERSONALITIES).join(', ')}`);
  process.exit(1);
}

console.log(`🐍 Snake Bot [${personality}] using ${model}`);
console.log(`   Server: ${serverUrl}`);
console.log(`   Ollama: ${ollamaUrl}`);

// --- State ---
let latestFrame = null;
let thinking = false;
let moveCount = 0;
let connected = false;

// --- Strip ANSI escape codes ---
function cleanFrame(frame) {
  // Remove all ANSI escape sequences
  return frame.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
}

// --- Parse direction from LLM response ---
function parseDirection(text) {
  const lower = text.toLowerCase().trim();
  // Look for single letter first
  if (/\bu\b/.test(lower) || lower.includes('up')) return 'u';
  if (/\bd\b/.test(lower) || lower.includes('down')) return 'd';
  if (/\bl\b/.test(lower) || lower.includes('left')) return 'l';
  if (/\br\b/.test(lower) || lower.includes('right')) return 'r';
  // Last resort: first character
  const first = lower.charAt(0);
  if ('udlr'.includes(first)) return first;
  return null;
}

// --- Call Ollama ---
async function askOllama(frame) {
  const clean = cleanFrame(frame);
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
            content: `Here is the current snake game board:\n\n${clean}\n\nYou are one of the snakes shown above. Your player info is in the score lines at the bottom. Choose your next move.\n\nRespond with ONLY one letter: u (up), d (down), l (left), r (right)`,
          },
        ],
        stream: false,
        options: {
          temperature: personality === 'chaotic' ? 1.5 : 0.3,
          num_predict: 8, // we only need one letter
        },
      }),
    });
    if (!response.ok) {
      console.error(`Ollama error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return parseDirection(data.message?.content || '');
  } catch (err) {
    console.error(`Ollama request failed: ${err.message}`);
    return null;
  }
}

// --- Decision loop ---
async function decisionLoop(ws) {
  while (connected) {
    if (latestFrame && !thinking) {
      thinking = true;
      const frame = latestFrame;
      latestFrame = null; // consume it

      const dir = await askOllama(frame);
      if (dir && ws.readyState === WebSocket.OPEN) {
        ws.send(dir);
        moveCount++;
        if (moveCount % 10 === 0) {
          console.log(`   [${personality}] ${moveCount} moves made`);
        }
      }
      thinking = false;
    }
    // Brief pause before checking for new frame
    await new Promise((r) => setTimeout(r, 50));
  }
}

// --- Connect ---
const ws = new WebSocket(serverUrl);

ws.on('open', () => {
  console.log(`   Connected to ${serverUrl}`);
  ws.send('join');
  connected = true;
  decisionLoop(ws);
});

ws.on('message', (data) => {
  // Store latest frame (overwrites previous unprocessed frame)
  latestFrame = data.toString();
});

ws.on('close', () => {
  console.log(`   Disconnected.`);
  connected = false;
  process.exit(0);
});

ws.on('error', (err) => {
  console.error(`   WebSocket error: ${err.message}`);
  connected = false;
  process.exit(1);
});
