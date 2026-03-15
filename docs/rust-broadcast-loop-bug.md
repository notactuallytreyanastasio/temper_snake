# Rust Backend: Broadcast Loop Await Bug

## Summary

A bug in Temper's Rust backend code generation causes `for`/`while` loop
variables to not reset between iterations of an enclosing loop when the
inner loop body contains an `await` expression. This caused the multiplayer
server to send only one frame to clients despite ticking correctly.

## The Temper Code

```temper
while (running) {
  game = multiTick(game, dirs.toList());
  let frame = multiRender(game);
  let conns = wsConns.toList();

  // Bug: loop variable `ci` doesn't reset on next `while` iteration
  for (var ci = 0; ci < conns.length; ++ci) {
    do {
      let conn = conns.get(ci);
      await wsSend(conn, frame);   // <-- the problematic await
    } orelse void;
  }

  await sleep(200);
}
```

## What Happens

The Rust backend compiles async blocks into state machines using a
`match caseIndex { 0 => ..., 1 => ..., ... }` pattern. Each `await`
creates a yield point that splits the code into separate cases.

For the broadcast loop, the compiled state machine looks approximately like:

```
Case 7: Initialize ci = 0, goto 8
Case 8: Check ci < conns.length. If true, goto 9. If false, goto 11.
Case 9: Get conn, call wsSend, store promise, register on_ready callback,
        set caseIndex = 10, YIELD (return Some(()))
Case 10: Get wsSend result, ci++, goto 8
Case 11: Call sleep(200), register on_ready, set caseIndex = 12, YIELD
Case 12: Get sleep result, goto 6 (back to top of while loop)
Case 6: Check running(), goto 7
Case 7: Initialize ci = 0  <-- SHOULD run, but doesn't
```

## The Bug

When `wsSend` resolves **synchronously** (which it does — it's just a
channel push that completes immediately), the `on_ready` callback fires
inline during Case 9's execution. This callback calls `generator.next()`,
which re-enters the state machine at Case 10.

Case 10 increments `ci` to 1, then jumps to Case 8. `ci` (1) is not less
than `conns.length` (1), so it jumps to Case 11 (sleep). The sleep promise
is **not** resolved immediately (it takes 200ms), so `on_ready` stores the
callback and the generator actually yields.

When the sleep completes 200ms later, the generator resumes at Case 12.
Case 12 jumps to Case 6 (while check). Case 6 jumps to Case 7.

**Case 7 should reset `ci` to 0.** But due to how the state machine
handles re-entrant `generator.next()` calls from synchronous promise
resolution, the Case 7 initialization is skipped on subsequent iterations.

The `ci` variable is stored as `Arc<RwLock<i32>>` on the generator's
closure struct. It persists across all cases. After the first broadcast
loop completes with `ci = 1`, subsequent outer-loop iterations find
`ci` still equals 1 at Case 8, immediately fail the `ci < conns.length`
check, and skip the entire broadcast.

## Evidence

Server debug output with the buggy code:

```
tick 1 conns=1     ← conns has 1 element
sending to 0       ← ci=0, sends frame
sent ok
tick 2 conns=1     ← conns still has 1 element
                   ← NO "sending to 0" — loop body never executes
tick 3 conns=1
tick 4 conns=1     ← 17 more ticks with no sends
...
```

The game loop ticked 18 times but `wsSend` was called exactly once.

## The Fix

Replace the `for` loop + `await` with `for..of` (which compiles to
`list_for_each`, a synchronous callback) and drop the `await`:

```temper
// Before (broken):
for (var ci = 0; ci < conns.length; ++ci) {
  do {
    let conn = conns.get(ci);
    await wsSend(conn, frame);
  } orelse void;
}

// After (working):
for (let conn of conns) {
  do { wsSend(conn, frame) } orelse void;
}
```

This works because:

1. `for..of` compiles to `temper_core::listed::list_for_each()`, which is
   a single synchronous function call with a callback — no loop variable,
   no state machine case splitting.

2. `wsSend` without `await` just calls the function and ignores the
   returned Promise. Since our Rust `wsSend` implementation is synchronous
   (it pushes to a channel and calls `pb.complete(())` immediately), the
   send completes as a side effect. The Promise is resolved but never
   awaited.

## Compiled Output Comparison

**Buggy version** (for loop + await): ~6 state machine cases for the
broadcast, with `ci` as a persistent `Arc<RwLock<i32>>` field:

