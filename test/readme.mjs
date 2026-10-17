// Runs every ```js block of the README against the Node entry point, so that
// an example cannot go on promising what the library no longer does. A block
// passes when it runs to the end without throwing; what it prints is for the
// reader.
//
//   npm run build && node test/readme.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

console.log(failures === 0 ? `${blocks.length} README examples ran` : `${failures} README examples failed`)
process.exit(failures === 0 ? 0 : 1)
