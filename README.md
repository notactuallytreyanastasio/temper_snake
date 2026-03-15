# Snake

A snake game written in [Temper](https://github.com/temperlang/temper). Requires the [`do-crimes-to-play-snake`](https://github.com/temperlang/temper/tree/do-crimes-to-play-snake) branch of the Temper compiler ([PR #376](https://github.com/temperlang/temper/pull/376)).

## The Problem

Temper is a multi-backend programming language that compiles to JavaScript, Python, Lua, Rust, Java, and C#. It had types, pattern matching, sealed interfaces, immutable data structures, a test framework, and a generator-based async system. It could compute anything. It could print to the console.

It could not wait.

The only I/O primitive in the standard library was `console.log()`. A program could produce output, but it had no way to pause between outputs, and no way to read input. This meant that writing a game loop — the most fundamental structure in interactive programming — was not possible in pure Temper. You could write the game logic, but running it required a host-language wrapper: a Node.js script calling `setTimeout`, a Python script calling `time.sleep`, something on the outside driving the loop.

We wanted to play snake. In pure Temper. On all six backends. Without wrappers.

This required modifying the compiler.

## Modifying the Compiler

Temper's `@connected` decorator system bridges portable Temper declarations to backend-specific native implementations. A connected function has a Temper signature with a `panic()` body that the compiler replaces at compile time with a call to a native function registered in each backend's support network. The wiring for each connected function follows a four-layer pattern:

1. **Temper declaration** — `@connected("key")` in a `.temper.md` file in `frontend/`
2. **Kotlin SupportNetwork** — registers the key in the backend compiler (`be-*/`)
3. **Runtime implementation** — native code (`.js`, `.py`, `.lua`, `.rs`, `.java`, `.cs`)
4. **Resource registration** — tells the build system to bundle the runtime file

We needed two functions: `sleep(ms)` to pause execution, and `readLine()` to read user input. This commit touches all four layers for all six backends.

### The Temper Declaration ([`0f31c89`](https://github.com/temperlang/temper/commit/0f31c89fabc1c938c6a4d2e72c80af658034aa17))

A new `std/io` module at `frontend/.../std/io/io.temper.md`:

```temper
@connected("stdSleep")
export let sleep(ms: Int): Promise<Empty> { panic() }

@connected("stdReadLine")
export let readLine(): Promise<String?> { panic() }
```

`sleep` returns `Promise<Empty>` rather than `Promise<Void>` because Temper's `await` requires the type parameter to extend `AnyValue`, and `Void` does not. The bodies are `panic()` — a convention matching `stdNetSend` in `std/net`. The `@connected` decorator ensures the body is never reached.

The std config gains the import:

```diff
  import("./temporal");
  import("./json");
  import("./net");
+ import("./io");
```

The initial commit changed 19 files with 254 insertions. Follow-up fixes for backend-specific issues (Lua coroutine scheduler, Rust dependency detection, Java timeout, C# framework update) added 13 more files with 304 insertions. What follows is every change.

---

### JavaScript ([`be-js`](https://github.com/temperlang/temper/commit/0f31c89fabc1c938c6a4d2e72c80af658034aa17#diff-be-js))

The JS backend uses the "auto-connected" pattern: connected keys listed in `supportedAutoConnecteds` are automatically mapped to exported functions whose names match the key. `"stdSleep"` maps to an exported function named `stdSleep`.

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

**`temper-core/io.js`** — the runtime implementation:

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
      process.stdin.once('data', data => {
        resolve(data.toString().trim());
      });
    } else {
      resolve(null);
    }
  });
}
```

`stdSleep` returns a native JS `Promise` that resolves after `ms` milliseconds via `setTimeout`. It resolves with `empty()` (the Temper `Empty` singleton) to match the `Promise<Empty>` return type. `stdReadLine` listens for a single `data` event on `process.stdin`, or resolves with `null` in environments without stdin (browser).

The follow-up commit [`c61b208`](https://github.com/temperlang/temper/commit/c61b208a94917993a8b062712d94bf18bf17faa4) adds raw mode for single-keypress input:

```diff
       process.stdin.resume();
       process.stdin.setEncoding('utf8');
