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

## Root Cause: Re-entrant `generator.next()`

The bug only triggers when the awaited Promise resolves **synchronously**
— that is, when `pb.complete()` is called before the function returns.
A `sleep(0)` does NOT trigger it because the sleep goes through
`crate::run_async` (task queue), meaning the Promise is not yet resolved
when `on_ready` is called. The callback is stored and fired later via
the normal yield/resume path.

When a `@connected` function resolves its Promise synchronously (like our
`wsSend` which does `pb.complete(())` immediately after the channel push),
the execution flow is:

1. Generator case N: call `wsSend`, store Promise, call `on_ready`
2. `on_ready` sees Promise is already resolved → calls callback **immediately**
3. Callback calls `generator.next()` → **re-entrant** call
4. Inner `generator.next()` processes case N+1 (increment `i`), then N-1
   (loop check), and continues until it hits a non-resolved await (sleep)
5. Inner `generator.next()` yields properly
6. **Outer** `generator.next()` returns `Some(())` (from step 1's case)
7. The runtime thinks the generator yielded normally

The re-entrant execution in step 4 processes the loop variable increment
and loop-back but never re-enters the initialization case (`i = 0`). On
the next outer-loop iteration, the sleep callback resumes at the correct
case, but `i` retains its value from the inner loop's final state.

A pure-Temper reproduction is not possible because all built-in async
operations (`sleep`, `readLine`) go through the task queue and never
resolve synchronously. The bug requires a `@connected` function that
calls `pb.complete()` before returning.

## Scope

This bug affects Temper code on the Rust backend when ALL of these
conditions are met:

1. A `for` or `while` loop is nested inside another loop
2. The inner loop body contains an `await` expression
3. The awaited Promise resolves synchronously (inline `pb.complete()`)
4. The enclosing loop also has an `await` that resolves asynchronously

The JS backend is not affected because its `runAsync` uses `setTimeout`,
ensuring callbacks are always deferred to the next event loop tick (no
re-entrant execution).

The bug is in the interaction between the Temper Rust backend's
coroutine-to-state-machine transformation (`TranslateToRegularFunction`
strategy) and the `Promise::on_ready` mechanism that allows synchronous
callback invocation. Fixing it requires either:

- Making `on_ready` always defer callbacks (breaking synchronous resolution)
- Ensuring the state machine re-executes loop variable initialization
  cases when reached via re-entrant `next()` calls
- Adding a "loop entry" marker in the state machine that resets variables

## Workarounds

1. **Use `for..of` instead of indexed `for`** — avoids loop variables entirely
2. **Don't `await` inside loops** — keeps the loop as a single state machine case
3. **Extract the loop body to a helper** — isolates the await from the loop variable
