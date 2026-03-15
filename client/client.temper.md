# Snake Multiplayer Client

Connects to a snake multiplayer server via WebSocket.
Reads w/a/s/d input from stdin and sends direction changes.
Receives and displays rendered game frames from the server.

    let {sleep, readLine} = import("std/io");
    let {wsConnect, wsSend, wsRecv, wsClose} = import("std/ws");

## State

    var connected = true;
    let serverUrl = "ws://localhost:8080";

## Main

    async { (): GeneratorResult<Empty> extends GeneratorFn =>
      do {
        console.log("Snake Multiplayer Client");
        console.log("Connecting to ${serverUrl}...");
        let ws = await wsConnect(serverUrl);
        do { await wsSend(ws, "join") } orelse void;
        console.log("Connected! Use w/a/s/d to move.");

        // Input loop — reads stdin, sends direction to server
        async { (): GeneratorResult<Empty> extends GeneratorFn =>
          do {
            while (connected) {
              let line = await readLine();
              if (line is String) {
                // Map w/a/s/d to single-char direction codes
                if (line == "w") {
                  do { await wsSend(ws, "u") } orelse void;
                } else if (line == "s") {
                  do { await wsSend(ws, "d") } orelse void;
                } else if (line == "a") {
                  do { await wsSend(ws, "l") } orelse void;
                } else if (line == "d") {
                  do { await wsSend(ws, "r") } orelse void;
                }
              } else {
                break;
              }
            }
          } orelse void;
        }

        // Recv loop — receives frames from server and displays them
        while (connected) {
          let msg = await wsRecv(ws);
          if (msg is String) {
            // The server sends rendered frames directly
            console.log(msg);
          } else {
            console.log("Disconnected from server.");
            connected = false;
          }
        }
        do { await wsClose(ws) } orelse void;
      } orelse void;
    }
