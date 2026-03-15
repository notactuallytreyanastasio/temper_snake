# Snake Game

A snake game written in Temper.

    let {sleep} = import("std/io");

## Direction

    export sealed interface Direction {}
    export class Up() extends Direction {}
    export class Down() extends Direction {}
    export class Left() extends Direction {}
    export class Right() extends Direction {}

## Point

    export class Point(public x: Int, public y: Int) {}

## Game Status

    export sealed interface GameStatus {}
    export class Playing() extends GameStatus {}
    export class GameOver() extends GameStatus {}

## Helper Functions

    export let pointEquals(a: Point, b: Point): Boolean {
      a.x == b.x && a.y == b.y
    }

    export let isOpposite(a: Direction, b: Direction): Boolean {
      when (a) {
        is Up -> b is Down;
        is Down -> b is Up;
        is Left -> b is Right;
        is Right -> b is Left;
        else -> false;
      }
    }

    export let directionDelta(dir: Direction): Point {
      when (dir) {
        is Up -> new Point(0, -1);
        is Down -> new Point(0, 1);
        is Left -> new Point(-1, 0);
        is Right -> new Point(1, 0);
        else -> new Point(0, 0);
      }
    }

## Random

A simple deterministic PRNG.

    export class RandomResult(public value: Int, public nextSeed: Int) {}

    export let nextRandom(seed: Int, max: Int): RandomResult {
      let raw = seed * 1664525 + 1013904223;
      let masked = raw & 2147483647;
      let posVal = if (masked < 0) { -masked } else { masked };
      var value = 0;
      if (max > 0) {
        value = do { posVal % max } orelse 0;
      }
      new RandomResult(value, masked)
    }

## SnakeGame

    export class SnakeGame(
      public width: Int,
      public height: Int,
      public snake: List<Point>,
      public direction: Direction,
      public food: Point,
      public score: Int,
      public status: GameStatus,
      public rngSeed: Int,
    ) {}

## Food Placement

    class FoodPlacement(public point: Point, public seed: Int) {}

    let placeFood(
      snake: List<Point>, width: Int, height: Int, seed: Int,
    ): FoodPlacement {
      let totalCells = width * height;
      var currentSeed = seed;
      for (var attempt = 0; attempt < totalCells; ++attempt) {
        let result = nextRandom(currentSeed, totalCells);
        currentSeed = result.nextSeed;
        var px = 0;
        var py = 0;
        if (width > 0) {
          px = do { result.value % width } orelse 0;
          py = do { result.value / width } orelse 0;
        }
        let candidate = new Point(px, py);
        var occupied = false;
        for (let seg of snake) {
          if (pointEquals(seg, candidate)) {
            occupied = true;
          }
        }
        if (!occupied) {
          return new FoodPlacement(candidate, currentSeed);
        }
      }
      for (var y = 0; y < height; ++y) {
        for (var x = 0; x < width; ++x) {
          let candidate = new Point(x, y);
          var free = true;
          for (let seg of snake) {
            if (pointEquals(seg, candidate)) {
              free = false;
            }
          }
          if (free) {
            return new FoodPlacement(candidate, currentSeed);
          }
        }
      }
      new FoodPlacement(new Point(0, 0), currentSeed)
    }

## Creating a New Game

    export let newGame(width: Int, height: Int, seed: Int): SnakeGame {
      var centerX = 0;
      var centerY = 0;
      if (width > 0) {
        centerX = do { width / 2 } orelse 0;
      }
      if (height > 0) {
        centerY = do { height / 2 } orelse 0;
      }
      let snake: List<Point> = [
        new Point(centerX, centerY),
        new Point(centerX - 1, centerY),
        new Point(centerX - 2, centerY),
      ];
      let foodResult = placeFood(snake, width, height, seed);
      new SnakeGame(
        width, height, snake,
        new Right(), foodResult.point,
        0, new Playing(), foodResult.seed,
      )
    }

## Changing Direction

    export let changeDirection(game: SnakeGame, dir: Direction): SnakeGame {
      if (isOpposite(game.direction, dir)) {
        game
      } else {
        new SnakeGame(
          game.width, game.height, game.snake,
          dir, game.food,
          game.score, game.status, game.rngSeed,
        )
      }
    }