```rust
// Case 8: check loop
if temper_core::read_locked(&self.ci__55) < conns_length {
    caseIndex = 9; // enter loop body
} else {
    caseIndex = 11; // exit loop → sleep
}

// Case 9: loop body (with await)
promise = Some(temper_std::ws::std_ws_send(&conn, frame));
caseIndex = 10;
promise.on_ready(|| generator.next()); // re-entrant!
return Some(()); // yield

// Case 10: after send
ci++; // ci persists as Arc<RwLock<i32>>
caseIndex = 8; // back to check
```

**Fixed version** (for..of, no await): single case, no loop variable:

```rust
// Case 9: tick, render, broadcast, sleep
game = multi_tick(game, dirs);
let frame = multi_render(game);
let conns = ws_conns().to_list();

// Broadcast — single synchronous call, no state machine involvement
temper_core::listed::list_for_each(&conns, &|conn| {
    temper_std::ws::std_ws_send(&conn, frame.clone());
});

// Sleep
promise = Some(std_sleep(200));
caseIndex = 11;
promise.on_ready(|| generator.next());
return Some(()); // yield
```

## Root Cause: `for` variable init compiled as struct field default

The Rust backend compiles `for (var i = 0; ...)` by creating `i` as a
field on the generator's closure struct with an initial value of 0:

```rust
let mut i__8: Arc<RwLock<i32>> = Arc::new(RwLock::new(0)); // generator creation
```

This initialization runs **once** when the generator is created. The state
machine never re-executes `i = 0` when the enclosing loop iterates.
After the first inner loop completes with `i = 3`, subsequent outer loop
iterations find `i` still at 3, fail the `i < items.length` check
immediately, and skip the inner loop entirely.

The same issue affects `var` declarations with initializers inside any
loop that contains an `await` — the `var x = initial_value` is treated
as a struct field default, not as a per-iteration assignment.

## Minimal Reproduction (Temper main, no dependencies)

```temper
let resolved(): Promise<Empty> {
  let pb = new PromiseBuilder<Empty>();
  pb.complete(empty());
  pb.promise
}

var outerCount = 0;
var totalLoopBodyRuns = 0;

async { (): GeneratorResult<Empty> extends GeneratorFn =>
  do {
    let items: List<Int> = [10, 20, 30];
    while (outerCount < 3) {
      outerCount = outerCount + 1;
      for (var i = 0; i < items.length; ++i) {
        totalLoopBodyRuns = totalLoopBodyRuns + 1;
        await resolved();
      }
    }
    // JS:   "total loop body runs: 9" — PASS
    // Rust: "total loop body runs: 3" — FAIL
    console.log("total: ${totalLoopBodyRuns.toString()}");
  } orelse void;
}
```

**JS output:** `total loop body runs: 9` (3 outer × 3 inner)
**Rust output:** `total loop body runs: 3` (inner loop only runs once)

Tested on Temper `main` branch (commit `cb8c3d5`). No `std/io`, no
WebSocket, no external dependencies. Just core Temper primitives.

## Compiled Rust Evidence

The compiled state machine for the for loop:

```rust
// Generator struct field — initialized ONCE at creation
let mut i__8: Arc<RwLock<i32>> = Arc::new(RwLock::new(0));

// Case 3: for loop check (NO i=0 reset here)
3 => {
    t___60 = ListedTrait::len(&items);
    if !(Some(i__8) < Some(t___60)) {
        caseIndex = 4; // exit loop
    } else {
        caseIndex = 5; // enter body
    }
}

// Case 7: increment
7 => {
    i__8 = i__8 + 1;
    caseIndex = 3; // back to check
}
```

There is no `i__8 = 0` assignment in any state machine case.

## Scope

This bug affects **any** `for (var i = 0; ...)` loop inside a `while`
loop when the `for` body contains an `await`, compiled to the Rust
backend. It is independent of:

- Whether the Promise resolves synchronously or asynchronously
- Whether the `await` is wrapped in `do { ... } orelse void`
- What type the loop iterates over
- Whether `@connected` functions are involved

The JS backend is not affected because its generator-based async model
handles loop variable scoping differently.

The bug is in the Temper Rust backend's coroutine-to-state-machine
transformation (`TranslateToRegularFunction` strategy). The compiler
hoists `var` declarations to generator struct fields but does not emit
re-initialization assignments at the corresponding loop entry points
in the state machine.

## Workarounds

1. **Use `for..of` instead of indexed `for`** — avoids loop variables entirely
2. **Don't `await` inside loops** — keeps the loop as a single state machine case
3. **Extract the loop body to a helper** — isolates the await from the loop variable
