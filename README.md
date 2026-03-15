# Snake

A snake game written in [Temper](https://github.com/temperlang/temper), a programming language that compiles to six other programming languages.
The game is about 300 lines.
The compiler changes required to make it run are about 600.

Compiler branch: [`do-more-crimes-to-play-snake-multiplayer`](https://github.com/temperlang/temper/tree/do-more-crimes-to-play-snake-multiplayer) (extends [`do-crimes-to-play-snake`](https://github.com/temperlang/temper/tree/do-crimes-to-play-snake) with WebSocket and terminal size support)

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

**`JsSupportNetwork.kt`** — register the keys:

```diff
     "String::toInt32",
     "String::toInt64",
     "StringBuilder::appendCodePoint",
+    // std/io
+    "stdSleep",
+    "stdReadLine",
     // std/net
     "stdNetSend",
```

**`JsBackend.kt`** — register the resource file:

```diff
             filePath("deque.js"),
             filePath("float.js"),
             filePath("interface.js"),
+            filePath("io.js"),
             filePath("listed.js"),
```

**`temper-core/index.js`** — export the module:

```diff
 export * from "./interface.js";
 export * from "./listed.js";
 export * from "./mapped.js";
+export * from "./io.js";
 export * from "./net.js";
```

**`temper-core/io.js`** — the runtime:

```javascript
import { empty } from "./core.js";

export function stdSleep(ms) {
  return new Promise(resolve => setTimeout(() => resolve(empty()), ms));
}

export function stdReadLine() {
  return new Promise(resolve => {
    if (typeof process !== 'undefined' && process.stdin) {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.once('data', data => {
        const str = data.toString();
        if (str === '\x03') { process.exit(); }
        resolve(str.trim());
      });
    } else {
      resolve(null);
    }
  });
}
```

Three lines of meaningful code for sleep.
`stdReadLine` listens on `process.stdin` with raw mode for single-keypress input, with manual Ctrl+C detection because raw mode bypasses the default signal handler.
I was done with this one in about twenty minutes.

## Python

Python's Temper runtime already had a `ThreadPoolExecutor` and a `Future`-based promise system from `stdNetSend`.
Sleep submits `time.sleep()` to a worker thread.
ReadLine uses `tty.setraw()` for single-keypress input with `termios` to restore the terminal afterward.

The interesting part is that Python programs need `await_safe_to_exit()` after importing the game module.
Without it, the main thread exits immediately and the worker threads running the game loop get killed.
The process would start, launch two coroutines, and then exit before either of them did anything.
A standard Python async experience.

**`PySupportNetwork.kt`** — register as `PySeparateCode` pointing to runtime functions:

```diff
 val StdNetSend = PySeparateCode("std_net_send", RUNTIME)
+val StdSleep = PySeparateCode("std_sleep", RUNTIME)
+val StdReadLine = PySeparateCode("std_read_line", RUNTIME)
```

```diff
     "stdNetSend" to StdNetSend,
+    "stdSleep" to StdSleep,
+    "stdReadLine" to StdReadLine,
 )
```

**`temper_core/__init__.py`** — the runtime:

```python
import time as _time

def std_sleep(ms: int) -> 'Future[None]':
    f: Future[None] = new_unbound_promise()
    def _do_sleep():
        _time.sleep(ms / 1000.0)
        f.set_result(None)
    _executor.submit(_do_sleep)
    return f

def std_read_line() -> 'Future[Optional[str]]':
    f: 'Future[Optional[str]]' = new_unbound_promise()
    def _do_read():
        try:
            if _sys.stdin.isatty():
                import tty as _tty, termios as _termios
                fd = _sys.stdin.fileno()
                old_settings = _termios.tcgetattr(fd)
                try:
                    _tty.setraw(fd)
                    ch = _sys.stdin.read(1)
                    if ch == '\x03':
                        _termios.tcsetattr(fd, _termios.TCSADRAIN, old_settings)
                        import os as _os
                        _os.kill(_os.getpid(), 2)
                    f.set_result(ch)
                finally:
                    _termios.tcsetattr(fd, _termios.TCSADRAIN, old_settings)
            else:
                line = input()
                f.set_result(line)
        except EOFError:
            f.set_result(None)
    _executor.submit(_do_read)
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

**`LuaSupportNetwork.kt`** — map the Async operator:

```diff
-    BuiltinOperatorId.Async -> "TODO" // TODO
+    BuiltinOperatorId.Async -> "async_launch"
```

**`LuaTranslator.kt`** — emit the scheduler call after all top-level code:

```kotlin
// Run the cooperative scheduler if any async blocks were registered.
add(Lua.CallStmt(pos, Lua.FunctionCallExpr(
    pos,
    Lua.DotIndexExpr(pos, Lua.Name(pos, name("temper")),
                          Lua.Name(pos, name("run_scheduler"))),
    Lua.Args(pos, Lua.Exprs(pos, listOf())),
)))
```

This is what it took to make Lua wait 200 milliseconds.

## Rust

Rust has threads.
It also has a custom async runtime in the Temper core library — not tokio, a hand-rolled one based on `Promise<T>`, `PromiseBuilder<T>`, and `SafeGenerator<T>`.
The pattern for connected functions was already established by `stdNetSend`: create a `PromiseBuilder`, spawn a generator on another thread via `run_async()`, complete the promise from the worker.
Sleep spawns a thread that calls `thread::sleep`.
ReadLine spawns a thread that reads stdin with raw terminal mode via `libc::tcgetattr`/`tcsetattr`.

**`RustSupportNetwork.kt`** — register with full crate paths for cross-crate calls:

```diff
 private val netSend = FunctionCall("stdNetSend", "send_request", cloneEvenIfFirst = true)
+private val stdSleep = FunctionCall("stdSleep", "temper_std::io::std_sleep")
+private val stdReadLine = FunctionCall("stdReadLine", "temper_std::io::std_read_line")
```

**`RustBackend.kt`** — add `"io"` to the support needers set and Cargo features:

```diff
-val stdSupportNeeders = setOf("net", "regex", "temporal")
+val stdSupportNeeders = setOf("io", "net", "regex", "temporal")
```

```diff
 append("[features]\n")
+append("io = []\n")
 append("net = [\"ureq\"]\n")
```

The `io` feature has no external dependencies — just std library.

**`std/io/support.rs`** — the runtime:

```rust
pub fn std_sleep(ms: i32) -> Promise<()> {
    let pb = PromiseBuilder::new();
    let promise = pb.promise();
    crate::run_async(Arc::new(move || {
        let pb = pb.clone();
        SafeGenerator::from_fn(Arc::new(move |_generator: SafeGenerator<()>| {
            std::thread::sleep(std::time::Duration::from_millis(ms as u64));
            pb.complete(());
            None
        }))
    }));
    promise
}
```

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

**`RustTranslator.kt`** — track connected function paths:

```diff
+val usedSupportFunctionPaths = mutableSetOf<String>()
```

```diff
+// Track external crate references from connected functions.
+if (supportCode is FunctionCall) {
+    usedSupportFunctionPaths.add(supportCode.functionName)
+}
```

**`RustBackend.kt`** — scan for `temper_std::*` after translation and inject the dependency:

```kotlin
val usedStdModules = allUsedSupportPaths
    .filter { it.startsWith("$stdCrateName::") }
    .mapNotNull { it.split("::").getOrNull(1) }
    .filter { it in stdFeatures }
    .toSet()
if (usedStdModules.isNotEmpty()) {
    // ... inject temper-std dep with correct features
}
```

This also fixed the missing `temper_std::init()` call in the generated `lib.rs`, which was causing a panic at runtime because the std crate's config was never initialized.

Three Kotlin files changed to make Rust's build system aware of dependencies that the compiler's own import resolution had optimized away.
I find this very funny.

## Java

Java maps Temper Promises to `CompletableFuture<T>`.

**`StandardNames.kt`** — register qualified names:

```diff
+// std/io
+val temperStdSleep = temperCore.qualifyKnownSafe("stdSleep")
+val temperStdReadLine = temperCore.qualifyKnownSafe("stdReadLine")
```

**`JavaSupportNetwork.kt`** — add `separateCode` entries:

```diff
+// std/io support
+val JavaLang.stdSleep by receiver { separateCode(temperStdSleep) }
+val JavaLang.stdReadLine by receiver { separateCode(temperStdReadLine) }
```

```diff
     "stdNetSend" to { it.netCoreStdNetSend },
+    "stdSleep" to { it.stdSleep },
+    "stdReadLine" to { it.stdReadLine },
 )
```

**`Core.java`** — the runtime:

```java
@SuppressWarnings("unchecked")
public static CompletableFuture<Optional<? super Object>> stdSleep(int ms) {
    CompletableFuture<Optional<? super Object>> future = new CompletableFuture<>();
    ForkJoinPool.commonPool().execute(() -> {
        try {
            Thread.sleep(ms);
            future.complete(Optional.empty());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            future.completeExceptionally(e);
        }
    });
    return future;
}
```

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
It is the most natural fit of any backend and required the least thought.

**`CSharpSupportNetwork.kt`** — add `StaticCall` entries:

```diff
+private val stdSleep = StaticCall(
+    "stdSleep",
+    StandardNames.temperStdIoStdSleep,
+)
+
+private val stdReadLine = StaticCall(
+    "stdReadLine",
+    StandardNames.temperStdIoStdReadLine,
+)
```

**`std/Io/IoSupport.cs`** — the runtime:

```csharp
public static async Task<Tuple<object?>> StdSleep(int ms)
{
    await Task.Delay(ms);
    return Tuple.Create<object?>(null);
}

public static async Task<string?> StdReadLine()
{
    return await Task.Run(() =>
    {
        if (Console.IsInputRedirected) { return Console.ReadLine(); }
        var key = Console.ReadKey(true);
        if (key.Key == ConsoleKey.C && key.Modifiers.HasFlag(ConsoleModifiers.Control))
            Environment.Exit(1);
        return key.KeyChar.ToString();
    });
}
```

Three lines of meaningful code for sleep.
The return type is `Task<Tuple<object?>>` because C# maps Temper's `Empty` to `System.Tuple` through the connected types system.

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

Every push to this repo triggers a GitHub Actions pipeline that checks out the [`do-more-crimes-to-play-snake-multiplayer`](https://github.com/temperlang/temper/tree/do-more-crimes-to-play-snake-multiplayer) compiler branch, builds it from source with `./gradlew installDist`, compiles the game for all 6 backends, runs 31 tests, and if they pass, publishes the compiled output to the 6 target repositories via SSH deploy keys.
The compiled output stays in sync automatically.
You clone one repo, run one command, and you're playing snake.

Each target repo's README explains exactly what had to change in the Temper compiler to make that specific backend work.
The Lua one is the most interesting.

Source + CI: [temper_snake](https://github.com/notactuallytreyanastasio/temper_snake)

## Building It Yourself

If you want to build everything from source instead of using the published repos, you will need:

- JDK 21 (to build the Temper compiler, which is written in Kotlin)
- Node.js 18+ (for the JS backend)
- Python 3.11+ (for the Python backend)
- Lua 5.1 or 5.4 (for the Lua backend)
- Rust 1.71+ with Cargo (for the Rust backend)
- .NET 8.0+ SDK (for the C# backend)
- Java 17+ with Maven (for the Java backend)

You do not need all of them.
Pick a backend.

Here is how to build and run each one:

```bash
# Build the compiler
git clone https://github.com/temperlang/temper.git
cd temper && git checkout do-more-crimes-to-play-snake-multiplayer
./gradlew installDist
# The CLI is at cli/build/install/temper/bin/temper — add it to your PATH

# Clone and build the game
git clone https://github.com/notactuallytreyanastasio/temper_snake.git
cd temper_snake
temper build -b js
temper build -b py
temper build -b lua
temper build -b rust
temper build -b csharp
temper build -b java
```

Then run whichever backend you like:

```bash
# JavaScript
node temper.out/js/snake-game/index.js

# Python
cd temper.out/py
python3 -m venv .venv && source .venv/bin/activate
pip install -e ./temper-core -e ./std -e ./snake -e ./snake-game
python -c "from temper_core import init_simple_logging, await_safe_to_exit; init_simple_logging(); from snake_game import snake_game; await_safe_to_exit()"

# Lua
cd temper.out/lua && lua snake-game/init.lua

# Rust
cd temper.out/rust/snake-game && cargo run

# C#
dotnet run --project temper.out/csharp/snake-game/program/

# Java
mvn -f temper.out/java/temper-core/pom.xml install -Dgpg.skip=true -DskipTests -q
mvn -f temper.out/java/snake/pom.xml install -Dgpg.skip=true -DskipTests -q
mvn -f temper.out/java/snake-game/pom.xml compile exec:java@snake_game.SnakeGameMain -Dgpg.skip=true -q
```

## Tests

```bash
temper test -b js
```

31 tests.
They pass.

## Controls

w/a/s/d keys.
No Enter needed — all backends use raw terminal mode for single-keypress input.
The snake starts going right.

For some reason, with the Rust version, you have to hit a button for it to start.

## Multiplayer

The single-player game was fine.
But it was lonely.

The obvious next step was to make it multiplayer.
Over the network.
Using WebSockets.
Written in Temper.
Compiled to all the backends.

There was, again, a problem.
Temper had no network stack.
It could not open a socket.
It could not listen on a port.
It could not send or receive messages over a wire.

The obvious solution was to modify the compiler between the hours of 1am and 5am on a different Saturday.

### The WebSocket Module

I added a new `std/ws` module to the Temper standard library with six connected functions and two opaque types:

```temper
@connected("WsServer")
export interface WsServer {}

@connected("WsConnection")
export interface WsConnection {}

@connected("wsListen")
export let wsListen(port: Int): Promise<WsServer> { panic() }

@connected("wsAccept")
export let wsAccept(server: WsServer): Promise<WsConnection> { panic() }

@connected("wsConnect")
export let wsConnect(url: String): Promise<WsConnection> { panic() }

@connected("wsSend")
export let wsSend(conn: WsConnection, msg: String): Promise<Empty> { panic() }

@connected("wsRecv")
export let wsRecv(conn: WsConnection): Promise<String?> { panic() }

@connected("wsClose")
export let wsClose(conn: WsConnection): Promise<Empty> { panic() }
```

`WsServer` and `WsConnection` are opaque `@connected` interfaces — empty in Temper, backed by native WebSocket objects in each backend.
The JS implementation uses the `ws` npm package with a message queue pattern (messages that arrive before `wsRecv` is called get buffered).
The Rust implementation uses `tungstenite` with `Mutex`-wrapped connections for thread safety.

I also added `terminalColumns()` and `terminalRows()` to `std/io` so the server can size the board to fit the terminal.

Compiler branch: [`do-more-crimes-to-play-snake-multiplayer`](https://github.com/temperlang/temper/tree/do-more-crimes-to-play-snake-multiplayer)

### Multi-Snake Game Logic

The single-player `SnakeGame` has one snake.
The multiplayer `MultiSnakeGame` has a `List<PlayerSnake>`, each with their own segments, direction, score, and alive/dead status.

`multiTick` handles the collision detection that makes multiplayer interesting:

1. Wall collision — each snake checked independently
2. Self collision — your head hits your own body
3. Head-to-body — your head hits another snake's body
4. Head-to-head — two snakes move to the same cell, both die

Each player gets distinct symbols: `@`/`o` for player 0, `#`/`+` for player 1, `$`/`~` for player 2, and so on.
Food is shared — first snake to reach it gets the point.
Players can join dynamically.
The board scales to the terminal size.

All of this is pure Temper.
It compiles to every backend.
The multiplayer logic is not a wrapper around the compiled output — it IS the compiled output.

### The Protocol

The protocol is deliberately minimal.
The server sends rendered frames directly as WebSocket text messages — the client just prints whatever it receives.
The client sends single-character direction codes: `u`, `d`, `l`, `r`.

No JSON parsing.
No serialization library.
No message framing.
The server renders the game, sends the ASCII art, the client displays it.

### Playing Multiplayer

Pick any backend for the server, any backend for each client.
They all speak the same WebSocket protocol and interoperate freely.

One terminal runs the server, each additional terminal is a player.
Use w/a/s/d to steer. Connect as many players as you want.

#### JavaScript

```bash
temper build -b js
cd temper.out/js && npm install

# Server
node snake-server/index.js

# Client (separate terminal)
node snake-client/index.js
```

#### Rust

```bash
temper build -b rust

# Server
cd temper.out/rust/snake-server && cargo run

# Client (separate terminal)
cd temper.out/rust/snake-client && cargo run
```

#### Python

```bash
temper build -b py
cd temper.out/py
python3 -m venv .venv && source .venv/bin/activate
pip install -e ./temper-core -e ./std -e ./snake -e ./snake-server -e ./snake-client

# Server
python3 -c "
from temper_core import init_simple_logging, await_safe_to_exit
init_simple_logging()
from snake_server import snake_server
await_safe_to_exit()
"

# Client (separate terminal, same venv)
python3 -c "
from temper_core import init_simple_logging, await_safe_to_exit
init_simple_logging()
from snake_client import snake_client
await_safe_to_exit()
"
```

#### Mix and match

Any server works with any client.
A Rust server can host JS and Python clients simultaneously.
A Python server can host Rust clients.
The WebSocket handshake and frame encoding are identical across all three.

```bash
# Example: Rust server, one JS client, one Python client
cd temper.out/rust/snake-server && cargo run          # Terminal 1
cd temper.out/js && node snake-client/index.js        # Terminal 2
python3 -c "...(snake_client)..."                     # Terminal 3
```

The server listens on port 8080.
The board is sized to the server's terminal minus a margin.

## The Numbers

32 files changed across the compiler.

616 lines of insertion.

Two functions added to the standard library.

One cooperative coroutine scheduler written for a language that doesn't have threads.

One dependency detection system patched because the compiler optimized away its own imports.

One hard-coded timeout removed because ten seconds of snake was not enough.

One target framework bumped because .NET added a class with the same name as one we were already using.

One `\n` changed to `\r\n` because terminals are from the 1970s.

The snake game itself is about 300 lines of single-player logic and 400 lines of multiplayer logic.

The WebSocket module added 554 lines to the compiler across 13 files.

Six more connected functions.
Two opaque types.
One message queue pattern.
One `Mutex`-wrapped WebSocket.

## Project Structure

```
src/
  config.temper.md       - library config
  snake.temper.md        - game logic: single-player + multiplayer types, tick, render
  brain.temper.md        - user-editable move() function
game/
  config.temper.md       - single-player game runner config
  run.temper.md          - async input loop + game loop
server/
  config.temper.md       - multiplayer server config
  server.temper.md       - WebSocket server: accept loop, game loop, broadcast
client/
  config.temper.md       - multiplayer client config
  client.temper.md       - WebSocket client: input + display
test/
  config.temper.md       - test module config
  snake_test.temper.md   - 31 unit tests (18 single-player + 13 multiplayer)
```
