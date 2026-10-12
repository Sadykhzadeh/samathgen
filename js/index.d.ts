// Hand written, because the implementation is Rust. Up to 0.1.4 this package
// shipped no types at all despite being written in TypeScript.

export type Operators = '+' | '-' | '*' | '/'

/** A bracket, which appears wherever operator precedence requires one. */
export type Bracket = '(' | ')'

export interface MathGenOptions {
  /** The value the task must evaluate to: a whole number from -10000 to
   *  10000, 0 included. Anything else throws a RangeError (or a TypeError
   *  for a value that is not a number). Default: a random integer in
   *  10..=20. */
  answer?: number
  /** Ask for a task that groups part of itself in brackets, as in
   *  `(2+3)*4`; the brackets around a negative number do not count, and two
   *  numbers have no room for a group. Brackets may appear without this when
   *  precedence requires them - the alternative would be a task that does
   *  not evaluate to its answer. */
  brackets?: boolean
  /** Fill `quizOptions` with the answer and three near misses. */
  quizMode?: boolean
  /** The operators the task may use, e.g. `['+', '-']`. Default: all four.
   *  Throws a RangeError for an unknown or empty list, and for the two
   *  combinations that cannot build a task: an answer of 0 without `+` or
   *  `-`, and an answer past 5000 either side with `/` alone. */
  operators?: Operators[]
  /** Set to false to keep every number, every quiz option and every step of
   *  working the task out left to right at 0 or above. A negative answer
   *  then throws a RangeError. Default: true. */
  negatives?: boolean
  /** Pin the generator, so the same seed gives the same task. A value that
   *  is not a finite number throws a TypeError rather than being ignored.
   *  Default: drawn from Math.random. */
  seed?: number
}

export interface MathGenResult {
  /** The task, token by token. `task.join('')` is always a valid expression
   *  that evaluates to `answer`. */
  task: Array<number | Operators | Bracket>
  answer: number
  /** Four options including the answer, shuffled. Empty unless `quizMode`. */
  quizOptions: number[]
}

/**
 * Builds a task whose value is `answer`.
 *
 * `length` is the number of numbers in the task, clamped to 2..=32.
 */
export function mathGen (length: number, more?: MathGenOptions): MathGenResult

/**
 * Builds `count` tasks in a single call into WebAssembly, about twice as fast
 * per task as calling `mathGen` in a loop. Task `i` is exactly what
 * `mathGen(length, { ...more, seed: seed + i })` gives.
 *
 * `count` must be a whole number from 0 to 10000, or this throws a
 * RangeError.
 */
export function mathGenBatch (count: number, length: number, more?: MathGenOptions): MathGenResult[]

/**
 * Browser entry point only: loads the WebAssembly module. Await it once
 * before calling `mathGen`. Not exported by the Node entry point, which
 * loads the module synchronously.
 */
export function init (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<unknown>
