# Snake Game Runner

This module runs the snake game with real-time keyboard input.
Two async blocks cooperate: one reads w/a/s/d from stdin,
the other runs the game loop at 200ms ticks.

    let {sleep, readLine} = import("std/io");
    let {
      Point, Direction, Up, Down, Left, Right, Playing,
      newGame, changeDirection, tick, render,
    } = import("snake");

## Input Parsing

    var inputDirection: Direction = new Right();

    let parseInput(line: String): Direction? {
      if (line == "w") {
        new Up()
      } else if (line == "s") {
        new Down()
      } else if (line == "a") {
        new Left()
      } else if (line == "d") {
        new Right()
      } else {
        null
      }
    }

## Game Loop

    // Input loop — reads stdin, updates shared direction
    async { (): GeneratorResult<Empty> extends GeneratorFn =>
      do {
        while (true) {
          let line = await readLine();
          if (line is String) {
            let dir = parseInput(line);
            if (dir is Direction) {
              inputDirection = dir;
            }
          } else {
            break;
          }
        }
      } orelse void;
    }

    // Game loop — ticks every 200ms using the current inputDirection
    async { (): GeneratorResult<Empty> extends GeneratorFn =>
      do {
        console.log("Snake! Use w/a/s/d + Enter to move.");
        console.log("Starting in 1 second...");
        await sleep(1000);
        var game = newGame(20, 10, 42);
        while (game.status is Playing) {
          game = changeDirection(game, inputDirection);
          game = tick(game);
          console.log(render(game));
          await sleep(200);
        }
        console.log(render(game));
        console.log("Final score: ${game.score.toString()}");
      } orelse void;
    }
