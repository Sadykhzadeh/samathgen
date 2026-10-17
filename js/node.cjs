// Node entry point. wasm-pack's nodejs target loads the module synchronously
// from disk, so this works under plain require() and, through Node's named
// export detection, under `import { mathGen } from 'samathgen'` as well.
const { generate, generate_batch: generateBatch, wasm_memory: getMemory } = require('../dist/node/samathgen.js')

// A call leaves its result in the module's memory, at the address it returns,
// as a count of integers and then those integers, and they are read from
// there without a copy. The view is made again when the memory has grown,
// which detaches the old one. `read` gives the index the count is at.
const memory = getMemory()
let ints = new Int32Array(memory.buffer)
const read = (pointer) => {
  if (ints.buffer !== memory.buffer) ints = new Int32Array(memory.buffer)
  return pointer >>> 2
}

const LENGTH_MIN = 2
const LENGTH_MAX = 32
// Every number in a task stays within this, or within a smaller max, so an
// answer past it cannot be split at all.
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

const drawSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const clampLength = (length) => {
  if (length !== undefined && length !== null && typeof length !== 'number') {
    throw new TypeError(`length must be a number, got ${typeof length}`)
  }
  if (!Number.isFinite(length)) return LENGTH_MIN
  return Math.min(Math.max(Math.trunc(length), LENGTH_MIN), LENGTH_MAX)
}

// An option the library does not have is an error too: `negative: false` for
// `negatives: false` would otherwise give a class the negative numbers it
// asked to be spared, and nothing would say why. `distinct` is a batch option,
// which a single task has no use for but accepts, so that one set of options
// can be handed to either.
const OPTIONS = new Set(['answer', 'brackets', 'distinct', 'max', 'negatives', 'operators', 'quizMode', 'seed'])

const editDistance = (a, b) => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = row
  }
  return previous[b.length]
}

const unknownOption = (name) => {
  const lower = name.toLowerCase()
  const near = [...OPTIONS].find((known) => {
    const other = known.toLowerCase()
    return other === lower || other.startsWith(lower) || lower.startsWith(other) || editDistance(lower, other) <= 2
  })
  return new TypeError(
    `unknown option ${JSON.stringify(name)}${near ? `, did you mean ${near}?` : '.'} ` +
    `The options are ${[...OPTIONS].join(', ')}.`
  )
}

const readOptions = (more) => {
  if (more === undefined || more === null) return {}
  if (typeof more !== 'object' || Array.isArray(more)) {
    throw new TypeError(`options must be an object, got ${Array.isArray(more) ? 'an array' : typeof more}`)
  }
  for (const name in more) {
    if (!OPTIONS.has(name)) throw unknownOption(name)
  }
  return more
}

// An option that is given but unusable is an error rather than a cue to pick
// something at random: a seed of "42" from a query string, dropped, would
// leave the run it was meant to pin not reproducible.
const readAnswer = (answer, max) => {
  if (answer === undefined || answer === null) return undefined
  if (typeof answer !== 'number') {
    throw new TypeError(`answer must be a number, got ${typeof answer}`)
  }
  if (!Number.isInteger(answer) || Math.abs(answer) > max) {
    throw new RangeError(`answer must be a whole number from -${max} to ${max}, got ${answer}`)
  }
  return answer
}

// `answer` is the value the task must have, or a range [low, high] to draw it
// from, the ends included. One given as a range of one is a number.
const readAnswers = (answer, max) => {
  if (!Array.isArray(answer)) {
    const only = readAnswer(answer, max)
    return only === undefined ? undefined : [only, only]
  }
  if (answer.length !== 2) {
    throw new RangeError(`answer must be a number or a range [low, high], got an array of ${answer.length}`)
  }
  const [low, high] = answer.map((end) => {
    if (end === undefined || end === null) throw new TypeError('answer must be a number or a range [low, high] of two numbers')
    return readAnswer(end, max)
  })
  if (low > high) {
    throw new RangeError(`answer range must go from low to high, got [${low}, ${high}]`)
  }
  return [low, high]
}

// The smallest max, the furthest from zero any number in a task may be:
// numbers up to 10 are where a class starts.
const MAX_MIN = 10

const readMax = (max) => {
  if (max === undefined || max === null) return ANSWER_LIMIT
  if (typeof max !== 'number') {
    throw new TypeError(`max must be a number, got ${typeof max}`)
  }
  if (!Number.isInteger(max) || max < MAX_MIN || max > ANSWER_LIMIT) {
    throw new RangeError(`max must be a whole number from ${MAX_MIN} to ${ANSWER_LIMIT}, got ${max}`)
  }
  return max
}

// Without an answer one is drawn from 10 to 20, or under a max below 20 from
// half the max up to the max. src/lib.rs draws it.
const defaultAnswers = (max) => max >= 20 ? 'an answer from 10 to 20' : `an answer from ${Math.floor((max + 1) / 2)} to ${max}`

// Of a range of more than 64 answers, 64 are tried; src/lib.rs says why.
const describeAnswers = (answers, max) => {
  if (answers === undefined) return defaultAnswers(max)
  const [low, high] = answers
  if (low === high) return String(low)
  return `an answer from ${low} to ${high}${high - low >= 64 ? ' (64 of them tried)' : ''}`
}

