#!/bin/bash
# Launch a swarm of AI snake bots with different personalities.
# Each bot randomly picks JS, Rust, or Python as its client backend.
#
# Usage: bash swarm.sh [model] [num-bots]
#
# Prerequisites:
#   - Ollama running: ollama serve
#   - Model pulled: ollama pull llama3.2:3b
#   - Snake server running on port 8080
#   - All three backends built:
#       temper build -b js -b rust -b py
#       cd temper.out/js && npm install
#       cd temper.out/rust/snake-client && cargo build
#       cd temper.out/py && python3 -m venv .venv && source .venv/bin/activate && pip install -e ./temper-core -e ./std -e ./snake -e ./snake-client

MODEL=${1:-llama3.2:3b}
NUM=${2:-4}
DIR="$(cd "$(dirname "$0")" && pwd)"

PERSONALITIES=(greedy cautious aggressive hunter chaotic wall_hugger)

echo "🐍 Launching $NUM snake bots (model: $MODEL)"
echo "   Each bot picks a random backend: JS, Rust, or Python"
echo ""

for i in $(seq 1 "$NUM"); do
  P=${PERSONALITIES[$(( (i - 1) % ${#PERSONALITIES[@]} ))]}
  node "$DIR/snake-bot.js" "$P" "$MODEL" &
  sleep 1  # stagger connections
done

echo ""
echo "All $NUM bots launched. Press Ctrl+C to stop."
echo "Run 'node bot/spectate.js' in another terminal to watch!"
wait
