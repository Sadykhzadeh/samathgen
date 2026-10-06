// Hand written, because the implementation is Rust. Up to 0.1.4 this package
// shipped no types at all despite being written in TypeScript.

export type Operators = '+' | '-' | '*' | '/'

/** A bracket, which appears wherever operator precedence requires one. */
export type Bracket = '(' | ')'

export interface MathGenOptions {
  /** The value the task must evaluate to. 0 is honoured. Default: a random
   *  integer in 10..=20. */
  answer?: number
  /** Ask for a task that contains at least one bracketed group. Brackets may
   *  appear without this when precedence requires them - the alternative
   *  would be a task that does not evaluate to its answer. */
  brackets?: boolean
  /** Fill `quizOptions` with the answer and three near misses. */
  quizMode?: boolean
  /** Pin the generator, so the same seed gives the same task. Default: drawn
   *  from Math.random. */
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
 * Browser entry point only: loads the WebAssembly module. Await it once
 * before calling `mathGen`. Not exported by the Node entry point, which
 * loads the module synchronously.
 */
export function init (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<unknown>
