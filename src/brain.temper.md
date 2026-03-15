# Brain

This is YOUR file to edit! Write a `move()` function that controls the snake.

The game calls `move()` every tick with the current game state. Return a
`Direction` to steer the snake:
- `new Up()`
- `new Down()`
- `new Left()`
- `new Right()`

Save this file and the game will recompile your code automatically.

## Available Types

All types from `snake.temper.md` are available here:
- `Point` — has `.x` and `.y` (Int)
- `Direction`, `Up`, `Down`, `Left`, `Right`
- `pointEquals(a, b)` — check if two points are the same
- `directionDelta(dir)` — get (dx, dy) for a direction

## Your Move Function

    export let move(
      head: Point,
      body: List<Point>,
      food: Point,
      width: Int,
      height: Int,
    ): Direction {
      // Default: just go right.
      // Replace this with your own snake AI!
      //
      // Example: chase the food
      //   if (food.x > head.x) { new Right() }
      //   else if (food.x < head.x) { new Left() }
      //   else if (food.y > head.y) { new Down() }
      //   else { new Up() }
      new Right()
    }

