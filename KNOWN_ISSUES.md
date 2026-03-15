# Known Issues

## Rust Backend: Missing `temper-std` dependency for multi-module projects

**Status:** Open
**Affects:** Rust backend only
**Discovered:** 2026-03-15

### Description

When a Temper project has multiple modules (e.g., `src/` as the library, `game/` as a runner), and the runner module imports from `std/io`, the Rust backend generates code that references `temper_std::io::std_read_line()` and `temper_std::io::std_sleep()` in the runner crate's compiled output, but does NOT add `temper-std` to the runner crate's `Cargo.toml` dependencies.

### Reproduction

Project structure:
```
src/            → "snake" library (pure game logic, no std/io import)
game/           → "snake-game" runner (imports std/io for sleep/readLine)
```

After `temper build`, the generated `temper.out/rust/snake-game/Cargo.toml` contains:
```toml
[dependencies]
temper-core = { path = "../temper-core", version = "=0.6.0" }
snake = { path = "../snake", version = "0.0.1" }
```

Missing: `temper-std = { path = "../std", version = "0.6.0", features = ["io"] }`

But `temper.out/rust/snake-game/src/mod.rs` references:
```rust
temper_std::io::std_read_line()
temper_std::io::std_sleep(1000)
temper_std::io::std_sleep(200)
```

This produces:
```
error[E0433]: failed to resolve: use of unresolved module or unlinked crate `temper_std`
```

### Analysis

In `RustBackend.kt` (lines ~103-123), the dependency resolution loop iterates over `module.imports` and creates `Dep` entries. For standard library imports, it also tracks features. The `temper-std` crate IS generated correctly at `temper.out/rust/std/` with the right `Cargo.toml` (including `libc` for `io` feature). The issue appears to be that the dependency isn't being added to the consuming crate's `Cargo.toml`.

Possible causes:
- The `libraryConfigurations.byLibraryName` lookup may not find the std library config for the runner module
- The cross-library import path resolution may differ for runner modules vs library modules
- The `depConfig` for the standard library may use a different root path than expected

### Workaround

Manually add the dependency to the generated `Cargo.toml`:
```toml
temper-std = { path = "../std", version = "0.6.0", features = ["io"] }
```

Or: keep `std/io` imports in the main library module (`src/`) rather than a separate runner module.

### Impact

Single-module projects that import `std/io` directly in `src/` work fine (the `snake` crate compiled correctly when it had the game loop). The bug only manifests when a *secondary* module (like `game/`) imports from std.
