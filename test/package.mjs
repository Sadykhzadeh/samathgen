// Checks what the two packages carry: the npm tarball and the crate. Neither
// should ship the test, benchmark, build or CI files of the repository.
//
//   node test/package.mjs

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const crateFiles = execFileSync('cargo', ['package', '--list', '--allow-dirty'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const crateAllowed = /^(src\/|Cargo\.toml(\.orig)?$|Cargo\.lock$|LICENSE$|README\.md$|\.cargo_vcs_info\.json$)/
const tarballFiles = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }))[0].files.map(({ path }) => path)
const tarballAllowed = /^(js\/|dist\/|src\/|Cargo\.toml$|LICENSE$|README\.md$|package\.json$)/

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${error.message.split('\n')[0]}`)
  }
}

check('the crate carries only its sources and metadata', () => {
  const extra = crateFiles.filter((file) => !crateAllowed.test(file))
  assert.deepEqual(extra, [], 'files that should not be in the crate')
})

check('the crate carries the sources it builds from', () => {
  assert.ok(crateFiles.includes('src/lib.rs'))
  assert.ok(crateFiles.includes('Cargo.toml'))
})

check('the npm tarball carries only the package', () => {
  const extra = tarballFiles.filter((file) => !tarballAllowed.test(file))
  assert.deepEqual(extra, [], 'files that should not be in the tarball')
})

console.log(failures === 0 ? 'package contents are as expected' : `${failures} package checks failed`)
process.exit(failures === 0 ? 0 : 1)
