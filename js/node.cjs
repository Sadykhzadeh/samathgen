// Node entry point. wasm-pack's nodejs target loads the module synchronously
// from disk, so this works under plain require() and, through Node's named
// export detection, under `import { mathGen } from 'samathgen'` as well.
const { generate, generate_batch: generateBatch } = require('../dist/node/samathgen.js')

const LENGTH_MIN = 2
const LENGTH_MAX = 32
// Every number in a task stays within this, so an answer past it cannot be
// split at all: 1e6 came back as the one-term task "1000000", and 1e300
// overflowed into a task that evaluated to minus its reported answer.
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
  if (!Number.isFinite(length)) return LENGTH_MIN
  return Math.min(Math.max(Math.trunc(length), LENGTH_MIN), LENGTH_MAX)
}

// An option that is given but unusable is an error rather than a cue to pick
// something at random: a seed of "42" from a query string used to be dropped
// without a word, and the run it was meant to pin was not reproducible.
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

// One bit per operator, in the order src/expr.rs numbers them.
const OPERATORS = '+-*/'
const ALL_OPERATORS = 0b1111

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

// Every other combination can build every length; these two cannot, and
// src/expr.rs says why.
const cannotBuild = (answer, operators) => new RangeError(
  `no task evaluating to ${answer} can be built from ${operators.join(' ')} alone: ` +
  '0 needs + or -, and / alone cannot reach past 5000'
)

const readSeed = (seed) => {
  if (seed === undefined || seed === null) return drawSeed()
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError(`seed must be a finite number, got ${typeof seed === 'number' ? seed : typeof seed}`)
  }
  return Math.abs(Math.trunc(seed))
}

/**
 * Builds a task whose value is `answer`.
 *
 * Evaluating `task.join('')` always gives `answer` back: the expression is
 * generated as a tree and bracketed by precedence, so the two cannot drift
 * apart. Up to 0.1.4 the pieces were spliced together flat and about 6% of
 * tasks evaluated to something else.
 */
const mathGen = (length, more) => {
  const options = more || {}
  // `more.answer ? more.answer : random` used to throw away an explicit 0.
  const answer = readAnswer(options.answer)
  const operators = readOperators(options.operators)
  const seed = readSeed(options.seed)

  const data = generate(
    clampLength(length),
    answer === undefined ? 0 : answer,
    answer !== undefined,
    options.brackets === true,
    options.quizMode === true,
    operators,
    seed
  )
  if (data.length === 0) throw cannotBuild(answer, options.operators)
  return decode(data, 0)
}

/**
 * Builds `count` tasks at once, in a single call into WebAssembly. Task `i`
 * is exactly what `mathGen(length, { ...more, seed: seed + i })` gives, so a
 * batch is reproducible from one seed and can be split or resumed.
 */
const mathGenBatch = (count, length, more) => {
  if (!Number.isInteger(count) || count < 0 || count > BATCH_LIMIT) {
    throw new RangeError(`count must be a whole number from 0 to ${BATCH_LIMIT}, got ${count}`)
  }
  const options = more || {}
  const answer = readAnswer(options.answer)
  const operators = readOperators(options.operators)
  const seed = readSeed(options.seed)

  const data = generateBatch(
    count,
    clampLength(length),
    answer === undefined ? 0 : answer,
    answer !== undefined,
    options.brackets === true,
    options.quizMode === true,
    operators,
    seed
  )
  if (data.length === 0 && count > 0) throw cannotBuild(answer, options.operators)
  const tasks = new Array(count)
  let at = 0
  for (let i = 0; i < count; i++) {
    const result = decode(data, at)
    tasks[i] = result
    at += 3 + result.quizOptions.length + result.task.length
  }
  return tasks
}

module.exports = { mathGen, mathGenBatch }
