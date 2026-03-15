# Temper Language Quick Reference

## File Format

- `.temper.md` = literate programming (Markdown + indented code blocks)
- `.temper` = plain code (no Markdown)
- Code blocks are 4-space indented under Markdown prose
- Each directory with a `config.temper.md` is a library/module

## Declarations

```temper
let x = 42;                        // immutable binding
var x = 42;                        // mutable binding
export let greet(name: String): String { "Hello, ${name}!" }
```

## Types

| Type | Description |
|------|-------------|
| `Boolean` | `true` / `false` |
| `Int` / `Int32` | 32-bit integer |
| `Int64` | 64-bit integer |
| `Float64` | 64-bit float |
| `String` | UTF string |
| `List<T>` | Immutable list |
| `ListBuilder<T>` | Mutable list builder |
| `Map<K, V>` | Immutable map |
| `MapBuilder<K, V>` | Mutable map builder |
| `Pair<A, B>` | Key-value pair |
| `Type?` | Nullable |
| `Void` | No value |

## Classes

```temper
export class Point(public x: Int, public y: Int) {}

class Foo(
  public name: String,
  private var backing: Int,
) {
  public get value(): Int { backing }
  public set value(v: Int): Void { backing = v; }
  public toString(): String { "Foo(${name})" }
  public static create(): Foo { new Foo("default", 0) }
}
```

## Sealed Interfaces (Sum Types)

```temper
export sealed interface Direction {}
export class Up() extends Direction {}
export class Down() extends Direction {}
export class Left() extends Direction {}
export class Right() extends Direction {}
```

## Interfaces

```temper
interface Drawable {
  public get label(): String;
  public draw(): Void;
}

class Circle(public radius: Int) extends Drawable {
  public get label(): String { "circle" }
  public draw(): Void { console.log("O"); }
}
```

## Functions

```temper
// Top-level
let add(a: Int, b: Int): Int { a + b }
export let double(x: Int): Int { x * 2 }

// With var params
let fib(var n: Int): Int {
  var a = 0; var b = 1;
  while (n > 0) { let c = a + b; a = b; b = c; n -= 1; }
  a
}

// Lambdas
list.map { (x): Int => x * 2 }
list.filter { x => x > 0 }
list.join(", ") { x => x.toString() }
```

## Control Flow

```temper
// If-else (expression)
let result = if (x > 0) { "pos" } else { "non-pos" };

// Pattern matching
let desc = when (dir) {
  is Up -> "up";
  is Down -> "down";
  is Left -> "left";
  is Right -> "right";
};

// Value matching
let label = when (n) {
  0 -> "zero";
  1, 2, 3 -> "small";
  else -> "big";
};

// Type checking
if (value is SomeType) { /* ... */ }

// Casting
let x = value as SomeType;           // bubbles on failure
let x = value as SomeType orelse fallback;
```

## Loops

```temper
// For-each
for (let item of list) { console.log("${item}"); }

// C-style for
for (var i = 0; i < n; ++i) { console.log(i.toString()); }

// While
while (cond) { /* ... */ }

// Labeled break/continue
outer: for (var i = 0; i < 4; i++) {
  for (var j = 0; j < 4; j++) {
    if (j == 2) { continue outer; }
  }
}
```

## Error Handling

```temper
bubble()                              // throw (returns Nothing)
do { riskyOp() } orelse fallback      // try/catch
value orelse panic()                   // unwrap or crash
value ?? defaultValue                  // null coalescing
obj?.method()                         // null chaining
```

## Collections

```temper
// List (immutable)
let list = [1, 2, 3];
list.length                           // size
list.get(0)                           // access by index (bubbles if out of range)
list[0]                               // bracket access
list.getOr(99, -1)                    // with fallback
list.map { (x): Int => x + 1 }
list.filter { x => x > 1 }
list.slice(1, 3)
list.sorted { a, b => a - b }
list.join(", ") { x => x.toString() }
list.isEmpty

// ListBuilder (mutable)
let lb = new ListBuilder<Int>();
lb.add(42);
lb.addAll([1, 2, 3]);
lb.toList()                           // freeze to immutable List

// Map (immutable)
let map = new Map([new Pair("a", 1), new Pair("b", 2)]);
map["a"]                              // access (bubbles if missing)
map["z"] orelse 0                     // with fallback

// MapBuilder (mutable)
let mb = new MapBuilder<String, Int>();
mb["key"] = 42;
mb.toMap()
```

## Strings

```temper
"Hello, ${name}!"                     // interpolation with ${ expr }
let sb = new StringBuilder();
sb.append("hi");
sb.toString()
```

## Testing

```temper
test("my test") {
  assert(1 + 1 == 2) { "math is broken" }
}

test("with details") {
  let x = compute();
  assert(x == 42) { "expected 42, got ${x}" }
}
```

## Operators

| Category | Operators |
|----------|-----------|
| Arithmetic | `+ - * / % **` |
| Comparison | `== != < > <= >=` |
| Logical | `&& \|\| !` |
| Type | `is` `as` |
| Null | `?? ?.` |
| Increment | `++ --` |
| Spaceship | `<=>` (comparison for sorting) |

## Imports

```temper
// In config.temper.md — include sub-modules
import("./submodule");

// In code — import from sub-modules or external libs
let { Type1, func1 } = import("./other-module");
let { Date } = import("std/temporal");
```

## Build & Run

```bash
temper build              # build for all backends
temper build -b js        # build for JavaScript only
temper test               # run tests
temper run                # run main
```

Output goes to `temper.out/<backend>/<library-name>/`.
