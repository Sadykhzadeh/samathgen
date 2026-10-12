// Browser entry point. A WebAssembly module over 4 kB cannot be compiled
// synchronously on a browser's main thread, so `init()` has to be awaited
// once before mathGen can be called. Node callers get the synchronous
// loader instead and need none of this.
import initWasm, { generate, generate_batch as generateBatch } from '../dist/web/samathgen.js'

const LENGTH_MIN = 2
const LENGTH_MAX = 32
// Every number in a task stays within this, so an answer past it cannot be
// split at all. The same rules as js/node.cjs; test/contract.mjs holds the
// two entry points to the same output.
const ANSWER_LIMIT = 10000

// A task comes back as integers, not JSON: [answer, option count,
// options..., token count, tokens...], with + - * / ( ) as SYMBOL_BASE + 0..5.
// No number in a task reaches SYMBOL_BASE. A batch is tasks laid end to end.
// See src/lib.rs.
const SYMBOL_BASE = 1 << 24
const SYMBOLS = ['+', '-', '*', '/', '(', ')']
// A batch is meant for a worksheet or a quiz, not a dataset. Past this the
// result stops being small, and a count taken from a request should not get
// to decide how much memory the process asks for.
const BATCH_LIMIT = 10000

/** The task starting at `start`; it occupies `3 + quizOptions.length +
 *  task.length` integers. */
const decode = (data, start) => {
  const optionCount = data[start + 1]
  const quizOptions = new Array(optionCount)
  for (let i = 0; i < optionCount; i++) quizOptions[i] = data[start + 2 + i]
  const at = start + 3 + optionCount
  const tokenCount = data[at - 1]
  const task = new Array(tokenCount)
  for (let i = 0; i < tokenCount; i++) {
    const token = data[at + i]
    task[i] = token >= SYMBOL_BASE ? SYMBOLS[token - SYMBOL_BASE] : token
  }
  return { task, answer: data[start], quizOptions }
}

let loading = null

const drawSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const clampLength = (length) => {
  if (length !== undefined && length !== null && typeof length !== 'number') {
    throw new TypeError(`length must be a number, got ${typeof length}`)
  }
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

// One bit per operator, in the order src/expr.rs numbers them, and one more
// for ruling out negative numbers.
const OPERATORS = '+-*/'
const ALL_OPERATORS = 0b1111
const NO_NEGATIVES = 1 << 4

const readOperators = (operators) => {
  if (operators === undefined || operators === null) return ALL_OPERATORS
  if (!Array.isArray(operators)) {
    throw new TypeError(`operators must be an array such as ['+', '-'], got ${typeof operators}`)
  }
  let bits = 0
  for (const operator of operators) {
    const index = typeof operator === 'string' && operator.length === 1 ? OPERATORS.indexOf(operator) : -1
    if (index < 0) throw new RangeError(`unknown operator ${JSON.stringify(operator)}, expected + - * or /`)
    bits |= 1 << index
  }
  if (bits === 0) throw new RangeError('operators must name at least one of + - * /')
  return bits
}

// What may appear in the task, as the one integer the WebAssembly takes.
// Only an explicit `negatives: false` rules them out, like the other flags.
const readAllowed = (options, answer) => {
  const operators = readOperators(options.operators)
  if (options.negatives !== false) return operators
  if (answer < 0) {
    throw new RangeError(`answer ${answer} is negative, but negatives is false`)
  }
  return operators | NO_NEGATIVES
}

// A few combinations of answer, length and rules cannot be built at all;
// the README lists them, and src/expr.rs says why.
const cannotBuild = (length, answer, options) => new RangeError(
  `no task of ${clampLength(length)} terms evaluating to ` +
  `${answer === undefined ? 'an answer from 10 to 20' : answer} can be built from ` +
  `${(options.operators || OPERATORS.split('')).join(' ')}` +
  `${options.negatives === false ? ' without negative numbers' : ''}`
)

// Task i of a batch is the task for seed + i, which only holds for whole
// numbers that JavaScript can count up from exactly.
const readSeed = (seed) => {
  if (seed === undefined || seed === null) return drawSeed()
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError(`seed must be a finite number, got ${typeof seed === 'number' ? seed : typeof seed}`)
  }
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(`seed must be a whole number from 0 to ${Number.MAX_SAFE_INTEGER}, got ${seed}`)
  }
  return seed
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
  const allowed = readAllowed(options, answer)
  const seed = readSeed(options.seed)

  const data = generate(
    clampLength(length),
    answer === undefined ? 0 : answer,
    answer !== undefined,
    options.brackets === true,
    options.quizMode === true,
    allowed,
    seed
  )
  if (data.length === 0) throw cannotBuild(length, answer, options)
  return decode(data, 0)
}

/**
 * Builds `count` tasks at once, in a single call into WebAssembly. Task `i`
 * is exactly what `mathGen(length, { ...more, seed: seed + i })` gives, so a
 * batch is reproducible from one seed and can be split or resumed.
 */
export const mathGenBatch = (count, length, more) => {
  if (!Number.isInteger(count) || count < 0 || count > BATCH_LIMIT) {
    throw new RangeError(`count must be a whole number from 0 to ${BATCH_LIMIT}, got ${count}`)
  }
  const options = more || {}
  const answer = readAnswer(options.answer)
  const allowed = readAllowed(options, answer)
  const seed = readSeed(options.seed)

  const data = generateBatch(
    count,
    clampLength(length),
    answer === undefined ? 0 : answer,
    answer !== undefined,
    options.brackets === true,
    options.quizMode === true,
    allowed,
    seed
  )
  if (data.length === 0 && count > 0) throw cannotBuild(length, answer, options)
  const tasks = new Array(count)
  let at = 0
  for (let i = 0; i < count; i++) {
    const result = decode(data, at)
    tasks[i] = result
    at += 3 + result.quizOptions.length + result.task.length
  }
  return tasks
}
