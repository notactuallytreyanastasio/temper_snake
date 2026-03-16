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
      sb.append("#\r\n");

      // Board rows
      for (var y = 0; y < game.height; ++y) {
        sb.append("#");
        for (var x = 0; x < game.width; ++x) {
          let p = new Point(x, y);
          sb.append(cellChar(game, p));
        }
        sb.append("#\r\n");
      }

      // Bottom border
      sb.append("#");
      for (var x = 0; x < game.width; ++x) {
        sb.append("#");
      }
      sb.append("#\r\n");

      let statusText = when (game.status) {
        is Playing -> "Playing";
        is GameOver -> "GAME OVER";
        else -> "";
      };
      sb.append("Score: ${game.score.toString()}  ${statusText}\r\n");

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

## Multiplayer Types

    export sealed interface PlayerStatus {}
    export class Alive() extends PlayerStatus {}
    export class Dead() extends PlayerStatus {}

    export class PlayerSnake(
      public id: Int,
      public segments: List<Point>,
      public direction: Direction,
      public score: Int,
      public status: PlayerStatus,
    ) {}

    export class MultiSnakeGame(
      public width: Int,
      public height: Int,
      public snakes: List<PlayerSnake>,
      public food: Point,
      public rngSeed: Int,
      public tickCount: Int,
    ) {}

## Creating a Multi-Player Game

    export let newMultiGame(
      width: Int, height: Int, numPlayers: Int, seed: Int,
    ): MultiSnakeGame {
      let snakeBuilder = new ListBuilder<PlayerSnake>();
      var currentSeed = seed;
      for (var i = 0; i < numPlayers; ++i) {
        let spawn = spawnPosition(width, height, i, currentSeed);
        let dir = spawn.direction;
        let startX = spawn.point.x;
        let startY = spawn.point.y;
        let delta = directionDelta(dir);
        let segments: List<Point> = [
          new Point(startX, startY),
          new Point(startX - delta.x, startY - delta.y),
          new Point(startX - delta.x * 2, startY - delta.y * 2),
        ];
        snakeBuilder.add(new PlayerSnake(i, segments, dir, 0, new Alive()));
      }
      let allSegments = collectAllSegments(snakeBuilder.toList());
      let foodResult = placeFood(allSegments, width, height, currentSeed);
      new MultiSnakeGame(
        width, height, snakeBuilder.toList(),
        foodResult.point, foodResult.seed, 0,
      )
    }

## Spawn Position

    class SpawnInfo(public point: Point, public direction: Direction) {}

    let spawnPosition(
      width: Int, height: Int, index: Int, seed: Int,
    ): SpawnInfo {
      // Buffer of 5 from each edge so the snake has room to react
      let buf = 5;
      let safeW = width - buf * 2;
      let safeH = height - buf * 2;
      if (safeW < 1 || safeH < 1) {
        return new SpawnInfo(new Point(do { width / 2 } orelse 0, do { height / 2 } orelse 0), new Right());
      }
      // Use PRNG seeded per player for deterministic but spread-out positions
      let r1 = nextRandom(seed * 7 + index * 131 + 37, safeW);
      let r2 = nextRandom(r1.nextSeed, safeH);
      let x = buf + r1.value;
      let y = buf + r2.value;
      // Pick a random direction
      let r3 = nextRandom(r2.nextSeed, 4);
      var dir: Direction = new Right();
      if (r3.value == 0) { dir = new Right(); }
      if (r3.value == 1) { dir = new Left(); }
      if (r3.value == 2) { dir = new Down(); }
      if (r3.value == 3) { dir = new Up(); }
      new SpawnInfo(new Point(x, y), dir)
    }

## Collect All Segments

    let collectAllSegments(snakes: List<PlayerSnake>): List<Point> {
      let builder = new ListBuilder<Point>();
      for (var i = 0; i < snakes.length; ++i) {
        let snake = snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        for (var j = 0; j < snake.segments.length; ++j) {
          builder.add(snake.segments.getOr(j, new Point(0, 0)));
        }
      }
      builder.toList()
    }