+      if (process.stdin.isTTY && process.stdin.setRawMode) {
+        process.stdin.setRawMode(true);
+      }
       process.stdin.once('data', data => {
-        resolve(data.toString().trim());
+        const str = data.toString();
+        // Ctrl+C in raw mode
+        if (str === '\x03') {
+          process.exit();
+        }
+        resolve(str.trim());
       });
```

This enables single-keypress input without requiring Enter, which is what a snake game needs.

---

### Python ([`be-py`](https://github.com/temperlang/temper/commit/0f31c89fabc1c938c6a4d2e72c80af658034aa17#diff-be-py))

Python's async model uses `concurrent.futures.Future` with a `ThreadPoolExecutor`. The existing `_executor` and `new_unbound_promise()` infrastructure (already used by `stdNetSend`) is reused.

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

**`temper_core/__init__.py`** — the runtime implementation:

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
            line = input()
            f.set_result(line)
        except EOFError:
            f.set_result(None)
    _executor.submit(_do_read)
    return f
```

The sleep happens on a worker thread. The `Future` resolves when done. The main thread's generator-based coroutine system picks up the resolution via the existing `_step_async_coro` machinery. Python programs need `await_safe_to_exit()` to keep the process alive until all async tasks complete.

---

### Lua ([`be-lua`](https://github.com/temperlang/temper/commit/0f31c89fabc1c938c6a4d2e72c80af658034aa17#diff-be-lua))

Lua is the most interesting case. It has no Promises, no event loop, and no async/await. The Lua translator compiles `async { ... }` to `temper.async_launch(generatorFactory)` and `await expr` to `expr:await()`. After all async blocks are registered, the compiler emits `temper.run_scheduler()` to drive the cooperative coroutine loop.

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
    Lua.DotIndexExpr(pos, Lua.Name(pos, name("temper")), Lua.Name(pos, name("run_scheduler"))),
    Lua.Args(pos, Lua.Exprs(pos, listOf())),
)))
```

**`temper-core/init.lua`** — cooperative coroutine scheduler:

Lua is single-threaded, so two concurrent async blocks (input reader + game loop) cannot both block. The runtime implements a cooperative scheduler with three promise types (`PROMISE_SLEEP`, `PROMISE_READLINE`, `PROMISE_RESOLVED`). Each promise's `:await()` method calls `coro_yield(self)` to hand control back to the scheduler. `temper.stdsleep(ms)` returns a sleep promise with a wall-clock deadline. `temper.stdreadline()` returns a readline promise. Neither blocks.

`temper.async_launch(generatorFactory)` registers a coroutine in the task queue and steps it once to start. `temper.run_scheduler()` runs a round-robin loop: it checks sleep deadlines against `os.time()`, polls for non-blocking input via `stty min 0 time 0`, and resumes ready coroutines. When only readline tasks remain (game over), it exits. A 10ms sleep prevents busy-spinning between polls.

---

### Rust ([`be-rust`](https://github.com/temperlang/temper/commit/0f31c89fabc1c938c6a4d2e72c80af658034aa17#diff-be-rust))

Rust uses a custom async runtime (not tokio) based on `Promise<T>`, `PromiseBuilder<T>`, and `SafeGenerator<T>`. The pattern matches `stdNetSend` exactly: create a `PromiseBuilder`, spawn async work via `run_async()`, complete the promise from the worker.

**`RustSupportNetwork.kt`** — register with full crate paths for cross-crate calls:

```diff
 private val netSend = FunctionCall("stdNetSend", "send_request", cloneEvenIfFirst = true)
+private val stdSleep = FunctionCall("stdSleep", "temper_std::io::std_sleep")
+private val stdReadLine = FunctionCall("stdReadLine", "temper_std::io::std_read_line")
```

**`RustBackend.kt`** — add `"io"` to the support needers set and the Cargo feature list:

```diff
-val stdSupportNeeders = setOf("net", "regex", "temporal")
+val stdSupportNeeders = setOf("io", "net", "regex", "temporal")
```

```diff
 append("[features]\n")
