// Browser entry point. A WebAssembly module over 4 kB cannot be compiled
// synchronously on a browser's main thread, so `init()` has to be awaited
// once before mathGen can be called. Node callers get the synchronous
// loader instead and need none of this.
import initWasm, { generate_json as generateJson } from '../dist/web/samathgen.js'

const LENGTH_MIN = 2
const LENGTH_MAX = 32
// Every number in a task stays within this, so an answer past it cannot be
// split at all. The same rules as js/node.cjs; test/contract.mjs holds the
// two entry points to the same output.
const ANSWER_LIMIT = 10000

let loading = null

const drawSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const clampLength = (length) => {
  if (!Number.isFinite(length)) return LENGTH_MIN
  return Math.min(Math.max(Math.trunc(length), LENGTH_MIN), LENGTH_MAX)
}

const readAnswer = (answer) => {
  if (answer === undefined || answer === null) return undefined
  if (typeof answer !== 'number') {
    throw new TypeError(`answer must be a number, got ${typeof answer}`)
  }
  if (!Number.isInteger(answer) || Math.abs(answer) > ANSWER_LIMIT) {
    throw new RangeError(`answer must be a whole number from -${ANSWER_LIMIT} to ${ANSWER_LIMIT}, got ${answer}`)
  }
  return answer
}

const readSeed = (seed) => {
  if (seed === undefined || seed === null) return drawSeed()
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError(`seed must be a finite number, got ${typeof seed === 'number' ? seed : typeof seed}`)
  }
  return Math.abs(Math.trunc(seed))
}

/** Loads the wasm module. Safe to call more than once; the same promise
 *  is handed back. Pass a URL or a Response to override where it loads from. */
export const init = (input) => {
  // wasm-bindgen takes the override wrapped in an object now, and logs a
  // deprecation warning for every bare argument it is still handed.
  loading = loading || initWasm(input === undefined ? undefined : { module_or_path: input })
  return loading
}

/**
 * Builds a task whose value is `answer`. Call and await `init()` first.
 *
 * Evaluating `task.join('')` always gives `answer` back: the expression is
 * generated as a tree and bracketed by precedence.
 */
export const mathGen = (length, more) => {
  const options = more || {}
  const answer = readAnswer(options.answer)
  const seed = readSeed(options.seed)

  return JSON.parse(generateJson(
    clampLength(length),
    answer === undefined ? 0 : answer,
    answer !== undefined,
    options.brackets === true,
    options.quizMode === true,
    seed
  ))
}