## Multi-Player Tick

    export let multiTick(
      game: MultiSnakeGame,
      directions: List<Direction>,
    ): MultiSnakeGame {
      // Step 1: compute new directions (reject opposite)
      let newDirs = new ListBuilder<Direction>();
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        let inputDir = directions.getOr(i, snake.direction);
        if (isOpposite(snake.direction, inputDir)) {
          newDirs.add(snake.direction);
        } else {
          newDirs.add(inputDir);
        }
      }

      // Step 2: compute new heads for alive snakes
      let newHeads = new ListBuilder<Point>();
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (snake.status is Alive) {
          let dir = newDirs.toList().getOr(i, new Right());
          let delta = directionDelta(dir);
          let head = snake.segments.getOr(0, new Point(0, 0));
          newHeads.add(new Point(head.x + delta.x, head.y + delta.y));
        } else {
          newHeads.add(new Point(-1, -1));
        }
      }
      let headsList = newHeads.toList();
      let dirsList = newDirs.toList();

      // Step 3-6: check collisions and build alive/dead status
      let aliveBuilder = new ListBuilder<Boolean>();
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (!(snake.status is Alive)) {
          aliveBuilder.add(false);
        } else {
          let nh = headsList.getOr(i, new Point(-1, -1));
          var dead = false;
          // Wall collision
          if (nh.x < 0 || nh.x >= game.width || nh.y < 0 || nh.y >= game.height) {
            dead = true;
          }
          // Self collision
          if (!dead) {
            for (var s = 0; s < snake.segments.length - 1; ++s) {
              if (pointEquals(nh, snake.segments.getOr(s, new Point(-2, -2)))) {
                dead = true;
              }
            }
          }
          // Head-to-body collision with other snakes
          if (!dead) {
            for (var j = 0; j < game.snakes.length; ++j) {
              if (j != i) {
                let other = game.snakes.getOr(j, new PlayerSnake(0, [], new Right(), 0, new Dead()));
                if (other.status is Alive) {
                  for (var s = 0; s < other.segments.length - 1; ++s) {
                    if (pointEquals(nh, other.segments.getOr(s, new Point(-2, -2)))) {
                      dead = true;
                    }
                  }
                }
              }
            }
          }
          // Head-to-head collision
          if (!dead) {
            for (var j = 0; j < game.snakes.length; ++j) {
              if (j != i) {
                let otherSnake = game.snakes.getOr(j, new PlayerSnake(0, [], new Right(), 0, new Dead()));
                if (otherSnake.status is Alive) {
                  let otherHead = headsList.getOr(j, new Point(-3, -3));
                  if (pointEquals(nh, otherHead)) {
                    dead = true;
                  }
                }
              }
            }
          }
          aliveBuilder.add(!dead);
        }
      }
      let aliveList = aliveBuilder.toList();

      // Step 7-8: determine eating and build new snakes
      var eaterIndex = -1;
      for (var i = 0; i < game.snakes.length; ++i) {
        if (aliveList.getOr(i, false)) {
          let nh = headsList.getOr(i, new Point(-1, -1));
          if (pointEquals(nh, game.food)) {
            eaterIndex = i;
          }
        }
      }

      let resultSnakes = new ListBuilder<PlayerSnake>();
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (!(snake.status is Alive)) {
          resultSnakes.add(snake);
        } else if (!aliveList.getOr(i, false)) {
          resultSnakes.add(new PlayerSnake(
            snake.id, snake.segments, snake.direction,
            snake.score, new Dead(),
          ));
        } else {
          let nh = headsList.getOr(i, new Point(0, 0));
          let dir = dirsList.getOr(i, snake.direction);
          let isEating = i == eaterIndex;
          let keepLen = if (isEating) { snake.segments.length } else { snake.segments.length - 1 };
          let newSegs = new ListBuilder<Point>();
          newSegs.add(nh);
          for (var s = 0; s < keepLen; ++s) {
            newSegs.add(snake.segments.getOr(s, new Point(0, 0)));
          }
          let newScore = if (isEating) { snake.score + 1 } else { snake.score };
          resultSnakes.add(new PlayerSnake(
            snake.id, newSegs.toList(), dir,
            newScore, new Alive(),
          ));
        }
      }

      // Step 9: place new food if eaten
      let resultSnakesList = resultSnakes.toList();
      var newFood = game.food;
      var newSeed = game.rngSeed;
      if (eaterIndex >= 0) {
        let allSegs = collectAllSegments(resultSnakesList);
        let foodResult = placeFood(allSegs, game.width, game.height, game.rngSeed);
        newFood = foodResult.point;
        newSeed = foodResult.seed;
      }

      new MultiSnakeGame(
        game.width, game.height, resultSnakesList,
        newFood, newSeed, game.tickCount + 1,
      )
    }

## Change Player Direction

    export let changePlayerDirection(
      game: MultiSnakeGame, playerId: Int, dir: Direction,
    ): MultiSnakeGame {
      let newSnakes = new ListBuilder<PlayerSnake>();
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (snake.id == playerId && snake.status is Alive && !isOpposite(snake.direction, dir)) {
          newSnakes.add(new PlayerSnake(
            snake.id, snake.segments, dir, snake.score, snake.status,
          ));
        } else {
          newSnakes.add(snake);
        }
      }
      new MultiSnakeGame(
        game.width, game.height, newSnakes.toList(),
        game.food, game.rngSeed, game.tickCount,
      )
    }

