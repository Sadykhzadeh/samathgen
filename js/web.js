// Browser entry point. A WebAssembly module over 4 kB cannot be compiled
// synchronously on a browser's main thread, so `init()` has to be awaited
// once before mathGen can be called. Node callers get the synchronous
// loader instead and need none of this.
import initWasm, { generate_json as generateJson } from '../dist/web/samathgen.js'

const LENGTH_MIN = 2
const LENGTH_MAX = 32

let loading = null

const drawSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const clampLength = (length) => {
  if (!Number.isFinite(length)) return LENGTH_MIN
  return Math.min(Math.max(Math.trunc(length), LENGTH_MIN), LENGTH_MAX)
}

/** Loads the wasm module. Safe to call more than once; the same promise
 *  is handed back. Pass a URL or a Response to override where it loads from. */
export const init = (input) => {
  loading = loading || initWasm(input)
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
  const hasAnswer = Number.isFinite(options.answer)
  const seed = Number.isFinite(options.seed)
    ? Math.abs(Math.trunc(options.seed))
    : drawSeed()

  return JSON.parse(generateJson(
    clampLength(length),
    hasAnswer ? options.answer : 0,
    hasAnswer,
    options.brackets === true,
    options.quizMode === true,
    seed
  ))
}
