// Node entry point. wasm-pack's nodejs target loads the module synchronously
// from disk, so this works under plain require() and, through Node's named
// export detection, under `import { mathGen } from 'samathgen'` as well.
const { generate_json: generateJson } = require('../dist/node/samathgen.js')

const LENGTH_MIN = 2
const LENGTH_MAX = 32

const drawSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const clampLength = (length) => {
  if (!Number.isFinite(length)) return LENGTH_MIN
  return Math.min(Math.max(Math.trunc(length), LENGTH_MIN), LENGTH_MAX)
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

module.exports = { mathGen }
