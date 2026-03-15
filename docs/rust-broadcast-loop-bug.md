# Rust Backend: `for` loop variable not reset between outer loop iterations

## Summary

The Temper Rust backend does not re-initialize `for` loop variables when
an enclosing loop iterates, if the `for` body contains an `await`.
The inner loop runs correctly on the first outer iteration, then silently
never executes again.

**Affects:** Temper `main` branch (tested at commit `cb8c3d5`)
**Backend:** Rust only. JS is correct.
**Requires:** No external dependencies. Pure Temper core primitives.

## Minimal Reproduction

```temper
export let name = "loop-bug";
```

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

    console.log("total loop body runs: ${totalLoopBodyRuns.toString()}");
  } orelse void;
}
```

Build and run:

```bash
temper build -b js -b rust
```

**JS output:** `total loop body runs: 9` (3 outer × 3 inner = correct)

**Rust output:** `total loop body runs: 3` (inner loop runs only on
the first outer iteration)

## Root Cause

The Rust backend compiles async blocks into state machines via the
`TranslateToRegularFunction` coroutine strategy (in
`be-rust/src/commonMain/kotlin/lang/temper/be/rust/RustSupportNetwork.kt`,
`coroutineStrategy = CoroutineStrategy.TranslateToRegularFunction`).

Each `await` creates a yield point that splits the function into numbered
cases in a `match caseIndex { 0 => ..., 1 => ..., ... }` state machine.
Local variables that cross yield points are hoisted to
`Arc<RwLock<T>>` fields on the generator's closure struct.

For a `for (var i = 0; ...)` loop, the compiler:

1. Creates `i` as a struct field with initial value 0:
   ```rust
   let mut i: Arc<RwLock<i32>> = Arc::new(RwLock::new(0));
   ```

2. Generates a state machine case for the loop condition check:
   ```rust
   N => {
       if !(i < items.length) {
           caseIndex = exit_case;
       } else {
           caseIndex = body_case;
       }
   }
   ```

3. Generates a case for the increment:
   ```rust
   M => {
       i = i + 1;
       caseIndex = N; // back to condition check
   }
   ```

The initialization `i = 0` from `var i = 0` is only present in step 1
(the struct field default). There is no `i = 0` assignment in any state
machine case. When the enclosing `while` loop iterates and re-enters the
`for` loop, the state machine jumps to case N (the condition check). At
this point `i` still holds its value from the previous outer iteration
(e.g., 3). The condition `3 < 3` is false, so the inner loop body is
skipped entirely.

The JS backend does not have this bug because it uses
`CoroutineStrategy.TranslateToGenerator` which compiles async blocks to
JavaScript generator functions. JavaScript generators re-execute the
full function body on each `next()` call up to the next `yield`, so
`var i = 0` runs as a normal assignment each time the loop entry is
reached.

## Scope

The bug affects any code where:

1. A `for (var x = init; ...)` loop is nested inside another loop
2. The `for` body contains an `await` expression

It does not depend on:

- Whether the Promise resolves synchronously or asynchronously
- Whether the `await` is wrapped in `do { ... } orelse void`
- What types are involved
- Whether `@connected` functions are used

The same issue likely affects any `var` declaration with an initializer
inside a loop body that also contains an `await`. The initializer runs
once at generator creation and is never re-executed.

## Workarounds

1. **Use `for (let x of list)`** — compiles to `list_for_each()` with a
   callback, avoiding the state machine entirely. Cannot `await` inside
   the callback, but works for synchronous operations.

2. **Avoid `await` inside `for` loops** — keep the loop body synchronous
   and `await` after the loop completes.

3. **Reset the variable explicitly before the loop:**
   ```temper
   i = 0;  // explicit reset
   for (var i = 0; i < items.length; ++i) { ... }
   ```
   (Untested — the compiler may or may not emit this as a state machine
   assignment vs. a hoisted default.)

## Fix

The coroutine-to-state-machine transformation in the Rust backend
(`RustTranslator`) should emit explicit variable initialization
assignments at loop entry points in the state machine, rather than
relying solely on struct field defaults. Each `for (var x = init; ...)`
should produce a case like:

```rust
loop_entry_case => {
    x = init;         // ← missing today
    caseIndex = condition_check_case;
}
```

The relevant code is in the Temper compiler's Rust backend translation
pipeline, likely in the state machine generation within `RustTranslator.kt`
and related files under `be-rust/src/commonMain/kotlin/lang/temper/be/rust/`.
