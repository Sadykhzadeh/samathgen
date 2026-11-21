// Browser entry point. A WebAssembly module over 4 kB cannot be compiled
// synchronously on a browser's main thread, so `init()` has to be awaited
// once before mathGen can be called. Node callers get the synchronous
// loader instead and need none of this.
import initWasm, { generate, generate_batch as generateBatch, wasm_memory as getMemory } from '../dist/web/samathgen.js'

const LENGTH_MIN = 2
const LENGTH_MAX = 32
// Every number in a task stays within this, or within a smaller max, so an
// answer past it cannot be split at all. The same rules as js/node.cjs;
// test/contract.mjs holds the two entry points to the same output.
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
let ready = false

// A call leaves its result in the module's memory, at the address it returns,
// as a count of integers and then those integers, and they are read from
// there without a copy. The view is made again when the memory has grown,
// which detaches the old one. `read` gives the index the count is at.
let memory = null
let ints = null
const read = (pointer) => {
  if (ints.buffer !== memory.buffer) ints = new Int32Array(memory.buffer)
  return pointer >>> 2
}

// Leaves room for the seeds after it, so a drawn batch never runs past the
// largest seed mathGen accepts.
const drawSeed = (count) => Math.floor(Math.random() * (Number.MAX_SAFE_INTEGER - count + 1))

// A string from a request is quoted in its error, but only the start of it,
// so that a value of megabytes does not come back in full in the message.
const SHOWN = 40
const quoted = (text) => JSON.stringify(text.length > SHOWN ? `${text.slice(0, SHOWN)}...` : text)

// How a refused value is named in an error: a string in quotes, so that '6'
// is told from 6, an array as an array, and anything else by its type.
const got = (value) => typeof value === 'string' ? quoted(value)
  : Array.isArray(value) ? 'an array'
  : value !== null && typeof value === 'object' ? 'an object'
  : typeof value === 'function' ? 'a function'
  : typeof value === 'bigint' ? 'a bigint'
  : String(value)

const clampLength = (length) => {
  if (length !== undefined && length !== null && typeof length !== 'number') {
    throw new TypeError(`length must be a number, got ${got(length)}`)
  }
  if (length === Infinity) return LENGTH_MAX
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
  const near = lower.length > 0 && [...OPTIONS].find((known) => {
    const other = known.toLowerCase()
    return other === lower || other.startsWith(lower) || lower.startsWith(other) ||
      (Math.abs(lower.length - other.length) <= 2 && editDistance(lower, other) <= 2)
  })
  return new TypeError(
    `unknown option ${quoted(name)}${near ? `, did you mean ${near}?` : '.'} ` +
    `The options are ${[...OPTIONS].join(', ')}.`
  )
}

// Every option, undefined until the caller gives it. A copy of the options
// starts from this shape: a null-prototype object filled key by key is a
// dictionary in V8, and reads from one are slower than from an object of a
// fixed shape.
const BLANK_OPTIONS = Object.fromEntries([...OPTIONS].map((name) => [name, undefined]))

// Only an object's own keys are read as options, so a property another library
// put on Object.prototype is neither an option nor an unknown one. A Map or a
// URLSearchParams is refused as a whole, since its options are not own keys
// and it would be read as having none.
const readOptions = (more) => {
  const options = { ...BLANK_OPTIONS }
  if (more === undefined || more === null) return options
  if (typeof more !== 'object' || Array.isArray(more) || Object.prototype.toString.call(more) !== '[object Object]') {
    const named = typeof more === 'object' && !Array.isArray(more) ? `a ${Object.prototype.toString.call(more).slice(8, -1)}` : got(more)
    throw new TypeError(`options must be an object, got ${named}`)
  }
  for (const name of Object.keys(more)) {
    if (!OPTIONS.has(name)) throw unknownOption(name)
    options[name] = more[name]
  }
  return options
}

