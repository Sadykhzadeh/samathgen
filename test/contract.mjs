// The contract: evaluating the task gives the answer back. Up to 0.1.4 that
// held for about 94% of generated tasks, which is why the old spec - twenty
// random cases - failed on roughly two runs in three. This checks it over
// enough samples that a 6% failure rate could not possibly hide, and uses
// eval() so the judge is JavaScript itself rather than the generator's own
// idea of arithmetic.
//
// Both entry points are checked. They wrap the same WebAssembly but each
// carries its own copy of the option handling, so the browser one is loaded
// here from the bytes on disk rather than left to a page somebody has to
// open by hand.
//
//   node test/contract.mjs [samples]

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { init as nodeInit, mathGen as nodeMathGen, mathGenBatch as nodeMathGenBatch } from '../js/node.cjs'
import { init, mathGen as webMathGen, mathGenBatch as webMathGenBatch } from '../js/web.js'

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

const suite = (mathGen, mathGenBatch) => {
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

  check('a length that is not a number is refused rather than read as 2', () => {
    for (const length of ['6', {}, true, [4]]) {
      assert.throws(() => mathGen(length, { seed: 1 }), TypeError, `length ${JSON.stringify(length)}`)
      assert.throws(() => mathGenBatch(2, length, { seed: 1 }), TypeError, `length ${JSON.stringify(length)}`)
    }
    assert.equal(mathGen(null, { seed: 1 }).task.filter((t) => typeof t === 'number').length, 2)
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

  check('the ends of the answer range get every term asked for', () => {
    for (const answer of [-10000, 10000]) {
      for (let seed = 0; seed < 100; seed++) {
        const result = mathGen(32, { answer, seed, brackets: seed % 2 === 0 })
        const text = result.task.join('')
        assert.equal(result.task.filter((t) => typeof t === 'number').length, 32, text)
        // eslint-disable-next-line no-eval
        assert.equal(eval(text), answer, text)
      }
    }
  })

  check('an answer it cannot build is refused, not mangled', () => {
    // 1e6 used to come back as the one-term task "1000000", and 1e300 as a
    // task that evaluated to minus its own answer.
    for (const answer of [10001, -10001, 1e6, 1e300, 2.5, NaN, Infinity]) {
      assert.throws(() => mathGen(4, { answer }), RangeError, `answer ${answer}`)
    }
    for (const answer of ['12', {}, true]) {
      assert.throws(() => mathGen(4, { answer }), TypeError, `answer ${JSON.stringify(answer)}`)
    }
    assert.ok(mathGen(4, { answer: null, seed: 1 }).answer >= 10)
  })

  check('answer can be a range, and every answer in it is drawn', () => {
    const batch = mathGenBatch(2000, 3, { answer: [50, 100], max: 100, seed: 1, negatives: false })
    const seen = new Set()
    for (const { task, answer } of batch) {
      assert.ok(answer >= 50 && answer <= 100, `answer ${answer} outside 50..100`)
      // eslint-disable-next-line no-eval
      assert.equal(eval(task.join('')), answer, task.join(''))
      seen.add(answer)
    }
    assert.equal(seen.size, 51, 'not every answer from 50 to 100 was drawn')
    // The ends count, however wide the range.
    const wide = mathGenBatch(3000, 2, { answer: [-10000, 10000], seed: 2 }).map((task) => task.answer)
    assert.ok(wide.every((answer) => answer >= -10000 && answer <= 10000))
    assert.ok(wide.some((answer) => answer < -9000) && wide.some((answer) => answer > 9000))
    assert.ok(wide.some((answer) => answer < 0) && wide.some((answer) => answer > 0))
  })

  check('a range of one answer is that answer, and task i of a ranged batch is the task for seed + i', () => {
    for (let seed = 0; seed < 100; seed++) {
      assert.deepEqual(mathGen(4, { answer: [7, 7], seed }), mathGen(4, { answer: 7, seed }))
    }
    const more = { answer: [20, 40], quizMode: true, brackets: true }
    const batch = mathGenBatch(30, 5, { ...more, seed: 99 })
    batch.forEach((task, i) => assert.deepEqual(task, mathGen(5, { ...more, seed: 99 + i }), `task ${i}`))
  })

  check('an answer range that cannot be honoured is refused with the reason', () => {
    assert.throws(() => mathGen(4, { answer: [5, 1] }), /answer range must go from low to high, got \[5, 1\]/)
    assert.throws(() => mathGen(4, { answer: [5] }), RangeError)
    assert.throws(() => mathGen(4, { answer: [1, 2, 3] }), /range \[low, high\], got an array of 3/)
    assert.throws(() => mathGen(4, { answer: [5, null] }), TypeError)
    assert.throws(() => mathGen(4, { answer: ['1', 5] }), TypeError)
    assert.throws(() => mathGen(4, { answer: [1, 20000] }), RangeError)
    assert.throws(() => mathGen(4, { answer: [1, 50], max: 20 }), RangeError)
    assert.throws(() => mathGen(4, { answer: [-5, 20], negatives: false }), /answer -5 is negative, but negatives is false/)
    // 14 terms of + without negatives make 14 at the least.
    const sums = { operators: ['+'], negatives: false }
    assert.throws(() => mathGen(14, { ...sums, answer: [1, 13] }), /evaluating to an answer from 1 to 13 can be built/)
    assert.throws(() => mathGenBatch(2, 14, { ...sums, answer: [0, 13] }), RangeError)
    assert.ok(mathGen(14, { ...sums, answer: [1, 20], seed: 1 }).answer >= 14)
    // Of a wide range, 64 answers are tried before it is given up.
    assert.throws(() => mathGen(32, { ...sums, answer: [0, 30] }), /an answer from 0 to 30 can be built/)
  })

  check('a seed that is not a number is refused rather than ignored', () => {
    for (const seed of ['42', NaN, Infinity, {}]) {
      assert.throws(() => mathGen(4, { seed }), TypeError, `seed ${String(seed)}`)
    }
    assert.equal(typeof mathGen(4, { seed: null }).answer, 'number')
  })

  check('a seed outside 0..2^53-1 or with a fraction is refused', () => {
    // Each of these could only be honoured as some other seed.
    for (const seed of [-1, -5, 1.5, 2 ** 53, 1e20]) {
      assert.throws(() => mathGen(4, { seed }), RangeError, `seed ${seed}`)
      assert.throws(() => mathGenBatch(2, 4, { seed }), RangeError, `seed ${seed}`)
    }
    for (const seed of [0, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(mathGen(4, { seed }), mathGenBatch(1, 4, { seed })[0], `seed ${seed}`)
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

  check('where the answer falls among the options gives nothing away', () => {
    // As often the smallest of the four as the largest or either between,
    // so picking by size is right one time in four and no more.
    const ranks = [0, 0, 0, 0]
    for (let seed = 0; seed < 20000; seed++) {
      const { answer, quizOptions } = mathGen(2 + (seed % 7), { quizMode: true, seed })
      ranks[quizOptions.filter((option) => option < answer).length]++
      assert.ok(quizOptions.every((option) => Math.abs(option - answer) <= 5), `${quizOptions} for ${answer}`)
    }
    for (const count of ranks) assert.ok(Math.abs(count - 5000) < 400, `ranks ${ranks}`)
  })

  check('without quizMode there are no options', () => {
    assert.deepEqual(mathGen(3, { seed: 1 }).quizOptions, [])
    assert.deepEqual(mathGen(3, { seed: 1, quizMode: false }).quizOptions, [])
  })

  check('brackets: true delivers a bracketed group', () => {
    // A group, as in (2+3)*4, and not only the brackets around a negative
    // number, as in 7-(-5).
    const group = (task) => task.some((token, i) =>
      token === '(' && !(typeof task[i + 1] === 'number' && task[i + 1] < 0))
    for (let length = 3; length <= 8; length++) {
      for (const negatives of [true, false]) {
        for (let seed = 0; seed < 200; seed++) {
          const { task } = mathGen(length, { brackets: true, negatives, seed })
          assert.ok(group(task), `no group in ${task.join('')}`)
        }
      }
    }
  })

  check("brackets: 'never' groups nothing, whatever the operators", () => {
    const group = (task) => task.some((token, i) =>
      token === '(' && !(typeof task[i + 1] === 'number' && task[i + 1] < 0))
    const symbols = ['+', '-', '*', '/']
    for (let bits = 1; bits < 16; bits++) {
      // Every set with * in it, or both + and -, has room for any length.
      if (!(bits & 4) && (bits & 3) !== 3) continue
      const operators = symbols.filter((_, i) => bits & (1 << i))
      for (const negatives of [true, false]) {
        for (let seed = 0; seed < 100; seed++) {
          const length = 2 + (seed % 9)
          const more = { operators, negatives, seed, brackets: 'never', max: seed % 2 === 0 ? 20 : 10000 }
          const result = mathGen(length, more)
          const text = result.task.join('')
          assert.ok(!group(result.task), `${text} from ${operators.join('')}`)
          if (!negatives) assert.ok(!result.task.includes('('), text)
          assert.equal(result.task.filter((t) => typeof t === 'number').length, length, text)
          // eslint-disable-next-line no-eval
          assert.equal(eval(text), result.answer, text)
        }
      }
    }
    // `/` alone is one chain, whose first number is the answer times every
    // divisor after it.
    assert.throws(() => mathGen(16, { operators: ['/'], brackets: 'never', seed: 1 }), /16 terms .* from \/ without brackets$/)
    assert.throws(
      () => mathGen(12, { operators: ['-'], negatives: false, max: 20, brackets: 'never' }),
      /from - without negative numbers or brackets within 20$/
    )
  })

  check("a brackets string other than 'never' is refused rather than read as false", () => {
    for (const brackets of ['Never', 'none', 'false', 'true', '']) {
      assert.throws(() => mathGen(4, { brackets, seed: 1 }), /brackets must be true, false or 'never'/, JSON.stringify(brackets))
      assert.throws(() => mathGenBatch(2, 4, { brackets, seed: 1 }), RangeError, JSON.stringify(brackets))
    }
    for (const brackets of [undefined, null, false]) {
      assert.deepEqual(mathGen(4, { brackets, seed: 1 }), mathGen(4, { seed: 1 }), String(brackets))
    }
    for (const brackets of [0, 1, {}, [], () => true]) {
      assert.throws(() => mathGen(4, { brackets, seed: 1 }), TypeError, String(brackets))
    }
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

  check('task i of a batch is the task mathGen gives for seed + i', () => {
    const shapes = [
      [1, 2, {}],
      [25, 4, { quizMode: true }],
      [40, 7, { brackets: true, answer: -12 }],
      [10, 32, { quizMode: true, brackets: true, answer: 0 }],
    ]
    for (const [count, length, more] of shapes) {
      for (const seed of [0, 1, 99, 123456789]) {
        const batch = mathGenBatch(count, length, { ...more, seed })
        assert.equal(batch.length, count)
        batch.forEach((task, i) => {
          assert.deepEqual(task, mathGen(length, { ...more, seed: seed + i }), `task ${i} from seed ${seed}`)
        })
      }
    }
  })

  check('results are read correctly after the memory has grown, and after a batch that grew it', () => {
    // The biggest batch there is, of the longest tasks: more than a
    // megabyte of integers, which the WebAssembly memory has to grow for.
    const seed = 1000
    const big = mathGenBatch(10000, 32, { quizMode: true, seed })
    assert.equal(big.length, 10000)
    for (const i of [0, 1, 5000, 9999]) {
      assert.deepEqual(big[i], mathGen(32, { quizMode: true, seed: seed + i }), `task ${i}`)
    }
    // The result of the next, smaller call is not the tail of the big one.
    assert.deepEqual(mathGenBatch(2, 3, { seed: 7 }), [mathGen(3, { seed: 7 }), mathGen(3, { seed: 8 })])
    assert.deepEqual(mathGenBatch(0, 3), [])
  })

  check(`a batch keeps the contract too,${(SAMPLES / 10).toLocaleString('en-US')} tasks`, () => {
    let wrong = 0
    for (let i = 0; i < SAMPLES / 1000; i++) {
      for (const result of mathGenBatch(100, 2 + (i % 7), { brackets: i % 2 === 0, quizMode: true })) {
        // eslint-disable-next-line no-eval
        if (eval(result.task.join('')) !== result.answer) wrong++
        assert.ok(result.quizOptions.includes(result.answer))
      }
    }
    assert.equal(wrong, 0)
  })

  check('distinct: true leaves no repeat in a batch and the rest in place', () => {
    for (const [length, more] of [[2, { operators: ['*'] }], [2, { operators: ['/'], max: 100, quizMode: true }], [3, {}]]) {
      for (let seed = 0; seed < 50; seed++) {
        const plain = mathGenBatch(20, length, { ...more, seed: seed * 100 })
        const distinct = mathGenBatch(20, length, { ...more, seed: seed * 100, distinct: true })
        const texts = distinct.map((task) => task.task.join(''))
        assert.equal(new Set(texts).size, 20, texts.join(' '))
        distinct.forEach((task, i) => {
          if (!texts.slice(0, i).includes(plain[i].task.join(''))) assert.deepEqual(task, plain[i], `task ${i}`)
          // eslint-disable-next-line no-eval
          assert.equal(eval(texts[i]), task.answer, texts[i])
        })
      }
    }
    // Ten as a sum of two numbers from 1 up is one of nine tasks.
    const sums = mathGenBatch(30, 2, { answer: 10, operators: ['+'], negatives: false, distinct: true, seed: 1 })
    assert.equal(new Set(sums.map((task) => task.task.join(''))).size, 9)
    for (const distinct of [false, null, undefined]) {
      assert.deepEqual(mathGenBatch(20, 2, { seed: 5, distinct }), mathGenBatch(20, 2, { seed: 5 }), String(distinct))
    }
    assert.deepEqual(mathGen(2, { seed: 5, distinct: true }), mathGen(2, { seed: 5 }))
  })

  check('a batch count outside 0..10000 is refused', () => {
    assert.deepEqual(mathGenBatch(0, 4), [])
    assert.equal(mathGenBatch(10000, 2, { seed: 1 }).length, 10000)
    for (const count of [-1, 1.5, 10001, NaN, '3', undefined]) {
      assert.throws(() => mathGenBatch(count, 4), RangeError, `count ${String(count)}`)
    }
    assert.throws(() => mathGenBatch(3, 4, { answer: 1e6 }), RangeError)
    assert.throws(() => mathGenBatch(3, 4, { seed: '1' }), TypeError)
  })

  check('operators keeps every task to the operators named', () => {
    const symbols = ['+', '-', '*', '/']
    for (let bits = 1; bits < 16; bits++) {
      const operators = symbols.filter((_, i) => bits & (1 << i))
      for (let seed = 0; seed < 150; seed++) {
        const length = 2 + (seed % 9)
        const result = mathGen(length, { operators, seed, brackets: seed % 2 === 0 })
        const text = result.task.join('')
        for (const token of result.task) {
          if (symbols.includes(token)) assert.ok(operators.includes(token), `${token} in ${text} from ${operators}`)
        }
        assert.equal(result.task.filter((t) => typeof t === 'number').length, length, text)
        // eslint-disable-next-line no-eval
        assert.equal(eval(text), result.answer, text)
      }
    }
  })

  check('leaving operators out means all four, in any order', () => {
    for (let seed = 0; seed < 300; seed++) {
      const plain = mathGen(5, { seed, brackets: true })
      assert.deepEqual(mathGen(5, { seed, brackets: true, operators: ['+', '-', '*', '/'] }), plain)
      assert.deepEqual(mathGen(5, { seed, brackets: true, operators: ['/', '*', '-', '+', '+'] }), plain)
    }
  })

  check('operators that cannot reach the answer are refused', () => {
    assert.throws(() => mathGen(3, { answer: 0, operators: ['*', '/'] }), RangeError)
    assert.throws(() => mathGen(3, { answer: 6000, operators: ['/'] }), RangeError)
    assert.throws(() => mathGenBatch(4, 3, { answer: 0, operators: ['*'] }), RangeError)
    assert.equal(mathGen(3, { answer: 0, operators: ['-'] }).answer, 0)
    assert.equal(mathGen(3, { answer: 5000, operators: ['/'], seed: 3 }).answer, 5000)
  })

  check('operators that are not a list of + - * / are refused', () => {
    for (const operators of [[], ['x'], ['toString'], ['++'], [1]]) {
      assert.throws(() => mathGen(3, { operators }), RangeError, JSON.stringify(operators))
    }
    assert.throws(() => mathGen(3, { operators: '+-' }), TypeError)
  })

  check('negatives: false keeps every number and option at 0 or above', () => {
    const symbols = ['+', '-', '*', '/']
    for (let bits = 1; bits < 16; bits++) {
      const operators = symbols.filter((_, i) => bits & (1 << i))
      for (let seed = 0; seed < 150; seed++) {
        const length = 2 + (seed % 5)
        const more = { operators, seed, negatives: false, quizMode: true, brackets: seed % 2 === 0 }
        // `+` alone needs at least one unit of answer per term.
        if (bits === 1) more.answer = 10 + (seed % 20)
        const result = mathGen(length, more)
        const text = result.task.join('')
        assert.ok(result.task.every((t) => typeof t !== 'number' || t >= 0), text)
        assert.ok(result.quizOptions.every((o) => o >= 0), `${result.quizOptions} for ${text}`)
        // eslint-disable-next-line no-eval
        assert.equal(eval(text), result.answer, text)
      }
    }
    for (const task of mathGenBatch(500, 8, { negatives: false, answer: 0, seed: 1 })) {
      assert.ok(task.task.every((t) => typeof t !== 'number' || t >= 0), task.task.join(''))
    }
  })

  check('negatives are on unless false, and null or undefined mean the default', () => {
    for (let seed = 0; seed < 300; seed++) {
      const plain = mathGen(6, { seed, quizMode: true })
      for (const negatives of [true, null, undefined]) {
        assert.deepEqual(mathGen(6, { seed, quizMode: true, negatives }), plain)
      }
    }
    const all = mathGenBatch(500, 6, { seed: 1 }).flatMap((r) => r.task)
    assert.ok(all.some((t) => typeof t === 'number' && t < 0), 'no negative number in 500 tasks')
  })

  check('an option the library does not have is refused, with the nearest one named', () => {
    for (const [wrong, near] of [
      ['negative', 'negatives'],
      ['quizmode', 'quizMode'],
      ['operator', 'operators'],
      ['bracket', 'brackets'],
      ['sead', 'seed'],
      ['maxx', 'max'],
    ]) {
      const message = new RegExp(`unknown option "${wrong}", did you mean ${near}\\? The options are `)
      assert.throws(() => mathGen(4, { [wrong]: false }), message, wrong)
      assert.throws(() => mathGenBatch(2, 4, { [wrong]: false }), message, wrong)
    }
    // Far from every option: no guess, but the list.
    assert.throws(() => mathGen(4, { difficulty: 3 }), /unknown option "difficulty"\. The options are answer, brackets, distinct, max, negatives, operators, quizMode, seed\./)
    // Every real option is let through, and `distinct` by a single task too.
    const everything = { answer: 12, brackets: true, distinct: true, max: 100, negatives: true, operators: ['+', '-', '*', '/'], quizMode: true, seed: 3 }
    assert.equal(mathGen(4, everything).answer, 12)
    assert.equal(mathGenBatch(3, 4, everything).length, 3)
    // Options are an object or nothing.
    for (const more of ['negatives', 5, true, [], ['seed']]) {
      assert.throws(() => mathGen(4, more), /options must be an object, got /, JSON.stringify(more))
      assert.throws(() => mathGenBatch(2, 4, more), TypeError, JSON.stringify(more))
    }
    assert.equal(typeof mathGen(4, null).answer, 'number')
  })

  check('a flag that is not true or false is refused instead of read as the default', () => {
    // A "false" from a query string or a 0 must not leave negative numbers
    // in for a class that asked to be spared them.
    for (const name of ['negatives', 'quizMode', 'brackets']) {
      for (const value of ['false', 'true', '', 0, 1, {}, []]) {
        const message = new RegExp(`${name} must be (true or false|true, false or 'never'), got`)
        assert.throws(() => mathGen(4, { [name]: value, seed: 1 }), message, `${name}: ${JSON.stringify(value)}`)
        assert.throws(() => mathGenBatch(2, 4, { [name]: value, seed: 1 }), message, `${name}: ${JSON.stringify(value)}`)
      }
    }
    for (const value of ['false', 0, 1, {}]) {
      assert.throws(() => mathGenBatch(2, 4, { distinct: value, seed: 1 }), /distinct must be true or false, got/, String(value))
    }
    assert.throws(() => mathGen(4, { negatives: 'false' }), /negatives must be true or false, got "false"/)
    assert.throws(() => mathGen(4, { negatives: 0 }), /negatives must be true or false, got 0$/)
  })

  check('negatives: false refuses what it cannot build', () => {
    assert.throws(() => mathGen(3, { answer: -4, negatives: false }), RangeError)
    assert.throws(() => mathGen(3, { answer: 0, negatives: false, operators: ['+', '*'] }), RangeError)
    assert.throws(() => mathGen(5, { answer: 3, negatives: false, operators: ['+'] }), /5 terms evaluating to 3/)
    assert.throws(() => mathGenBatch(2, 21, { negatives: false, operators: ['+'] }), /21 terms evaluating to an answer from 10 to 20/)
    assert.equal(mathGen(5, { answer: 5, negatives: false, operators: ['+'], seed: 2 }).task.join(''), '1+1+1+1+1')
  })

  check('max keeps every number, step and option within it', () => {
    // Each number, and each running result as a pupil works the task out:
    // * and / first, then left to right.
    const steps = (task) => {
      let at = 0
      const seen = []
      const saw = (value) => (seen.push(value), value)
      const atom = () => {
        const token = task[at++]
        if (token !== '(') return saw(token)
        const value = sum()
        at++
        return value
      }
      const product = () => {
        let value = atom()
        while (task[at] === '*' || task[at] === '/') {
          const op = task[at++]
          const right = atom()
          value = saw(op === '*' ? value * right : value / right)
        }
        return value
      }
      const sum = () => {
        let value = product()
        while (task[at] === '+' || task[at] === '-') {
          const op = task[at++]
          const right = product()
          value = saw(op === '+' ? value + right : value - right)
        }
        return value
      }
      sum()
      return seen
    }
    for (const max of [10, 20, 100]) {
      for (const negatives of [true, false]) {
        const floor = negatives ? -max : 0
        for (let seed = 0; seed < 600; seed++) {
          const length = 2 + (seed % 9)
          const result = mathGen(length, { max, negatives, seed, quizMode: true, brackets: seed % 2 === 0 })
          const text = result.task.join('')
          // eslint-disable-next-line no-eval
          assert.equal(eval(text), result.answer, text)
          assert.equal(result.task.filter((t) => typeof t === 'number').length, length, text)
          for (const value of [...steps(result.task), ...result.quizOptions]) {
            assert.ok(value >= floor && value <= max, `${value} in ${text} ${result.quizOptions}, max ${max}`)
          }
        }
      }
    }
  })

  check('without an answer, a max below 20 draws one from half of it up to it', () => {
    for (const [max, low, high] of [[10, 5, 10], [13, 7, 13], [20, 10, 20], [10000, 10, 20]]) {
      const drawn = new Set(mathGenBatch(500, 3, { max, seed: 1 }).map((task) => task.answer))
      assert.deepEqual([...drawn].sort((a, b) => a - b), Array.from({ length: high - low + 1 }, (_, i) => low + i), `max ${max}`)
    }
  })

  check('without an answer, one the other options can build is drawn', () => {
    // Taking away within twenty without negatives cannot make 20, and a
    // worksheet of twenty tasks drawing from 10 to 20 all but surely meets it.
    const more = { operators: ['-'], negatives: false, max: 20 }
    const drawn = new Set(mathGenBatch(500, 3, { ...more, seed: 1 }).map((task) => task.answer))
    assert.deepEqual([...drawn].sort((a, b) => a - b), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    for (let seed = 0; seed < 300; seed++) {
      assert.equal(mathGen(3, { operators: ['/'], max: 20, seed }).answer, 10)
      assert.ok(mathGen(14, { operators: ['+'], negatives: false, seed }).answer >= 14)
    }
    assert.throws(() => mathGen(3, { operators: ['/'], max: 19 }), /an answer from 10 to 19 can be built from \/ within 19$/)
  })

  check('a max it cannot honour is refused', () => {
    for (const max of [9, 0, -20, 10001, 12.5, NaN, Infinity]) {
      assert.throws(() => mathGen(3, { max }), RangeError, `max ${max}`)
      assert.throws(() => mathGenBatch(2, 3, { max }), RangeError, `max ${max}`)
    }
    for (const max of ['20', {}, true]) {
      assert.throws(() => mathGen(3, { max }), TypeError, `max ${JSON.stringify(max)}`)
    }
    assert.throws(() => mathGen(3, { max: 20, answer: 21 }), /from -20 to 20, got 21/)
    assert.throws(() => mathGen(3, { max: 20, answer: 11, operators: ['/'] }), /evaluating to 11 can be built from \/ within 20/)
    assert.throws(
      () => mathGen(11, { max: 10, operators: ['+'], negatives: false }),
      /11 terms evaluating to an answer from 5 to 10 can be built from \+ without negative numbers within 10$/
    )
    for (let seed = 0; seed < 100; seed++) {
      assert.deepEqual(mathGen(5, { seed, max: 10000, quizMode: true }), mathGen(5, { seed, max: null, quizMode: true }))
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
}

console.log('samathgen contract')

console.log('\nnode entry point')
// samathapi does `import { mathGen } from 'samathgen'`, which only works if
// Node can see the named export through the CommonJS entry point.
check('named import works from ESM', () => {
  assert.equal(typeof nodeMathGen, 'function')
})
// Code written for the browser entry point awaits init() first.
check('init() is there and resolves', () => {
  assert.ok(nodeInit() instanceof Promise)
})
await nodeInit()
suite(nodeMathGen, nodeMathGenBatch)

console.log('\nbrowser entry point')
check('a call before init() says to await it', () => {
  assert.throws(() => webMathGen(3), /await init\(\)/)
  assert.throws(() => webMathGenBatch(2, 3), /await init\(\)/)
})
// A page whose first fetch of the .wasm failed has to be able to try again.
const failedLoad = await init(new Uint8Array([0, 1, 2, 3])).then(() => null, (error) => error)
const warnings = []
const warn = console.warn
console.warn = (...args) => warnings.push(args.join(' '))
const loadError = await init(readFileSync(new URL('../dist/web/samathgen_bg.wasm', import.meta.url)))
  .then(() => null, (error) => error)
console.warn = warn
check('init() takes the module bytes without complaint', () => {
  assert.deepEqual(warnings, [])
})
check('init() loads after a load that failed', () => {
  assert.ok(failedLoad instanceof Error, 'bytes that are not WebAssembly were taken')
  assert.equal(loadError, null, loadError && loadError.message)
})
suite(webMathGen, webMathGenBatch)

console.log('\nboth')
check('the same seed gives the same task from either entry point', () => {
  for (let seed = 0; seed < 2000; seed++) {
    const more = { seed, quizMode: seed % 2 === 0, brackets: seed % 3 === 0 }
    if (seed % 5 === 0) more.answer = (seed % 41) - 20
    if (seed % 7 === 0) more.brackets = 'never'
    const length = 2 + (seed % 9)
    assert.deepEqual(webMathGen(length, more), nodeMathGen(length, more), `seed ${seed}`)
  }
  const more = { seed: 7, quizMode: true, brackets: true }
  assert.deepEqual(webMathGenBatch(500, 6, more), nodeMathGenBatch(500, 6, more), 'batch')
  const tables = { seed: 7, operators: ['*'], distinct: true }
  assert.deepEqual(webMathGenBatch(40, 2, tables), nodeMathGenBatch(40, 2, tables), 'distinct batch')
})

console.log(`\n${checks} passed, ${failures} failed`)
process.exitCode = failures === 0 ? 0 : 1