// One bit per operator, in the order src/expr.rs numbers them, one more
// for ruling out negative numbers and one for ruling out brackets.
const OPERATORS = '+-*/'
const ALL_OPERATORS = 0b1111
const NO_NEGATIVES = 1 << 4
const FLAT = 1 << 5

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

// A flag is true or false, and left out or null it is `fallback`. Anything
// else is refused: a "false" read from a query string, or a 0, left out as
// if the option had not been given, would hand a class that has not met
// negative numbers the very tasks it asked to be spared.
const readFlag = (name, value, fallback) => {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') {
    const got = typeof value === 'string' || typeof value === 'number' ? JSON.stringify(value) : typeof value
    throw new TypeError(`${name} must be true or false, got ${got}`)
  }
  return value
}

// Only `brackets: 'never'` rules out a group. Any other string, such as
// 'Never' or a 'false' read from a query string, would quietly leave
// brackets in, so it is refused, and so is anything else that is not a flag.
const readBrackets = (brackets) => {
  if (typeof brackets === 'string' && brackets !== 'never') {
    throw new RangeError(`brackets must be true, false or 'never', got ${JSON.stringify(brackets)}`)
  }
  if (brackets === 'never') return FLAT
  readFlag('brackets', brackets, false)
  return 0
}

// What may appear in the task, as the one integer the WebAssembly takes.
// Only an explicit `negatives: false` rules them out, like the other flags,
// and only `brackets: 'never'` rules out a group.
const readAllowed = (options, answers) => {
  const allowed = readOperators(options.operators) | readBrackets(options.brackets)
  if (readFlag('negatives', options.negatives, true)) return allowed
  if (answers !== undefined && answers[0] < 0) {
    throw new RangeError(`answer ${answers[0]} is negative, but negatives is false`)
  }
  return allowed | NO_NEGATIVES
}

// A few combinations of answer, length and rules cannot be built at all;
// the README lists them, and src/expr.rs says why.
const cannotBuild = (length, answers, max, options) => {
  const without = [
    options.negatives === false && 'negative numbers',
    options.brackets === 'never' && 'brackets',
  ].filter(Boolean)
  return new RangeError(
    `no task of ${clampLength(length)} terms evaluating to ` +
    `${describeAnswers(answers, max)} can be built from ` +
    `${(options.operators || OPERATORS.split('')).join(' ')}` +
    `${without.length > 0 ? ` without ${without.join(' or ')}` : ''}` +
    `${max < ANSWER_LIMIT ? ` within ${max}` : ''}`
  )
}

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

/**
 * Builds a task whose value is `answer`.
 *
 * Evaluating `task.join('')` always gives `answer` back: the expression is
 * generated as a tree and bracketed by precedence, so the two cannot drift
 * apart.
 */
const mathGen = (length, more) => {
  const options = readOptions(more)
  const max = readMax(options.max)
  const answers = readAnswers(options.answer, max)
  const allowed = readAllowed(options, answers)
  const seed = readSeed(options.seed)

  const at = read(generate(
    clampLength(length),
    answers === undefined ? 0 : answers[0],
    answers === undefined ? 0 : answers[1],
    answers !== undefined,
    options.brackets === true,
    readFlag('quizMode', options.quizMode, false),
    allowed,
    max,
    seed
  ))
  if (ints[at] === 0) throw cannotBuild(length, answers, max, options)
  return decode(ints, at + 1)
}

/**
 * Builds `count` tasks at once, in a single call into WebAssembly. Task `i`
 * is exactly what `mathGen(length, { ...more, seed: seed + i })` gives, so a
 * batch is reproducible from one seed and can be split or resumed. With
 * `distinct: true` a task that repeats one before it is replaced by the
 * next one from `seed + count` on that does not.
 */
const mathGenBatch = (count, length, more) => {
  if (!Number.isInteger(count) || count < 0 || count > BATCH_LIMIT) {
    throw new RangeError(`count must be a whole number from 0 to ${BATCH_LIMIT}, got ${count}`)
  }
  const options = readOptions(more)
  const max = readMax(options.max)
  const answers = readAnswers(options.answer, max)
  const allowed = readAllowed(options, answers)
  const seed = readSeed(options.seed)

  const at = read(generateBatch(
    count,
    clampLength(length),
    answers === undefined ? 0 : answers[0],
    answers === undefined ? 0 : answers[1],
    answers !== undefined,
    options.brackets === true,
    readFlag('quizMode', options.quizMode, false),
    allowed,
    max,
    seed,
    readFlag('distinct', options.distinct, false)
  ))
  if (ints[at] === 0 && count > 0) throw cannotBuild(length, answers, max, options)
  const tasks = new Array(count)
  let next = at + 1
  for (let i = 0; i < count; i++) {
    const result = decode(ints, next)
    tasks[i] = result
    next += 3 + result.quizOptions.length + result.task.length
  }
  return tasks
}

/** Resolves at once: under Node the module was loaded with the package.
 *  It is here so that code written for the browser entry point, which has
 *  to await init(), runs unchanged under Node as well. */
const init = () => Promise.resolve()

module.exports = { init, mathGen, mathGenBatch }
