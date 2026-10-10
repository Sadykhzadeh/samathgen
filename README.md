<p align="center">
  <h2 align="center" style="font-size:2em;">SaMathGen</h2>
  <p align="center" style="font-size:1.4em;">
    NPM library that generates math expressions for education purposes.
    <br/>
    You can <a href="https://got.az/azer/samathgen/issues">report bug</a>
    or
    <a href="https://got.az/azer/samathgen/issues">request feature 👀</a>
  </p>
</p>

## Table Of Contents

- [About The Library](#about-the-library)
- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
- [How it works](#how-it-works)
- [Building from source](#building-from-source)
- [Contributing](#contributing)
- [License](#license)

## About The Library

Generating various math expressions independently, for example, for primary
school educators — is a routine job.

This library can help you automate this process; it is enough to write the
required arguments like expression's size, optionally brackets and other cool
features.

The generator is written in **Rust** and ships as **WebAssembly**, so the same
build runs in Node and in the browser. It has **no runtime dependencies** at
all, in either language.

With 💚 by **Azer Sadykhzadeh**

## Installation

```sh
npm install samathgen
```

The published package carries the compiled WebAssembly, so installing it needs
no Rust toolchain.

## Usage

### Node

```js
import { mathGen } from 'samathgen'
// or: const { mathGen } = require('samathgen')

const task = mathGen(4, { quizMode: true })

console.log(task.task.join(''))   // 36/6+2*5
console.log(task.answer)          // 16
console.log(task.quizOptions)     // [ 16, 18, 19, 15 ]
```

### Browser

A WebAssembly module larger than 4 kB cannot be compiled synchronously on a
browser's main thread, so the browser entry point asks you to await `init()`
once:

```js
import { init, mathGen } from 'samathgen'

await init()
mathGen(4, { quizMode: true })
```

`test/browser.html` is a page that does exactly this and then checks 20 000
generated tasks; serve the repository over HTTP and open it.

## API

### `mathGen(length, more?)`

`length` is how many numbers the task contains, clamped to `2..=32`.

| Option | Default | Meaning |
| --- | --- | --- |
| `answer` | a random integer in `10..=20` | The value the task must evaluate to, a whole number from `-10000` to `10000`. `0` is honoured. |
| `brackets` | `false` | Ask for a task containing at least one bracketed group. |
| `quizMode` | `false` | Fill `quizOptions` with the answer and three near misses. |
| `seed` | drawn from `Math.random` | Pin the generator: the same seed always gives the same task. |

An option that is given but cannot be honoured throws instead of being
quietly replaced: an `answer` outside the range above or with a fraction is a
`RangeError`, and an `answer` or `seed` that is not a number is a `TypeError`.
`null` and `undefined` mean the default.

Returns:

| Field | Type | Meaning |
| --- | --- | --- |
| `task` | `Array<number \| '+' \| '-' \| '*' \| '/' \| '(' \| ')'>` | The task, token by token. |
| `answer` | `number` | What the task evaluates to. |
| `quizOptions` | `number[]` | Four options including the answer, shuffled. Empty unless `quizMode`. |

**`task.join('')` always evaluates to `answer`.** That is the contract, and it
is checked over 200 000 generated tasks per entry point on every build.

Note that brackets can appear even with `brackets: false`, wherever operator
precedence requires them. The alternative would be a task that does not
evaluate to its answer.

TypeScript declarations ship with the package.

## How it works

A task is built as a tree. It starts as a single leaf holding the answer, and
each step replaces some leaf holding `v` with a node that evaluates to exactly
`v` — `a + b`, `a - b`, `a * b` for a real divisor `a` of `v`, or `a / b` with
`a = v * b`. Every division introduced is exact. The root therefore keeps its
value whatever shape the tree takes, and the text is produced afterwards with
brackets placed by precedence.

Both halves of that are exact, so the task evaluating to the answer is a
property of the construction rather than something to hope for.

Versions up to 0.1.4 worked the other way round: they spliced a
sub-expression in place of an operand and printed the result flat, with a
`genValidOperator` function trying to forbid the operator combinations that
would break. Around **6% of generated tasks did not evaluate to the answer
they reported** (more for longer tasks), which is also why the old test
suite — twenty random cases — failed on roughly two runs in three.

### On speed

A call used to hand its result to JavaScript as a JSON string, and that cost
more than building the task: formatting the string in Rust, decoding it on the
other side and running `JSON.parse` over it. The result now crosses as a short
array of integers that the wrapper turns into the same object. Building the
tree no longer allocates on every split either. A given seed produces exactly
the same task as before both changes.

Lengths cycling through 2..8 with quiz options on, Node 24. Every version runs
in turn in one process and is timed by the CPU time it used, best of 11 runs
of 400 000 tasks:

| Version | per task | with brackets |
| --- | --- | --- |
| 0.1.3, TypeScript | 1.01 µs | 1.79 µs |
| 1.0, result as JSON | 2.31 µs | 2.54 µs |
| 1.0, result as integers | 1.09 µs | 1.21 µs |
| 1.0, no allocation per split | 0.90 µs | 1.05 µs |

The WebAssembly shrank with it, from 26 545 to 21 889 bytes (12 359 to
10 420 gzipped), because nothing formats text any more.

`npm run bench` prints the figures for your machine.

## Building from source

Needs a Rust toolchain with the `wasm32-unknown-unknown` target, plus
[wasm-pack](https://rustwasm.github.io/wasm-pack/).

```sh
rustup target add wasm32-unknown-unknown
npm run build          # writes dist/node and dist/web
npm test               # cargo test, then the JavaScript contract suite
```

`cargo test` alone exercises the generator natively, with an expression parser
written independently of the renderer so the two have to agree. The contract
suite then runs against both entry points, loading the browser one under Node
from the built bytes, and checks that the two give the same task for a seed.

## Contributing

Contributions are what make the open source community such an amazing place to
be learn, inspire, and create. Any contributions you make are **greatly
appreciated**.

- If you have suggestions, feel free to
  [open an issue](https://got.az/azer/samathgen/issues/new) to discuss it, or
  directly create a pull request.
- Please make sure you check your spelling and grammar.
- Create individual PR for each suggestion.

### Creating A Pull Request

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the GNU General Public License v3.0. See `LICENSE` for more
information.
