// Hand written, because the implementation is Rust. Up to 0.1.4 this package
// shipped no types at all despite being written in TypeScript.

export type Operators = '+' | '-' | '*' | '/'

/** A bracket, which appears wherever operator precedence requires one, or
 *  where a step of working the task out would otherwise pass max. */
export type Bracket = '(' | ')'

export interface MathGenOptions {
  /** The value the task must evaluate to: a whole number from -max to max,
   *  0 included. Anything else throws a RangeError (or a TypeError for a
   *  value that is not a number). Default: a random integer in 10..=20, or
   *  from half of max up to max when max is below 20. */
  answer?: number
  /** Ask for a task that groups part of itself in brackets, as in
   *  `(2+3)*4`; the brackets around a negative number do not count, and two
   *  numbers have no room for a group. Brackets may appear without this when
   *  precedence requires them - the alternative would be a task that does
   *  not evaluate to its answer - or to keep every step of working the task
   *  out within max. */
  brackets?: boolean
  /** Fill `quizOptions` with the answer and three near misses, each within
   *  5 of it. */
  quizMode?: boolean
  /** The operators the task may use, e.g. `['+', '-']`. Default: all four.
   *  Throws a RangeError for an unknown or empty list, and for the two
   *  combinations that cannot build a task: an answer of 0 without `+` or
   *  `-`, and an answer past half of max either side with `/` alone. */
  operators?: Operators[]
  /** Set to false to keep every number, every quiz option and every step of
   *  working the task out left to right at 0 or above. A RangeError is then
   *  thrown for a negative answer, an answer of 0 without `-`, `+` alone
   *  with an answer smaller than the length, and an answer of max itself
   *  with neither `+` nor `*`. Default: true. */
  negatives?: boolean
  /** How far from zero any number may be: every number in the task, every
   *  step of working it out left to right and every quiz option. A whole
   *  number from 10 to 10000; anything else throws a RangeError (or a
   *  TypeError for a value that is not a number). It also bounds the
   *  answer, which without one is drawn from half of max up to max when max
   *  is below 20. Default: 10000. */
  max?: number
  /** Pin the generator, so the same seed gives the same task: a whole number
   *  from 0 to Number.MAX_SAFE_INTEGER. Anything else throws a RangeError
   *  (or a TypeError for a value that is not a finite number) rather than
   *  being ignored. Default: drawn from Math.random. */
  seed?: number
}

export interface MathGenResult {
  /** The task, token by token. `task.join('')` is always a valid expression
   *  that evaluates to `answer`. */
  task: Array<number | Operators | Bracket>
  answer: number
  /** Four options including the answer, shuffled. The answer is as likely
   *  to be the smallest of them as the largest or either between. Empty
   *  unless `quizMode`. */
  quizOptions: number[]
}

/**
 * Builds a task whose value is `answer`.
 *
 * `length` is the number of numbers in the task, clamped to 2..=32. A value
 * that is not a number throws a TypeError.
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
 * Loads the WebAssembly module. In the browser, await it once before calling
 * `mathGen` or `mathGenBatch`, which throw until it has finished. A load
 * that fails rejects, and calling init() again tries again. Under Node
 * the module is loaded with the package and this resolves at once, so the
 * same code runs in both.
 */
export function init (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<unknown>