const readAnswer = (answer, max) => {
  if (answer === undefined || answer === null) return undefined
  if (typeof answer !== 'number') {
    throw new TypeError(`answer must be a number from -${max} to ${max}, got ${got(answer)}`)
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
    throw new TypeError(`max must be a whole number from ${MAX_MIN} to ${ANSWER_LIMIT}, got ${got(max)}`)
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
    throw new TypeError(`operators must be an array such as ['+', '-'], got ${got(operators)}`)
  }
  let bits = 0
  for (const operator of operators) {
    const index = typeof operator === 'string' && operator.length === 1 ? OPERATORS.indexOf(operator) : -1
    if (index < 0) throw new RangeError(`operators must be + - * or /, got ${got(operator)}`)
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
    throw new TypeError(`${name} must be true or false, got ${got(value)}`)
  }
  return value
}

// Only `brackets: 'never'` rules out a group. Any other string, such as
// 'Never' or a 'false' read from a query string, would quietly leave
// brackets in, so it is refused, and so is anything else that is not a flag.
const readBrackets = (brackets) => {
  if (typeof brackets === 'string' && brackets !== 'never') {
    throw new RangeError(`brackets must be true, false or 'never', got ${quoted(brackets)}`)
  }
  if (brackets === 'never') return FLAT
  if (brackets !== undefined && brackets !== null && typeof brackets !== 'boolean') {
    throw new TypeError(`brackets must be true, false or 'never', got ${got(brackets)}`)
  }
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
    `${max < ANSWER_LIMIT ? ` within ${max}` : ''}. ` +
    (max < ANSWER_LIMIT
      ? 'A different answer, a larger max or other operators may work.'
      : 'A different answer or other operators may work.')
  )
}

// Task i of a batch is the task for seed + i, which only holds for whole
// numbers that JavaScript can count up from exactly, and for a last seed
// that mathGen would accept.
const readSeed = (seed, count) => {
  if (seed === undefined || seed === null) return drawSeed(count)
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError(`seed must be a whole number from 0 to ${Number.MAX_SAFE_INTEGER}, got ${got(seed)}`)
  }
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError(`seed must be a whole number from 0 to ${Number.MAX_SAFE_INTEGER}, got ${seed}`)
  }
  // Compared as a difference: seed + count can round past 2^53 before the
  // count is taken off again.
  if (seed > Number.MAX_SAFE_INTEGER - count + 1) {
    throw new RangeError(`a batch of ${count} from seed ${seed} runs past the largest seed, ${Number.MAX_SAFE_INTEGER}`)
  }
  return seed
}

/** Loads the wasm module. Safe to call more than once; the same promise
 *  is handed back. Pass a URL or a Response to override where it loads from.
 *  A load that fails, as when the .wasm could not be fetched, rejects, and
 *  the next call tries again. */
export const init = (input) => {
  // wasm-bindgen takes the override wrapped in an object now, and logs a
  // deprecation warning for every bare argument it is still handed.
  loading = loading || initWasm(input === undefined || input === null ? undefined : { module_or_path: input }).then((exports) => {
    memory = getMemory()
    ints = new Int32Array(memory.buffer)
    ready = true
    return exports
  }, (error) => {
    loading = null
    throw error
  })
  return loading
}

// Without this a call made before init() has finished fails inside the
// wasm-bindgen glue, with "Cannot read properties of undefined".
const assertReady = () => {
  if (!ready) throw new Error('samathgen is not loaded yet: call and await init() first')
}

/**
 * Builds a task whose value is `answer`. Call and await `init()` first.
 *
 * Evaluating `task.join('')` always gives `answer` back: the expression is
 * generated as a tree and bracketed by precedence.
 */