+append("io = []\n")
 append("net = [\"ureq\"]\n")
```

The `io` feature has no external dependencies — only std library.

**`RustBackend.kt`** — detect `temper-std` dependency from connected functions:

Connected functions like `stdSleep` map to paths like `temper_std::io::std_sleep`, but these bypass the import system. The import-based dependency scan in `RustBackend.kt` only detects explicit `import()` statements. A second pass now scans the translator's `usedSupportFunctionPaths` for `temper_std::*` references and adds the dependency with the appropriate features automatically.

**`RustTranslator.kt`** — track connected function paths:

```diff
+val usedSupportFunctionPaths = mutableSetOf<String>()
```

When `translateCallExpressionForSupportCode` processes a `FunctionCall`, it records the function path. `RustBackend` reads this after translation to inject missing dependencies.

**`std/io/support.rs`** — the runtime implementation:

```rust
use std::sync::Arc;
use std::io::BufRead;
use temper_core::{Promise, PromiseBuilder, SafeGenerator};

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

pub fn std_read_line() -> Promise<Option<Arc<String>>> {
    let pb = PromiseBuilder::new();
    let promise = pb.promise();
    crate::run_async(Arc::new(move || {
        let pb = pb.clone();
        SafeGenerator::from_fn(Arc::new(move |_generator: SafeGenerator<()>| {
            let stdin = std::io::stdin();
            let mut line = String::new();
            match stdin.lock().read_line(&mut line) {
                Ok(0) => pb.complete(None),
                Ok(_) => {
                    let trimmed = line.trim_end_matches('\n')
                                      .trim_end_matches('\r');
                    pb.complete(Some(Arc::new(trimmed.to_string())));
                }
                Err(_) => pb.complete(None),
            }
            None
        }))
    }));
    promise
}
```

Each function creates a `PromiseBuilder`, spawns a `SafeGenerator` via `run_async`, and returns the `Promise` immediately. The generator runs on a separate thread and completes the promise when done.

---

### Java ([`be-java`](https://github.com/temperlang/temper/commit/0f31c89fabc1c938c6a4d2e72c80af658034aa17#diff-be-java))

Java maps Temper Promises to `CompletableFuture<T>`. The implementation runs blocking I/O on the `ForkJoinPool`.

**`StandardNames.kt`** — register qualified names:

```diff
+// std/io
+val temperStdSleep = temperCore.qualifyKnownSafe("stdSleep")
+val temperStdReadLine = temperCore.qualifyKnownSafe("stdReadLine")
```

**`JavaSupportNetwork.kt`** — add `separateCode` entries and connection map:

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

**`Core.java`** — the runtime implementation:

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

public static CompletableFuture<String> stdReadLine() {
    CompletableFuture<String> future = new CompletableFuture<>();
    ForkJoinPool.commonPool().execute(() -> {
        try {
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(System.in));
            String line = reader.readLine();
            future.complete(line);
        } catch (IOException e) {
            future.complete(null);
        }
    });
    return future;
}
```

The return type of `stdSleep` is `CompletableFuture<Optional<? super Object>>` because Temper's `Empty` type maps to `Tuple<object?>` through the `connectedTypes` map, and the generated Java code expects that signature.

**`Core.java`** — fix `waitUntilTasksComplete()` timeout:

The original implementation used `commonPool.awaitQuiescence(10L, TimeUnit.SECONDS)` — a hard 10-second timeout that would kill any program after 10s. Fixed to loop until truly idle:

```java
while (!commonPool.isQuiescent()) {
    commonPool.awaitQuiescence(60L, TimeUnit.SECONDS);
}
```

---

### C# ([`be-csharp`](https://github.com/temperlang/temper/commit/0f31c89fabc1c938c6a4d2e72c80af658034aa17#diff-be-csharp))

C# has native `async`/`await` with `Task<T>`, making this the most natural fit of any backend.

**`StandardNames.kt`** — register namespace and member names:

