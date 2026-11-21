// Runs every ```js block of the README against the Node entry point, so that
// an example cannot go on promising what the library no longer does. A block
// passes when it runs to the end without throwing; what it prints is for the
// reader.
//
//   npm run build && node test/readme.mjs

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const blocks = [...readme.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((match) => match[1])
assert.ok(blocks.length >= 4, `only ${blocks.length} js blocks found in the README`)

const entry = pathToFileURL(fileURLToPath(new URL('../js/node.cjs', import.meta.url))).href

let failures = 0
for (const [index, block] of blocks.entries()) {
  // The README imports the package by name; here that is the Node entry point.
  // A block that does not import anything goes on from the ones before it.
  const imports = /^import /m.test(block) ? '' : `import { mathGen, mathGenBatch } from '${entry}'\n`
  const source = `const console = { log () {} }\n${imports}${block.replaceAll("from 'samathgen'", `from '${entry}'`)}`
  const label = `README js block ${index + 1} of ${blocks.length}`
  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    console.log(`  ok    ${label}`)
  } catch (error) {
    failures++
    console.log(`  FAIL  ${label}`)
    console.log(`        ${String(error.message).split('\n')[0]}`)
    console.log(block.split('\n').map((line) => `        | ${line}`).join('\n'))
  }
}

// The README's CommonJS line, resolved through the package's own exports.
const required = createRequire(import.meta.url)('samathgen')
assert.equal(required.mathGen(4, { seed: 1 }).task.join(''), '28-(2*13+(-11))')
console.log('  ok    require(\'samathgen\') gives mathGen')

// The browser condition of the exports has to name the entry that waits for
// init(), and the default one the Node entry that does not.
const root = fileURLToPath(new URL('..', import.meta.url))
const probe = "import { mathGen } from 'samathgen'; try { console.log(mathGen(4, { seed: 1 }).answer) } catch (error) { console.log(error.message) }"
const node = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' })
assert.equal(node.trim(), '13', 'the default condition gives the Node entry')
const browser = execFileSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' })
assert.match(browser, /call and await init\(\) first/, 'the browser condition gives the entry that waits for init()')
console.log('  ok    the browser condition gives the entry that waits for init()')

// The shares of tasks the README quotes come from seeded batches, so they are
// measured here, and the rounded figures have to be the ones it gives.
const seeded = (length, more) => {
  const tasks = []
  for (let k = 0; k < 20; k++) tasks.push(...required.mathGenBatch(10000, length, { ...more, seed: 1000000 * k + 7 }))
  return tasks
}
const share = (tasks, test) => Math.round(100 * tasks.filter(test).length / tasks.length)
const numbers = ({ task }) => task.filter((token) => typeof token === 'number')
const pastHundred = (value) => numbers(value).some((n) => n > 100)
const pastTwenty = (value) => numbers(value).some((n) => n > 20)
const grouped = ({ task }) => task.includes('(')
const withAnswers = { answer: [10, 20] }
const plusMinus = { operators: ['+', '-'], negatives: false, answer: [10, 20] }
const three = seeded(3, plusMinus)
const four = seeded(4, plusMinus)
const figures = [
  `turns up in ${share(seeded(2, withAnswers), pastHundred)}% of tasks of two numbers and ${share(seeded(8, withAnswers), pastHundred)}% of tasks of eight`,
  `passes 20 in ${share(three, pastTwenty)}% of tasks of three`,
  `${share(three.filter(pastTwenty), grouped)}% of those tasks of three and ${share(four.filter(pastTwenty), grouped)}% of those of four`,
]
const quoted = readme.replace(/\s+/g, ' ')
for (const figure of figures) {
  assert.ok(quoted.includes(figure), `the README should say: ${figure}`)
}
console.log('  ok    the shares the README quotes match a seeded run')

// Two numbers make few tasks, so a batch of them repeats. The README gives the
// size of the pool of `*` and the repeats a batch of 20 holds, on average, for
// three sets of options; they are measured over seeded batches here.
const repeatsIn20 = (more) => {
  let repeats = 0
  for (let k = 0; k < 10000; k++) {
    const texts = required.mathGenBatch(20, 2, { ...more, seed: 100 * k + 1 }).map(({ task }) => task.join(''))
    repeats += 20 - new Set(texts).size
  }
  return (repeats / 10000).toFixed(1)
}
const pool = new Set(required.mathGenBatch(10000, 2, { operators: ['*'], seed: 7 }).map(({ task }) => task.join(''))).size
const repeats = `make ${pool} different tasks, and a batch of 20 holds ${repeatsIn20({ operators: ['*'] })} repeats on average; of \`/\` within 100, ${repeatsIn20({ operators: ['/'], max: 100 })}, and adding within 20 without negatives, ${repeatsIn20({ operators: ['+', '-'], max: 20, negatives: false })}.`
assert.ok(quoted.includes(repeats), `the README should say: ${repeats}`)
console.log('  ok    the pool and repeats the README quotes match a seeded run')

console.log(failures === 0 ? `${blocks.length} README examples ran` : `${failures} README examples failed`)
process.exit(failures === 0 ? 0 : 1)