export const mathGen = (length, more) => {
  assertReady()
  const options = readOptions(more)
  const max = readMax(options.max)
  const answers = readAnswers(options.answer, max)
  const allowed = readAllowed(options, answers)
  const seed = readSeed(options.seed, 1)
  // A single task has no use for distinct, but a value that is not a flag is refused as it is in a batch.
  readFlag('distinct', options.distinct, false)

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
export const mathGenBatch = (count, length, more) => {
  assertReady()
  if (!Number.isInteger(count) || count < 0 || count > BATCH_LIMIT) {
    throw new RangeError(`count must be a whole number from 0 to ${BATCH_LIMIT}, got ${got(count)}`)
  }
  const options = readOptions(more)
  const max = readMax(options.max)
  const answers = readAnswers(options.answer, max)
  const allowed = readAllowed(options, answers)
  const seed = readSeed(options.seed, count)

  const quizMode = readFlag('quizMode', options.quizMode, false)
  const distinct = readFlag('distinct', options.distinct, false)
  const build = (withDistinct) => read(generateBatch(
    count,
    clampLength(length),
    answers === undefined ? 0 : answers[0],
    answers === undefined ? 0 : answers[1],
    answers !== undefined,
    options.brackets === true,
    quizMode,
    allowed,
    max,
    seed,
    withDistinct
  ))
  const at = build(distinct)
  if (ints[at] === 0 && count > 0) {
    // Only a repeat that would be drawn past the last seed fails a distinct
    // batch that builds without `distinct`.
    const plain = build(false)
    if (distinct && ints[plain] !== 0) {
      throw new RangeError(`a distinct batch of ${count} from seed ${seed} would need a repeat's seed past the largest seed, ${Number.MAX_SAFE_INTEGER}`)
    }
    throw cannotBuild(length, answers, max, options)
  }
  const tasks = new Array(count)
  let next = at + 1
  for (let i = 0; i < count; i++) {
    const result = decode(ints, next)
    tasks[i] = result
    next += 3 + result.quizOptions.length + result.task.length
  }
  return tasks
}

// The signs a printed worksheet uses. `task.join('')` stays the form that
// evaluates; this is for showing a task to a reader.
const PRINTED = new Map([['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷'], ['(', '('], [')', ')']])

/**
 * Writes a task the way it reads on a printed page: `×` for `*`, `÷` for `/`,
 * and a minus sign `−` for `-` and for a negative number. It is for showing
 * the task; `task.join('')` is the text that evaluates to the answer.
 */
export const displayTask = (task) => {
  if (!Array.isArray(task)) throw new TypeError(`displayTask takes the task array, as in displayTask(result.task), got ${got(task)}`)
  return task.map((token) => {
    if (Number.isInteger(token)) return String(token).replace('-', '−')
    if (!PRINTED.has(token)) throw new TypeError(`a task is made of numbers, operators and brackets, got ${got(token)}`)
    return PRINTED.get(token)
  }).join('')
}

// The value of a task, worked out with the precedence it is written with and
// without eval, so a page that forbids eval can still check one. A division
// that is not exact gives a fraction, as it does in JavaScript; a task from
// mathGen never does.
//
// mathGen nests brackets no deeper than its 32 numbers, so a task nested far
// past that can only come from outside. Each level of nesting is a level of
// recursion here, so an uncapped one exhausts the call stack; a cap well
// below the stack turns reading one into a refusal.
const MAX_NESTING = 512

export const evaluate = (task) => {
  if (!Array.isArray(task)) throw new TypeError(`evaluate takes the task array, as in evaluate(result.task), got ${got(task)}`)
  for (const token of task) {
    if (!Number.isInteger(token) && !(typeof token === 'string' && token.length === 1 && '+-*/()'.includes(token))) {
      throw new TypeError(`a task is made of numbers, operators and brackets, got ${got(token)}`)
    }
  }
  const text = task.join('')
  let at = 0
  let depth = 0
  const malformed = () => new SyntaxError(`a task is one complete expression, got ${quoted(text)}`)
  const sum = () => {
    let value = product()
    while (task[at] === '+' || task[at] === '-') {
      const operator = task[at++]
      const right = product()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }
  const product = () => {
    let value = operand()
    while (task[at] === '*' || task[at] === '/') {
      const operator = task[at++]
      const right = operand()
      if (operator === '*') {
        value *= right
      } else {
        if (right === 0) throw new RangeError(`division by zero in ${quoted(text)}`)
        value /= right
      }
    }
    return value
  }
  const operand = () => {
    const token = task[at++]
    if (typeof token === 'number') return token
    if (token !== '(') throw malformed()
    if (++depth > MAX_NESTING) throw new SyntaxError(`a task nests its brackets no deeper than ${MAX_NESTING}, got ${quoted(text)}`)
    const value = sum()
    if (task[at++] !== ')') throw malformed()
    depth--
    return value
  }
  const value = sum()
  if (at !== task.length) throw malformed()
  return value
}

// The steps of working a task out, from the task itself to its answer, each
// one a task that evaluates to the same answer. A step works out one
// operation: the leftmost one that no operator of higher precedence is
// waiting on, so an operand is a number or a number in its own brackets, and
// a group that is worked out to a non-negative number loses its brackets.
// A negative one keeps them, as mathGen writes every negative number.
const PRECEDENCE = new Map([['+', 1], ['-', 1], ['*', 2], ['/', 2]])
const rank = (token) => PRECEDENCE.get(token) || 0

// Where the operand that ends just before the operator at `at` starts, or -1.
const operandBefore = (task, at) => {
  if (typeof task[at - 1] === 'number') return at - 1
  if (task[at - 1] === ')' && typeof task[at - 2] === 'number' && task[at - 3] === '(') return at - 3
  return -1
}

// Where the operand that starts just after the operator at `at` ends, or -1.
const operandAfter = (task, at) => {
  if (typeof task[at + 1] === 'number') return at + 1
  if (task[at + 1] === '(' && typeof task[at + 2] === 'number' && task[at + 3] === ')') return at + 3
  return -1
}

// Most tokens a task may have to be worked out. Each step rebuilds the task,
// so the work grows with the square of its length, and a task from mathGen is
// about a hundred tokens at most.
const MAX_WORKED_TOKENS = 500

// The task with one step worked out, or undefined when it is a number. A
// number in brackets loses them when it is not negative, or when it is in
// brackets already; a negative number on its own keeps them, as mathGen
// writes it. Then an operation is worked out, the leftmost one that no
// operator of higher precedence is waiting on, and a group worked out to a
// negative number keeps its brackets too.
const workOneOut = (task) => {
  if (task.length === 3 && task[0] === '(' && task[2] === ')') return [task[1]]
  for (let at = 0; at < task.length; at++) {
    if (task[at] === '(' && typeof task[at + 1] === 'number' && task[at + 2] === ')' &&
      (task[at + 1] >= 0 || (task[at - 1] === '(' && task[at + 3] === ')'))) {
      return [...task.slice(0, at), task[at + 1], ...task.slice(at + 3)]
    }
  }
  for (let at = 0; at < task.length; at++) {
    const precedence = rank(task[at])
    if (precedence === 0) continue
    const first = operandBefore(task, at)
    const last = operandAfter(task, at)
    if (first < 0 || last < 0) continue
    if (rank(task[first - 1]) > precedence || rank(task[last + 1]) > precedence) continue
    const span = task.slice(first, last + 1)
    const value = evaluate(span)
    if (!Number.isInteger(value)) {
      throw new RangeError(`workingOut needs a whole number at every step, but ${quoted(span.join(''))} is not one`)
    }
    const whole = first === 0 && last === task.length - 1
    const wrapped = task[first - 1] === '(' && task[last + 1] === ')'
    if (wrapped && value >= 0) return [...task.slice(0, first - 1), value, ...task.slice(last + 2)]
    if (!wrapped && value < 0 && !whole) return [...task.slice(0, first), '(', value, ')', ...task.slice(last + 1)]
    return [...task.slice(0, first), value, ...task.slice(last + 1)]
  }
  return undefined
}

/**
 * The steps of working a task out: the task, then the task with one step
 * worked out, and so on down to its answer. Each step evaluates to the answer,
 * so each can be shown with displayTask. A task that evaluate refuses is
 * refused here in the same way; so is one longer than 500 tokens, and one
 * whose working needs a value that is not a whole number.
 */
export const workingOut = (task) => {
  if (!Array.isArray(task)) throw new TypeError(`workingOut takes the task array, as in workingOut(result.task), got ${got(task)}`)
  if (task.length > MAX_WORKED_TOKENS) {
    throw new RangeError(`workingOut takes a task of at most ${MAX_WORKED_TOKENS} tokens, got ${task.length}`)
  }
  evaluate(task)
  const steps = [task.slice()]
  for (let next = workOneOut(task); next !== undefined; next = workOneOut(next)) steps.push(next)
  return steps
}
