// Node entry point. wasm-pack's nodejs target loads the module synchronously
// from disk, so this works under plain require() and, through Node's named
// export detection, under `import { mathGen } from 'samathgen'` as well.
const { generate_json: generateJson } = require('../dist/node/samathgen.js')

const LENGTH_MIN = 2
const LENGTH_MAX = 32
// Every number in a task stays within this, so an answer past it cannot be
// split at all: 1e6 came back as the one-term task "1000000", and 1e300
// overflowed into a task that evaluated to minus its reported answer.
const ANSWER_LIMIT = 10000

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

module.exports = { mathGen }