```diff
+private val temperStdIo = temperStd.space("Io")
+private val temperStdIoIoSupport = temperStdIo.type("IoSupport")
+val temperStdIoStdSleep = temperStdIoIoSupport.member("StdSleep")
+val temperStdIoStdReadLine = temperStdIoIoSupport.member("StdReadLine")
```

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

**`CSharpBackend.kt`** — register the resource:

```diff
             base = dirPath("lang", "temper", "be", "csharp", "std"),
+            filePath("Io", "IoSupport.cs"),
             filePath("Regex", "IntRangeSet.cs"),
```

**`std/Io/IoSupport.cs`** — the runtime implementation:

```csharp
using System;
using System.Threading.Tasks;

namespace TemperLang.Std.Io
{
    public static class IoSupport
    {
        public static async Task<Tuple<object?>> StdSleep(int ms)
        {
            await Task.Delay(ms);
            return Tuple.Create<object?>(null);
        }

        public static async Task<string?> StdReadLine()
        {
            return await Task.Run(() =>
            {
                try { return Console.ReadLine(); }
                catch (Exception) { return null; }
            });
        }
    }
}
```

Three lines of meaningful code for `StdSleep`. The return type is `Task<Tuple<object?>>` because C# maps Temper's `Empty` to `System.Tuple` through the connected types system.

**Target framework update**: The `.csproj` templates were updated from `net6.0` to `net8.0` (current LTS). The `RegexSupport.cs` now fully qualifies `TemperLang.Core.OrderedDictionary` and `TemperLang.Core.Listed.AsReadOnly` to avoid naming conflicts with `System.Collections.Generic.OrderedDictionary` introduced in .NET 9+.

---

### Functional Tests ([`c61b208`](https://github.com/temperlang/temper/commit/c61b208a94917993a8b062712d94bf18bf17faa4))

The follow-up commit adds a functional test for `sleep()` to the compiler's test suite: sleep returns and execution continues, multiple sequential sleeps work, zero-millisecond sleep is handled, and sleep interleaves correctly with computation.

The test passes on JS, Python, Lua, Java 17, and C#. Rust is skipped because its functional tests don't link `temper-std`. Acceptable.

The language can now wait. The language can now listen.

---

## The Game

With the compiler changes in place, the snake game itself is unremarkable. It is a normal snake game.

### Game Logic (`src/snake.temper.md`)

Everything is immutable. `SnakeGame` is a class with eight fields — width, height, snake body, direction, food position, score, status, and RNG seed. Every operation returns a new `SnakeGame` rather than mutating the existing one.

Directions are a sealed interface with four cases. Points have x and y. `tick()` handles wall collision, self collision, eating, and movement. `render()` draws an ASCII board with `#` borders, `@` for the head, `o` for the body, and `*` for food. There is a deterministic PRNG for food placement so behavior is reproducible across backends.

Food placement tries random positions first, then falls back to a linear scan if the random attempts all land on the snake. This matters when the snake is long. Division and modulo operators can bubble in Temper (division by zero), so they are wrapped in `do { expr } orelse 0` throughout.

### The Brain (`src/brain.temper.md`)

A file the user edits. It exports a `move()` function that receives the head position, body, food, board dimensions, and returns a `Direction`. The default implementation returns `new Right()`. The intent is that you replace it with your own AI.

### The Runner (`game/run.temper.md`)

Two async blocks sharing a mutable `inputDirection` variable:

1. An input loop that calls `readLine()` in a while loop, parses w/a/s/d, and updates the shared direction.
2. A game loop that ticks every 200ms, applies the current direction, and renders to the console.

This is the code that was impossible before the compiler changes. It uses `sleep` and `readLine` from `std/io` — the module that did not exist until we needed it.

### Tests (`test/snake_test.temper.md`)

18 tests covering initial state, movement in all directions, direction rejection (you cannot reverse into yourself), wall collision, self collision, point equality, opposite direction detection, direction deltas, PRNG determinism, PRNG range, and post-game-over behavior. They live in a separate module to avoid `readLine` blocking during test runs.

## Prerequisites

