# Snake Multiplayer Server

A WebSocket server that hosts a multiplayer snake game.
Players connect and send single-char direction inputs (u/d/l/r).
The server runs an authoritative game loop at 200ms ticks
and broadcasts rendered frames to all connected players.

    let {sleep, terminalColumns, terminalRows} = import("std/io");
    let {WsConnection, wsListen, wsAccept, wsSend, wsRecv, wsClose} = import("std/ws");
    let {
      Direction, Up, Down, Left, Right,
      PlayerSnake, Alive, Dead, MultiSnakeGame,
      newMultiGame, multiTick, multiRender,
      changePlayerDirection, isMultiGameOver, addPlayer,
      playerHeadChar,
    } = import("snake");

## Server State

    // Use terminal size if available, otherwise a large playable default.
    // The render adds 2 border rows + score lines, so subtract some.
    var detectedCols = terminalColumns();
    var detectedRows = terminalRows();
    // Default 80x24 means detection failed — use a big board instead
    let boardWidth = if (detectedCols > 100) { detectedCols - 4 } else { 80 };
    let boardHeight = if (detectedRows > 30) { detectedRows - 12 } else { 30 };
    var game: MultiSnakeGame = newMultiGame(boardWidth, boardHeight, 0, 42);
    var wsConns = new ListBuilder<WsConnection>();
    var nextId = 0;
    var running = true;

## Accept Loop

    async { (): GeneratorResult<Empty> extends GeneratorFn =>
      do {
        console.log("Snake Multiplayer Server");
        console.log("Starting on port 8080...");
        let server = await wsListen(8080);
        console.log("Listening on ws://localhost:8080");
        console.log("Waiting for players to connect...");

        while (running) {
          let ws = await wsAccept(server);
          let playerId = nextId;
          nextId = nextId + 1;

          game = addPlayer(game, playerId * 7 + 13);
          wsConns.add(ws);

          let symbol = playerHeadChar(playerId);
          console.log("Player ${playerId.toString()} (${symbol}) connected!");

          // Spawn recv loop for this connection
          let connId = playerId;
          let connWs = ws;
          async { (): GeneratorResult<Empty> extends GeneratorFn =>
            do {
              while (running) {
                let msg = await wsRecv(connWs);
                if (msg is String) {
                  // Single-char direction: u/d/l/r
                  if (msg == "u") {
                    game = changePlayerDirection(game, connId, new Up());
                  } else if (msg == "d") {
                    game = changePlayerDirection(game, connId, new Down());
                  } else if (msg == "l") {
                    game = changePlayerDirection(game, connId, new Left());
                  } else if (msg == "r") {
                    game = changePlayerDirection(game, connId, new Right());
                  }
                } else {
                  console.log("Player ${connId.toString()} disconnected");
                  break;
                }
              }
            } orelse void;
          }
        }
      } orelse void;
    }

## Game Loop

    async { (): GeneratorResult<Empty> extends GeneratorFn =>
      do {
        // Wait for at least one player to connect
        while (game.snakes.length == 0) {
          await sleep(500);
        }
        console.log("Game starting!");

        while (running) {
          let dirs = new ListBuilder<Direction>();
          for (var i = 0; i < game.snakes.length; ++i) {
            let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
            dirs.add(snake.direction);
          }
          game = multiTick(game, dirs.toList());

          // Broadcast rendered frame
          let frame = multiRender(game);
          let conns = wsConns.toList();
          for (let conn of conns) {
            do { wsSend(conn, frame) } orelse void;
          }

          // No game-over reset — dead snakes stay on the board
          // and living snakes keep playing. New players can still join.
          await sleep(200);
        }
      } orelse void;
    }
