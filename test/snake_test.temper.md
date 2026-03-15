# Snake Tests

    let {
      Point, Direction, Up, Down, Left, Right, Playing, GameOver, SnakeGame,
      pointEquals, isOpposite, directionDelta, nextRandom,
      newGame, changeDirection, tick,
      Alive, Dead, PlayerSnake, MultiSnakeGame,
      newMultiGame, multiTick, multiRender,
      changePlayerDirection, isMultiGameOver,
      addPlayer, removePlayer,
      directionToString, stringToDirection,
    } = import("snake");

    test("initial state has snake near center") {
      let game = newGame(10, 10, 42);
      let head = game.snake.getOr(0, new Point(-1, -1));
      assert(head.x == 5) { "head x should be 5, got ${head.x.toString()}" }
      assert(head.y == 5) { "head y should be 5, got ${head.y.toString()}" }
      assert(game.snake.length == 3) { "snake should start with 3 segments" }
    }

    test("initial status is Playing") {
      let game = newGame(10, 10, 42);
      assert(game.status is Playing) { "initial status should be Playing" }
    }

    test("initial direction is Right") {
      let game = newGame(10, 10, 42);
      assert(game.direction is Right) { "initial direction should be Right" }
    }

    test("initial score is 0") {
      let game = newGame(10, 10, 42);
      assert(game.score == 0) { "initial score should be 0" }
    }

    test("snake moves right") {
      let game = newGame(10, 10, 42);
      let moved = tick(game);
      let head = moved.snake.getOr(0, new Point(-1, -1));
      assert(head.x == 6) { "head should move right to x=6, got ${head.x.toString()}" }
      assert(head.y == 5) { "head y should stay 5, got ${head.y.toString()}" }
    }

    test("snake moves down") {
      let game = changeDirection(newGame(10, 10, 42), new Down());
      let moved = tick(game);
      let head = moved.snake.getOr(0, new Point(-1, -1));
      assert(head.x == 5) { "head x should stay 5, got ${head.x.toString()}" }
      assert(head.y == 6) { "head should move down to y=6, got ${head.y.toString()}" }
    }

    test("snake moves up") {
      let game = changeDirection(newGame(10, 10, 42), new Up());
      let moved = tick(game);
      let head = moved.snake.getOr(0, new Point(-1, -1));
      assert(head.y == 4) { "head should move up to y=4, got ${head.y.toString()}" }
    }

    test("opposite direction is rejected") {
      let game = newGame(10, 10, 42);
      let changed = changeDirection(game, new Left());
      assert(changed.direction is Right) { "should still be Right after trying Left" }
    }

    test("non-opposite direction is accepted") {
      let game = newGame(10, 10, 42);
      let changed = changeDirection(game, new Up());
      assert(changed.direction is Up) { "should change to Up" }
    }

    test("wall collision causes game over") {
      var game = newGame(10, 10, 42);
      for (var i = 0; i < 10; ++i) {
        game = tick(game);
      }
      assert(game.status is GameOver) { "should be GameOver after hitting wall" }
    }

    test("self collision causes game over") {
      let snake: List<Point> = [
        new Point(5, 5),
        new Point(6, 5),
        new Point(6, 4),
        new Point(5, 4),
        new Point(4, 4),
        new Point(4, 5),
        new Point(4, 6),
      ];
      var game = new SnakeGame(
        10, 10, snake, new Left(), new Point(0, 0),
        0, new Playing(), 42,
      );
      game = tick(game);
      assert(game.status is GameOver) { "should be GameOver after self collision" }
    }

    test("pointEquals works for same points") {
      assert(pointEquals(new Point(3, 4), new Point(3, 4))) { "same points should be equal" }
    }

    test("pointEquals works for different points") {
      assert(!pointEquals(new Point(3, 4), new Point(5, 6))) { "different points should not be equal" }
    }

    test("isOpposite detects opposite directions") {
      assert(isOpposite(new Up(), new Down())) { "Up/Down are opposite" }
      assert(isOpposite(new Left(), new Right())) { "Left/Right are opposite" }
      assert(!isOpposite(new Up(), new Left())) { "Up/Left are not opposite" }
    }

    test("directionDelta returns correct deltas") {
      let up = directionDelta(new Up());
      assert(up.x == 0 && up.y == -1) { "Up should be (0, -1)" }
      let right = directionDelta(new Right());
      assert(right.x == 1 && right.y == 0) { "Right should be (1, 0)" }
    }

    test("PRNG is deterministic") {
      let r1 = nextRandom(42, 100);
      let r2 = nextRandom(42, 100);
      assert(r1.value == r2.value) { "same seed should produce same value" }
      assert(r1.nextSeed == r2.nextSeed) { "same seed should produce same next seed" }
    }

    test("PRNG produces values in range") {
      let r = nextRandom(42, 10);
      assert(r.value >= 0 && r.value < 10) { "value should be in [0, 10), got ${r.value.toString()}" }
    }

    test("tick does nothing when game is over") {
      var game = newGame(10, 10, 42);
      for (var i = 0; i < 10; ++i) {
        game = tick(game);
      }
      assert(game.status is GameOver) { "should be GameOver" }
      let head1 = game.snake.getOr(0, new Point(-1, -1));
      game = tick(game);
      let head2 = game.snake.getOr(0, new Point(-1, -1));
      assert(pointEquals(head1, head2)) { "snake should not move after game over" }
    }

    // ============ Multi-Snake Tests ============

    test("multi game creates correct number of snakes") {
      let game = newMultiGame(20, 10, 2, 42);
      assert(game.snakes.length == 2) { "should have 2 snakes" }
    }

    test("multi game snakes start alive") {
      let game = newMultiGame(20, 10, 2, 42);
      let s0 = game.snakes.getOr(0, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      let s1 = game.snakes.getOr(1, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      assert(s0.status is Alive) { "player 0 should be alive" }
      assert(s1.status is Alive) { "player 1 should be alive" }
    }

    test("multi game snakes start at different positions") {
      let game = newMultiGame(20, 10, 2, 42);
      let s0 = game.snakes.getOr(0, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      let s1 = game.snakes.getOr(1, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      let h0 = s0.segments.getOr(0, new Point(-1, -1));
      let h1 = s1.segments.getOr(0, new Point(-1, -1));
      assert(!pointEquals(h0, h1)) { "snakes should start at different positions" }
    }

    test("multi game snakes have 3 segments each") {
      let game = newMultiGame(20, 10, 2, 42);
      let s0 = game.snakes.getOr(0, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      let s1 = game.snakes.getOr(1, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      assert(s0.segments.length == 3) { "player 0 should have 3 segments" }
      assert(s1.segments.length == 3) { "player 1 should have 3 segments" }
    }

    test("multi tick moves both snakes") {
      let game = newMultiGame(20, 10, 2, 42);
      let h0Before = game.snakes.getOr(0, new PlayerSnake(0, [], new Right(), 0, new Dead())).segments.getOr(0, new Point(0, 0));
      let h1Before = game.snakes.getOr(1, new PlayerSnake(0, [], new Right(), 0, new Dead())).segments.getOr(0, new Point(0, 0));
      let dirs: List<Direction> = [new Right(), new Left()];
      let after = multiTick(game, dirs);
      let h0After = after.snakes.getOr(0, new PlayerSnake(0, [], new Right(), 0, new Dead())).segments.getOr(0, new Point(0, 0));
      let h1After = after.snakes.getOr(1, new PlayerSnake(0, [], new Right(), 0, new Dead())).segments.getOr(0, new Point(0, 0));
      assert(!pointEquals(h0Before, h0After)) { "snake 0 should have moved" }
      assert(!pointEquals(h1Before, h1After)) { "snake 1 should have moved" }
    }

    test("multi wall collision kills one snake") {
      // Create a game with one snake near the right wall
      var game = newMultiGame(20, 10, 2, 42);
      // Tick until snake 0 hits the wall (it faces right from ~x=5)
      let dirs: List<Direction> = [new Right(), new Left()];
      for (var i = 0; i < 20; ++i) {
        game = multiTick(game, dirs);
      }
      // At least one snake should be dead after hitting a wall
      var deadCount = 0;
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (snake.status is Dead) {
          deadCount = deadCount + 1;
        }
      }
      assert(deadCount > 0) { "at least one snake should be dead after 20 ticks toward walls" }
    }

    test("multi game over when one player left") {
      var game = newMultiGame(20, 10, 2, 42);
      let dirs: List<Direction> = [new Right(), new Left()];
      // Tick many times until game is over
      for (var i = 0; i < 30; ++i) {
        game = multiTick(game, dirs);
      }
      assert(isMultiGameOver(game)) { "game should be over after enough ticks" }
    }

    test("changePlayerDirection works") {
      let game = newMultiGame(20, 10, 2, 42);
      let changed = changePlayerDirection(game, 0, new Up());
      let s0 = changed.snakes.getOr(0, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      assert(s0.direction is Up) { "player 0 direction should be Up" }
    }

    test("changePlayerDirection rejects opposite") {
      let game = newMultiGame(20, 10, 2, 42);
      // Player 0 starts facing Right, so Left is opposite
      let changed = changePlayerDirection(game, 0, new Left());
      let s0 = changed.snakes.getOr(0, new PlayerSnake(0, [], new Right(), 0, new Dead()));
      assert(s0.direction is Right) { "should reject opposite direction" }
    }

    test("addPlayer adds a new snake") {
      let game = newMultiGame(20, 10, 2, 42);
      let bigger = addPlayer(game, 99);
      assert(bigger.snakes.length == 3) { "should have 3 snakes after adding" }
    }

    test("removePlayer removes a snake") {
      let game = newMultiGame(20, 10, 3, 42);
      let smaller = removePlayer(game, 1);
      assert(smaller.snakes.length == 2) { "should have 2 snakes after removing" }
    }

    test("multiRender produces output") {
      let game = newMultiGame(20, 10, 2, 42);
      let rendered = multiRender(game);
      assert(rendered != "") { "render should produce output" }
    }

    test("directionToString and stringToDirection round-trip") {
      let d = directionToString(new Up());
      assert(d == "up") { "Up should serialize to 'up'" }
      let parsed = stringToDirection("down");
      assert(parsed is Down) { "'down' should parse to Down" }
    }
