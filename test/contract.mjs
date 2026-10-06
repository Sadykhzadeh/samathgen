// The contract: evaluating the task gives the answer back. Up to 0.1.4 that
// held for about 94% of generated tasks, which is why the old spec - twenty
// random cases - failed on roughly two runs in three. This checks it over
// enough samples that a 6% failure rate could not possibly hide, and uses
// eval() so the judge is JavaScript itself rather than the generator's own
// idea of arithmetic.
//
//   node test/contract.mjs [samples]

import assert from 'node:assert/strict'
import { mathGen as mathGenNamed } from '../js/node.cjs'

const SAMPLES = Number(process.argv[2] || 200_000)

let failures = 0
let checks = 0

const check = (name, fn) => {
  try {
    fn()
    checks++
    console.log(`  ok    ${name}`)
  } catch (error) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${error.message.split('\n')[0]}`)
  }
}

console.log('samathgen contract')

// samathapi does `import { mathGen } from 'samathgen'`, which only works if
// Node can see the named export through the CommonJS entry point.
check('named import works from ESM', () => {
  assert.equal(typeof mathGenNamed, 'function')
})

const mathGen = mathGenNamed

check(`eval(task) === answer over ${SAMPLES.toLocaleString('en-US')} tasks`, () => {
  const examples = []
  let wrong = 0
  for (let i = 0; i < SAMPLES; i++) {
    const length = 2 + (i % 7)
    const brackets = i % 3 === 0
    const result = mathGen(length, { brackets, quizMode: i % 5 === 0 })
    const text = result.task.join('')
    // eslint-disable-next-line no-eval
    const value = eval(text)
    if (value !== result.answer) {
      wrong++
      if (examples.length < 5) examples.push(`${text} = ${value}, reported ${result.answer}`)
    }
  }
  assert.equal(wrong, 0, `${wrong} of ${SAMPLES} did not match:\n${examples.join('\n')}`)
})

check('the task has the requested number of terms', () => {
  for (let length = 2; length <= 12; length++) {
    for (let seed = 0; seed < 200; seed++) {
      const { task } = mathGen(length, { seed })
      const numbers = task.filter((token) => typeof token === 'number').length
      assert.equal(numbers, length, `asked for ${length}, got ${numbers} in ${task.join('')}`)
    }
  }
})

check('length is clamped rather than trusted', () => {
  for (const [given, expected] of [[0, 2], [1, 2], [-5, 2], [1000, 32], [NaN, 2], [undefined, 2]]) {
    const { task } = mathGen(given, { seed: 1 })
    const numbers = task.filter((token) => typeof token === 'number').length
    assert.equal(numbers, expected, `mathGen(${given}) produced ${numbers} terms`)
  }
})

check('an explicit answer of 0 is honoured', () => {
  for (let seed = 0; seed < 500; seed++) {
    const result = mathGen(4, { answer: 0, seed })
    assert.equal(result.answer, 0)
    // eslint-disable-next-line no-eval
    assert.equal(eval(result.task.join('')), 0, result.task.join(''))
  }
})

check('a negative answer round-trips', () => {
  for (let seed = 0; seed < 500; seed++) {
    const result = mathGen(5, { answer: -37, seed })
    assert.equal(result.answer, -37)
    // eslint-disable-next-line no-eval
    assert.equal(eval(result.task.join('')), -37, result.task.join(''))
  }
})

check('without an answer one is drawn from 10..20', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const { answer } = mathGen(3, { seed })
    assert.ok(answer >= 10 && answer <= 20, `drew ${answer}`)
  }
})

check('the same seed gives the same task', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const a = mathGen(5, { seed, quizMode: true, brackets: true })
    const b = mathGen(5, { seed, quizMode: true, brackets: true })
    assert.deepEqual(a, b, `seed ${seed} was not reproducible`)
  }
})

check('different seeds give different tasks', () => {
  const seen = new Set()
  for (let seed = 1; seed <= 500; seed++) {
    seen.add(mathGen(5, { seed }).task.join(''))
  }
  assert.ok(seen.size > 400, `500 seeds produced only ${seen.size} distinct tasks`)
})

check('quizMode gives four distinct options including the answer', () => {
  for (let seed = 0; seed < 2000; seed++) {
    const { answer, quizOptions } = mathGen(3, { quizMode: true, seed })
    assert.equal(quizOptions.length, 4)
    assert.equal(new Set(quizOptions).size, 4, `duplicates in ${quizOptions}`)
    assert.ok(quizOptions.includes(answer), `${answer} missing from ${quizOptions}`)
  }
})

check('without quizMode there are no options', () => {
  assert.deepEqual(mathGen(3, { seed: 1 }).quizOptions, [])
  assert.deepEqual(mathGen(3, { seed: 1, quizMode: false }).quizOptions, [])
})

check('brackets: true delivers a bracketed group', () => {
  let bracketed = 0
  for (let seed = 0; seed < 500; seed++) {
    if (mathGen(5, { brackets: true, seed }).task.includes('(')) bracketed++
  }
  assert.ok(bracketed > 475, `asked 500 times, got ${bracketed}`)
})

check('the task is made only of numbers, operators and brackets', () => {
  const allowed = new Set(['+', '-', '*', '/', '(', ')'])
  for (let seed = 0; seed < 2000; seed++) {
    for (const token of mathGen(6, { brackets: true, seed }).task) {
      if (typeof token === 'number') {
        assert.ok(Number.isInteger(token), `${token} is not an integer`)
      } else {
        assert.ok(allowed.has(token), `unexpected token ${JSON.stringify(token)}`)
      }
    }
  }
})

check('brackets are balanced', () => {
  for (let seed = 0; seed < 5000; seed++) {
    const task = mathGen(8, { brackets: true, seed }).task
    let depth = 0
    for (const token of task) {
      if (token === '(') depth++
      if (token === ')') depth--
      assert.ok(depth >= 0, `closed too early in ${task.join('')}`)
    }
    assert.equal(depth, 0, `unbalanced in ${task.join('')}`)
  }
})

check('the CLI wire format still parses', () => {
  // SaMathAPI sends "<task> <opt1>,<opt2>,<opt3>,<opt4> <answer>" and
  // SaMathCLI splits it on spaces and commas, so no token may contain either.
  const shape = /^[-0-9()*/+]+ -?[0-9]+(,-?[0-9]+){3} -?[0-9]+$/
  for (let seed = 0; seed < 2000; seed++) {
    const r = mathGen(4, { quizMode: true, brackets: true, seed })
    const line = `${r.task.join('')} ${r.quizOptions.join(',')} ${r.answer}`
    assert.match(line, shape, `does not match the CLI format: ${line}`)
  }
})

console.log(`\n${checks} passed, ${failures} failed`)
process.exitCode = failures === 0 ? 0 : 1
