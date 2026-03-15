# Snake Game

A snake game written in Temper.


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



