#!/usr/bin/env node

/**
 * Spectator client — watches the game without spawning a snake.
 *
 * Usage: node spectate.js [server-url]
 */

import WebSocket from 'ws';

const serverUrl = process.argv[2] || 'ws://localhost:8080';

console.log(`👀 Spectating ${serverUrl}`);

const ws = new WebSocket(serverUrl);

ws.on('open', () => {
  // Tell server we're just watching
  ws.send('spectate');
});

ws.on('message', (data) => {
  process.stdout.write(data.toString());
});

ws.on('close', () => {
  console.log('Server closed.');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