- JDK 21
- Node.js v18+ (for the JS backend)
- Lua 5.1 or 5.4 (for the Lua backend)
- Rust 1.71+ with cargo (for the Rust backend)
- .NET 8.0+ SDK (for the C# backend)
- Python 3.11+ (for the Python backend)
- Maven 3.6+ (for the Java backend)

You do not need all of them. Pick a backend.

## Building the Compiler

This game requires `sleep()` and `readLine()`, which do not exist in the released Temper compiler. You need to build from the [`do-crimes-to-play-snake`](https://github.com/temperlang/temper/tree/do-crimes-to-play-snake) branch:

```bash
git clone https://github.com/temperlang/temper.git
cd temper
git checkout do-crimes-to-play-snake
./gradlew installDist
```

The Temper CLI will be at `cli/build/install/temper/bin/temper`. Add it to your `PATH` or use the full path in subsequent commands.

## Building the Game

```bash
cd /path/to/snake
temper build -b js
temper build -b py
temper build -b lua
temper build -b rust
temper build -b csharp
temper build -b java
```

## Running

Run with the backend directly. `temper run` does not trigger async blocks, so you must invoke the compiled output yourself:

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
mvn -f temper.out/java/temper-core/pom.xml install -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dmaven.source.skip=true -DskipTests
mvn -f temper.out/java/snake/pom.xml install -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dmaven.source.skip=true -DskipTests
mvn -f temper.out/java/snake-game/pom.xml compile exec:java@snake_game.SnakeGameMain -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dmaven.source.skip=true
```

## Tests

```bash
temper test -b js
```

18 tests. They pass.

## Controls

w/a/s/d keys. No Enter needed — all backends use raw terminal mode for single-keypress input. The snake starts going right. Do not go left.

## Published Versions

You do not have to build anything yourself. CI compiles the game for all six backends and publishes standalone repositories. Each contains the compiled output, ready to run.

| Language | Repository | Run |
|----------|------------|-----|
| JavaScript | [snake-js](https://github.com/notactuallytreyanastasio/snake-js) | `node snake-game/index.js` |
| Python | [snake-python](https://github.com/notactuallytreyanastasio/snake-python) | See repo README |
| Lua | [snake-lua](https://github.com/notactuallytreyanastasio/snake-lua) | `lua snake-game/init.lua` |
| Rust | [snake-rust](https://github.com/notactuallytreyanastasio/snake-rust) | `cd snake-game && cargo run` |
| C# | [snake-csharp](https://github.com/notactuallytreyanastasio/snake-csharp) | `dotnet run --project snake-game` |
| Java | [snake-java](https://github.com/notactuallytreyanastasio/snake-java) | See repo README |

Source + CI: [temper_snake](https://github.com/notactuallytreyanastasio/temper_snake)

Every push to the source repo triggers a GitHub Actions pipeline that checks out the [`do-crimes-to-play-snake`](https://github.com/temperlang/temper/tree/do-crimes-to-play-snake) compiler branch, builds it from source, compiles the game for all 6 backends, runs 18 tests, and if they pass, publishes to the 6 target repositories via SSH deploy keys. The compiled output stays in sync automatically.

## Project Structure

```
src/
  config.temper.md       — library config
  snake.temper.md        — game logic, types, PRNG, tick, render
  brain.temper.md        — user-editable move() function
game/
  config.temper.md       — game runner config
  run.temper.md          — async input loop + game loop
test/
  config.temper.md       — test module config
  snake_test.temper.md   — 18 unit tests
TEMPER_REFERENCE.md      — language quick reference
```

## Summary

To play snake, we added `sleep()` and `readLine()` to a programming language. This required changes to a Kotlin compiler, a JavaScript runtime, a Python runtime, a Lua runtime, a Rust runtime, a Java runtime, and a C# runtime. Then we discovered that adding I/O primitives was only half the battle — each backend had its own way of breaking: Lua's `async {}` compiled to a no-op, Rust's dependency detection missed connected functions, Java killed programs after 10 seconds, and C#'s type names collided with .NET 10.

32 files changed across 6 backends. 558 lines of insertion for two functions that most languages ship with. Plus a cooperative coroutine scheduler for Lua because Lua doesn't have threads.

The snake game itself is about 300 lines.