## Game Over Check

    export let isMultiGameOver(game: MultiSnakeGame): Boolean {
      var aliveCount = 0;
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (snake.status is Alive) {
          aliveCount = aliveCount + 1;
        }
      }
      if (game.snakes.length == 0) {
        false
      } else if (game.snakes.length == 1) {
        aliveCount == 0
      } else {
        aliveCount <= 1
      }
    }

## Add Player

    export let addPlayer(game: MultiSnakeGame, seed: Int): MultiSnakeGame {
      let newId = game.snakes.length;
      let spawn = spawnPosition(game.width, game.height, newId, seed);
      let dir = spawn.direction;
      let delta = directionDelta(dir);
      let startX = spawn.point.x;
      let startY = spawn.point.y;
      let segments: List<Point> = [
        new Point(startX, startY),
        new Point(startX - delta.x, startY - delta.y),
        new Point(startX - delta.x * 2, startY - delta.y * 2),
      ];
      let newSnake = new PlayerSnake(newId, segments, dir, 0, new Alive());
      let builder = new ListBuilder<PlayerSnake>();
      for (var i = 0; i < game.snakes.length; ++i) {
        builder.add(game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead())));
      }
      builder.add(newSnake);
      let allSegs = collectAllSegments(builder.toList());
      let foodResult = placeFood(allSegs, game.width, game.height, seed);
      new MultiSnakeGame(
        game.width, game.height, builder.toList(),
        foodResult.point, foodResult.seed, game.tickCount,
      )
    }

## Remove Player

    export let removePlayer(game: MultiSnakeGame, playerId: Int): MultiSnakeGame {
      let builder = new ListBuilder<PlayerSnake>();
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (snake.id != playerId) {
          builder.add(snake);
        }
      }
      new MultiSnakeGame(
        game.width, game.height, builder.toList(),
        game.food, game.rngSeed, game.tickCount,
      )
    }

## Multi-Player Render

    export let multiRender(game: MultiSnakeGame): String {
      let sb = new StringBuilder();
      sb.append("\u001b[2J\u001b[H");

      // Top border
      sb.append("#");
      for (var x = 0; x < game.width; ++x) { sb.append("#"); }
      sb.append("#\r\n");

      // Board rows
      for (var y = 0; y < game.height; ++y) {
        sb.append("#");
        for (var x = 0; x < game.width; ++x) {
          let p = new Point(x, y);
          sb.append(multiCellChar(game, p));
        }
        sb.append("#\r\n");
      }

      // Bottom border
      sb.append("#");
      for (var x = 0; x < game.width; ++x) { sb.append("#"); }
      sb.append("#\r\n");

      // Score line per player
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        let statusText = when (snake.status) {
          is Alive -> "Playing";
          is Dead -> "DEAD";
          else -> "";
        };
        let symbol = playerHeadChar(snake.id);
        sb.append("P${snake.id.toString()} ${symbol}: ${snake.score.toString()}  ${statusText}\r\n");
      }

      sb.toString()
    }

    export let playerHeadChar(id: Int): String {
      if (id == 0) {
        "@"
      } else if (id == 1) {
        "#"
      } else if (id == 2) {
        "$"
      } else if (id == 3) {
        "%"
      } else {
        "&"
      }
    }

    export let playerBodyChar(id: Int): String {
      if (id == 0) {
        "o"
      } else if (id == 1) {
        "+"
      } else if (id == 2) {
        "~"
      } else if (id == 3) {
        "="
      } else {
        "."
      }
    }

    let multiCellChar(game: MultiSnakeGame, p: Point): String {
      // Check heads first
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        if (snake.segments.length > 0) {
          let head = snake.segments.getOr(0, new Point(-1, -1));
          if (pointEquals(p, head)) {
            return playerHeadChar(snake.id);
          }
        }
      }
      // Check bodies
      for (var i = 0; i < game.snakes.length; ++i) {
        let snake = game.snakes.getOr(i, new PlayerSnake(0, [], new Right(), 0, new Dead()));
        for (var j = 1; j < snake.segments.length; ++j) {
          if (pointEquals(p, snake.segments.getOr(j, new Point(-1, -1)))) {
            return playerBodyChar(snake.id);
          }
        }
      }
      if (pointEquals(p, game.food)) {
        return "*";
      }
      " "
    }

## Direction Serialization

    export let directionToString(dir: Direction): String {
      when (dir) {
        is Up -> "up";
        is Down -> "down";
        is Left -> "left";
        is Right -> "right";
        else -> "right";
      }
    }

    export let stringToDirection(s: String): Direction? {
      if (s == "up") {
        return new Up();
      }
      if (s == "down") {
        return new Down();
      }
      if (s == "left") {
        return new Left();
      }
      if (s == "right") {
        return new Right();
      }
      null
    }

