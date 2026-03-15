#!/bin/bash
# Launch a swarm of AI snake bots with different personalities.
# Usage: bash swarm.sh [model] [server-url]
#
# Prerequisites:
#   - Ollama running: ollama serve
#   - Model pulled: ollama pull llama3.2:3b
#   - Snake server running on port 8080
#   - npm install (in this directory)

MODEL=${1:-llama3.2:3b}
SERVER=${2:-ws://localhost:8080}
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🐍 Launching snake bot swarm"
echo "   Model: $MODEL"
echo "   Server: $SERVER"
echo ""

node "$DIR/snake-bot.js" greedy "$MODEL" "$SERVER" &
node "$DIR/snake-bot.js" cautious "$MODEL" "$SERVER" &
node "$DIR/snake-bot.js" aggressive "$MODEL" "$SERVER" &
node "$DIR/snake-bot.js" hunter "$MODEL" "$SERVER" &

echo "Launched 4 bots. Press Ctrl+C to stop all."
echo ""
wait
