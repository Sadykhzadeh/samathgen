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

console.log(failures === 0 ? `${blocks.length} README examples ran` : `${failures} README examples failed`)
process.exit(failures === 0 ? 0 : 1)
