# Snake Tests

    let {
      Point, Up, Down, Left, Right, Playing, GameOver, SnakeGame,
      pointEquals, isOpposite, directionDelta, nextRandom,
      newGame, changeDirection, tick,
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
