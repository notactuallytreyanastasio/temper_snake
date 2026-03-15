# Snake

A snake game written in [Temper](https://github.com/temperlang/temper), a programming language that compiles to six other programming languages.
The game is about 300 lines.
The compiler changes required to make it run are about 600.

Compiler branch: [`do-crimes-to-play-snake`](https://github.com/temperlang/temper/tree/do-crimes-to-play-snake) ([PR #376](https://github.com/temperlang/temper/pull/376))

## The Situation

Temper is a language I have been enjoying lately.
It compiles to JavaScript, Python, Lua, Rust, Java, and C#, and it does this without any AI magic.
It just uses really cool compilers.
It has types, pattern matching, sealed interfaces, immutable data structures, a nice testing framework, and a generator-based async system.

It is, by any reasonable measure, a wildly impressive accomplishment.

I recently decided that I wanted to have a snake implementation in as many languages as possible.
Temper seemed like the obvious language to do this in.
Write it once, get six languages for free.

However, there was a problem.
Temper could not sleep.
It lacked the I/O primitives needed to make a game loop.

The standard library had exactly one I/O primitive: `console.log()`.
You could compute anything and print the result, but you could not pause between prints, and you could not read input.
This is fine for libraries.
It is less fine for snake.

A game loop needs to do three things: read input, update state, wait 200 milliseconds.
Temper could do the middle one.
The other two required wrapping your compiled output in a host-language script — a Node.js file calling `setTimeout`, a Python file calling `time.sleep`, something on the outside doing the parts the language couldn't.
You would write your game in Temper, then write a second program in the target language to actually run it, which somewhat defeats the purpose of having a compiler.

I wanted to play snake.
In pure Temper.
On all six backends.
Without wrappers.

The obvious solution was to modify the compiler between the hours of 1am and 5am on a Saturday.

## The Plan

I just needed two things: `sleep(ms)` to pause execution, and `readLine()` to read a keypress.
Add them to the standard library, wire them into all six backends, and the game works everywhere.
My dream.

Temper has a system for exactly this.
The `@connected` decorator marks a function as "the compiler will handle this."
You write a Temper declaration with a `panic()` body that never executes — the compiler intercepts the call and replaces it with a native implementation registered in each backend's support network.
Each connected function requires four layers of wiring:

1. **Temper declaration** — the portable signature in a `.temper.md` file
2. **Kotlin SupportNetwork** — tells the backend compiler about the key
3. **Runtime implementation** — the actual native code (`.js`, `.py`, `.lua`, `.rs`, `.java`, `.cs`)
4. **Resource registration** — tells the build system to bundle the runtime file

Two functions, four layers each, six backends.
Forty-eight touch points.
Straightforward.

## The Declaration

I added a new `std/io` module:

```temper
@connected("stdSleep")
export let sleep(ms: Int): Promise<Empty> { panic() }

@connected("stdReadLine")
export let readLine(): Promise<String?> { panic() }
```

`sleep` returns `Promise<Empty>` rather than `Promise<Void>` because Temper's `await` requires the type parameter to extend `AnyValue`, and `Void` does not.
This is the kind of detail that makes you close your laptop and go for a walk.

The bodies are `panic()`.
This is a convention.
The `@connected` decorator ensures the panic is never reached.
If it is reached, something has gone very wrong and panicking seems appropriate.

## JavaScript

JS was the easy one.
It has Promises.
It has `setTimeout`.
It has an event loop.
Everything I needed was right there.

The JS backend has an "auto-connected" pattern where you just add the key name to a list and it maps to an exported function with the same name.
Two lines in `JsSupportNetwork.kt`, one file registration in `JsBackend.kt`, one export line, and the runtime:

```javascript
export function stdSleep(ms) {
  return new Promise(resolve => setTimeout(() => resolve(empty()), ms));
}
```

Three lines of meaningful code.
`stdReadLine` listens on `process.stdin` with raw mode for single-keypress input.
I was done with this one in about twenty minutes.

## Python

Python's Temper runtime already had a `ThreadPoolExecutor` and a `Future`-based promise system from `stdNetSend`.
Sleep submits `time.sleep()` to a worker thread.
ReadLine uses `tty.setraw()` for single-keypress input with `termios` to restore the terminal afterward.

The interesting part is that Python programs need `await_safe_to_exit()` after importing the game module.
Without it, the main thread exits immediately and the worker threads running the game loop get killed.
The process would start, launch two coroutines, and then exit before either of them did anything.
A standard Python async experience.

Two entries in `PySupportNetwork.kt`, about 30 lines of runtime code.

```python
def std_sleep(ms: int) -> 'Future[None]':
    f: Future[None] = new_unbound_promise()
    def _do_sleep():
        _time.sleep(ms / 1000.0)
        f.set_result(None)
    _executor.submit(_do_sleep)
    return f
```

The sleep happens on a worker thread.
The `Future` resolves when done.
The main thread's generator-based coroutine system picks up the resolution via the existing `_step_async_coro` machinery.
Nothing revolutionary, but it works and it works well.

## Lua

Lua was the one that got interesting.

Lua has no Promises.
No event loop.
No threads.
No async/await.

The Temper compiler's Lua backend compiled `async { ... }` blocks to calls to `temper.TODO()`.
This was literally the function name.
`TODO`.
The implementation:

```lua
function temper.TODO(generatorFactory)
    local gen = generatorFactory()
    local co = gen()
end
```

It creates a coroutine, steps it once, and abandons it.

The function is called `TODO` because implementing real async for Lua was deferred.
It was deferred until someone (me) wanted to play snake.

The snake game has two async blocks: an input reader that loops calling `readLine()`, and a game loop that ticks every 200ms calling `sleep()`.
With the `TODO` implementation, the first block would start, immediately call `readLine()`, which would block the entire Lua process waiting for input.
The game loop would never start.
You would see a cursor.
Nothing else.

The fix required building a cooperative coroutine scheduler from scratch.
About 120 lines of Lua.

The scheduler has three promise types.
`PROMISE_SLEEP` carries a wall-clock deadline.
`PROMISE_READLINE` signals that the coroutine wants a keypress.
`PROMISE_RESOLVED` means the value is ready.
Each promise's `:await()` method calls `coroutine.yield(self)`, handing the promise object back to the scheduler so it knows what the coroutine is waiting for.

`temper.stdsleep(ms)` no longer blocks.

It returns a sleep promise with a deadline.

`temper.stdreadline()` no longer blocks.

It returns a readline promise.

The scheduler runs a round-robin loop: check each coroutine's promise, resume the ones that are ready.

For sleep, compare the deadline against `os.time()`.

For readline, poll the terminal with `stty min 0 time 0` — non-blocking read, zero timeout.

When nothing is ready, sleep 10ms to avoid melting the CPU.

The compiler also needed changes.

`LuaSupportNetwork.kt` had to map `BuiltinOperatorId.Async` to `"async_launch"` instead of `"TODO"`.

`LuaTranslator.kt` had to emit `temper.run_scheduler()` after all top-level code to actually start the scheduler.

This is what it took to make Lua wait 200 milliseconds.

## Rust

Rust has threads.
It also has a custom async runtime in the Temper core library — not tokio, a hand-rolled one based on `Promise<T>`, `PromiseBuilder<T>`, and `SafeGenerator<T>`.
The pattern for connected functions was already established by `stdNetSend`: create a `PromiseBuilder`, spawn a generator on another thread via `run_async()`, complete the promise from the worker.
Sleep spawns a thread that calls `thread::sleep`.
ReadLine spawns a thread that reads stdin with raw terminal mode via `libc::tcgetattr`/`tcsetattr`.

The implementation was clean.
The build system was not.

Connected functions in the Rust backend reference their implementations by full crate path: `temper_std::io::std_sleep`.
The function lives in the `temper-std` crate.
But when the Rust backend generates `Cargo.toml` for a library that uses these functions, it scans `module.imports` for `CrossLibraryPath` entries to determine dependencies.
Connected functions don't go through imports.
They bypass the import system entirely — the compiler resolves them during an earlier stage and replaces them with inline support code references.
By the time the Rust backend looks at the module, the `import("std/io")` is gone.

So the generated `Cargo.toml` had `temper-core` and `snake` as dependencies, but not `temper-std`.
The generated code called `temper_std::io::std_sleep()`.
Cargo said no.
The game did not compile.

The fix was to add a second dependency-detection pass.
`RustTranslator` now tracks a set called `usedSupportFunctionPaths`.
When `translateCallExpressionForSupportCode` processes a `FunctionCall`, it records the function path.
After translation, `RustBackend` scans these paths for anything starting with `temper_std::`, extracts the module name, and injects `temper-std` as a dependency with the appropriate Cargo features.
This also fixed the missing `temper_std::init()` call in the generated `lib.rs`, which was causing a panic at runtime because the std crate's config was never initialized.

Three Kotlin files changed to make Rust's build system aware of dependencies that the compiler's own import resolution had optimized away.
I find this very funny.

## Java

Java maps Temper Promises to `CompletableFuture<T>`.
Sleep submits `Thread.sleep(ms)` to `ForkJoinPool.commonPool()`.
ReadLine uses `stty raw -echo` via `ProcessBuilder` for single-keypress input.

The return type of `stdSleep` is `CompletableFuture<Optional<? super Object>>`.
This is because Temper's `Empty` type maps to Java's `Tuple<object?>` through the `connectedTypes` map, and the generated Java code expects that exact signature.
It is a `CompletableFuture` of an `Optional` of a wildcard-super-Object.
To return nothing.
Java.

The implementation worked immediately.
Then it stopped working after 10 seconds.

The Java runtime's `waitUntilTasksComplete()` method — called from `main()` to keep the JVM alive while async tasks run — was implemented as:

```java
commonPool.awaitQuiescence(10L, TimeUnit.SECONDS);
```

A hard ten-second timeout.
The comment above it said "this timeout is sufficient for functional tests."
It was.
A snake game is not a functional test.
The snake would start moving, eat some food, and then the JVM would exit because ten seconds of snake was deemed sufficient.

The fix is three lines: loop `awaitQuiescence` until `isQuiescent()` returns true.
I briefly considered filing a bug report titled "ten seconds of snake is not enough" but decided against it.

## C#

C# has native `async`/`await`.
The sleep implementation is `await Task.Delay(ms)`.
Three lines of meaningful code.
It is the most natural fit of any backend and required the least thought.

It broke in two completely unrelated ways.

First, the `.csproj` templates targeted `net6.0`.
The machine had .NET 10 installed.
.NET 10 introduces `System.Collections.Generic.OrderedDictionary<TKey, TValue>`, which conflicts with Temper's own `TemperLang.Core.OrderedDictionary<TKey, TValue>`.
The compiler error was `CS0104: 'OrderedDictionary<,>' is an ambiguous reference`.
Same story with `AsReadOnly` — .NET 10 added an extension method that shadows Temper's.

The fix was to update the target framework to `net8.0` (current LTS), and fully namespace-qualify `TemperLang.Core.OrderedDictionary` and `TemperLang.Core.Listed.AsReadOnly` in `RegexSupport.cs`.
Nothing to do with I/O.
Nothing to do with snake.
Just the .NET ecosystem doing .NET ecosystem things.

## The Rendering Bug

After all six backends compiled, built, and ran the game, two of them displayed the board like this:

```
######################
        #                    #
                #                    #
                        #             *      #
```

A diagonal staircase of hash marks.
Very avant-garde.
Not snake.

Python and Java put the terminal in raw mode for single-keypress input.
In raw mode, `\n` moves the cursor down but does not return it to column 0.
Each line of the board started where the previous one ended.
The game looked like it was being played on a parallelogram.

The fix was in the Temper source, not the compiler.
Change `\n` to `\r\n` in `render()`.
The carriage return ensures column 0 in both raw and cooked mode.
Four lines changed in `snake.temper.md`.
The most mundane fix of the entire project, and the one that took the longest to diagnose because I kept assuming it was a logging issue.

## The Game Itself

With all the compiler changes in place, the snake game is unremarkable.
It is a normal snake game.
This is the point.

Everything is immutable.
`SnakeGame` is a class with eight fields.
Every operation returns a new `SnakeGame`.
Directions are a sealed interface with four cases.
`tick()` handles wall collision, self collision, eating, and movement.
`render()` draws an ASCII board with `#` borders, `@` for the head, `o` for the body, and `*` for food.
There is a deterministic PRNG so the food lands in the same place on all six backends.

Division and modulo can bubble in Temper (division by zero), so they're wrapped in `do { expr } orelse 0` throughout.
The `orelse` is Temper's way of catching bubbles, which are Temper's way of saying exceptions, which are Temper's way of saying "the denominator was zero."

The runner has two async blocks sharing a mutable `inputDirection` variable: one reads keypresses in a loop, the other ticks the game every 200ms.
This is the code that was impossible before the compiler changes.

There is a `brain.temper.md` file that exports a `move()` function you can replace with your own snake AI.
The default implementation returns `new Right()`.
The snake goes right until it hits a wall.
It is not a good AI.

18 tests cover initial state, movement, direction rejection, collision, PRNG determinism, and post-game-over behavior.

## Running It

You don't have to build the compiler.
CI publishes standalone repos for all six backends:

| Language | Repository | Run |
|----------|------------|-----|
| JavaScript | [snake-js](https://github.com/notactuallytreyanastasio/snake-js) | `node snake-game/index.js` |
| Python | [snake-python](https://github.com/notactuallytreyanastasio/snake-python) | See repo README |
| Lua | [snake-lua](https://github.com/notactuallytreyanastasio/snake-lua) | `lua snake-game/init.lua` |
| Rust | [snake-rust](https://github.com/notactuallytreyanastasio/snake-rust) | `cd snake-game && cargo run` |
| C# | [snake-csharp](https://github.com/notactuallytreyanastasio/snake-csharp) | `dotnet run --project snake-game` |
| Java | [snake-java](https://github.com/notactuallytreyanastasio/snake-java) | `bash run.sh` |

Every push to this repo triggers a GitHub Actions pipeline that checks out the compiler branch, builds it from source, compiles the game for all 6 backends, runs 18 tests, and publishes to the target repos via SSH deploy keys.
The output stays in sync automatically.

If you want to build everything yourself:

```bash
# Build the compiler
git clone https://github.com/temperlang/temper.git
cd temper && git checkout do-crimes-to-play-snake
./gradlew installDist
# Put cli/build/install/temper/bin/temper on your PATH

# Build the game
cd /path/to/snake
temper build -b js      # or py, lua, rust, csharp, java

# Run it
node temper.out/js/snake-game/index.js
```

Controls are w/a/s/d.
No Enter key.
The snake starts going right.

For some reason, with the Rust version, you have to hit a button for it to start.

## The Numbers

32 files changed across the compiler.

616 lines of insertion.

Two functions added to the standard library.

One cooperative coroutine scheduler written for a language that doesn't have threads.

One dependency detection system patched because the compiler optimized away its own imports.

One hard-coded timeout removed because ten seconds of snake was not enough.

One target framework bumped because .NET added a class with the same name as one we were already using.

One `\n` changed to `\r\n` because terminals are from the 1970s.

The snake game itself is about 300 lines.

## Project Structure

```
src/
  config.temper.md       - library config
  snake.temper.md        - game logic, types, PRNG, tick, render
  brain.temper.md        - user-editable move() function
game/
  config.temper.md       - game runner config
  run.temper.md          - async input loop + game loop
test/
  config.temper.md       - test module config
  snake_test.temper.md   - 18 unit tests
```