## Tick

    export let tick(game: SnakeGame): SnakeGame {
      if (game.status is GameOver) {
        return game;
      }

      let delta = directionDelta(game.direction);
      let head = game.snake.getOr(0, new Point(0, 0));
      let newHead = new Point(head.x + delta.x, head.y + delta.y);

      // Wall collision
      if (newHead.x < 0 || newHead.x >= game.width ||
          newHead.y < 0 || newHead.y >= game.height) {
        return new SnakeGame(
          game.width, game.height, game.snake,
          game.direction, game.food,
          game.score, new GameOver(), game.rngSeed,
        );
      }

      // Self collision
      let eating = pointEquals(newHead, game.food);
      let checkLength = if (eating) {
        game.snake.length
      } else {
        game.snake.length - 1
      };
      for (var i = 0; i < checkLength; ++i) {
        if (pointEquals(newHead, game.snake.getOr(i, new Point(-1, -1)))) {
          return new SnakeGame(
            game.width, game.height, game.snake,
            game.direction, game.food,
            game.score, new GameOver(), game.rngSeed,
          );
        }
      }

      // Build new snake
      let newSnakeBuilder = new ListBuilder<Point>();
      newSnakeBuilder.add(newHead);
      let keepLength = if (eating) {
        game.snake.length
      } else {
        game.snake.length - 1
      };
      for (var i = 0; i < keepLength; ++i) {
        newSnakeBuilder.add(game.snake.getOr(i, new Point(0, 0)));
      }
      let newSnake = newSnakeBuilder.toList();

      if (eating) {
        let newScore = game.score + 1;
        let foodResult = placeFood(newSnake, game.width, game.height, game.rngSeed);
        new SnakeGame(
          game.width, game.height, newSnake,
          game.direction, foodResult.point,
          newScore, new Playing(), foodResult.seed,
        )
      } else {
        new SnakeGame(
          game.width, game.height, newSnake,
          game.direction, game.food,
          game.score, game.status, game.rngSeed,
        )
      }
    }

## Render

    export let render(game: SnakeGame): String {
      let sb = new StringBuilder();
      sb.append("\u001b[2J\u001b[H");

      // Top border
      sb.append("#");
      for (var x = 0; x < game.width; ++x) {
        sb.append("#");
      }
      sb.append("#\n");

      // Board rows
      for (var y = 0; y < game.height; ++y) {
        sb.append("#");
        for (var x = 0; x < game.width; ++x) {
          let p = new Point(x, y);
          sb.append(cellChar(game, p));
        }
        sb.append("#\n");
      }

      // Bottom border
      sb.append("#");
      for (var x = 0; x < game.width; ++x) {
        sb.append("#");
      }
      sb.append("#\n");

      let statusText = when (game.status) {
        is Playing -> "Playing";
        is GameOver -> "GAME OVER";
        else -> "";
      };
      sb.append("Score: ${game.score.toString()}  ${statusText}\n");

      sb.toString()
    }

    let cellChar(game: SnakeGame, p: Point): String {
      let head = game.snake.getOr(0, new Point(-1, -1));
      if (pointEquals(p, head)) {
        return "@";
      }
      for (var i = 1; i < game.snake.length; ++i) {
        if (pointEquals(p, game.snake.getOr(i, new Point(-1, -1)))) {
          return "o";
        }
      }
      if (pointEquals(p, game.food)) {
        return "*";
      }
      " "
    }

## Game Loop

Run the game automatically — the `move()` function from `brain.temper.md`
controls the snake each tick.

    async { (): GeneratorResult<Empty> extends GeneratorFn =>
      do {
        var game = newGame(20, 10, 42);
        while (game.status is Playing) {
          let head = game.snake.getOr(0, new Point(0, 0));
          let dir = move(head, game.snake, game.food, game.width, game.height);
          game = changeDirection(game, dir);
          game = tick(game);
          console.log(render(game));
          await sleep(200);
        }
        console.log(render(game));
        console.log("Final score: ${game.score.toString()}");
      } orelse void;
    }

## Tests

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
      // Snake coiled so next move hits its own body
      // Shape:  head->(5,4) moving Down, body curves: (5,3)(4,3)(4,4)(4,5)(5,5)
      // Tick: head goes to (5,5) which is occupied by tail — and we're NOT eating
      // so checkLength = 6-1 = 5, checking segments 0..4: (5,4)(5,3)(4,3)(4,4)(4,5)
      // (5,5) not in those... tail drops. No collision.
      //
      // Better approach: make the snake eat food to grow, then collide
      // Simplest: construct a snake where head moves into segment index 1
      // Head at (5,5) going Left -> (4,5). Body: (5,5)(6,5)(6,4)(5,4)(4,4)(4,5)
      // checkLength = 7-1=6, check (5,5)(6,5)(6,4)(5,4)(4,4)(4,5)
      // (4,5) IS at index 5! Game over.
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

