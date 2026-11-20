// Runs scripts/build.mjs in a throwaway copy of the package, with stand-ins
// for cargo and wasm-pack, so that what a build does to dist can be checked
// without a Rust toolchain or a compile that takes minutes. The stand-ins
// write a marker into each file, which shows which build left it there.
//
//   node test/build.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const project = mkdtempSync(join(tmpdir(), 'samathgen-build-'))

if (process.platform === 'win32') {
  console.log('  skip  the build script test, which needs a POSIX shell for its stand-in cargo')
  process.exit(0)
}

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (condition) => {
  const deadline = Date.now() + 30_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the build')
    await sleep(20)
  }
}

// The build runs in its own process group, so that an interrupt reaches the
// wasm-pack it started as well, as it does when a terminal sends one.
const start = (mark, slow = false) => {
  const child = spawn(process.execPath, ['scripts/build.mjs'], {
    cwd: project,
    detached: true,
    env: { ...process.env, PATH: `${join(project, 'bin')}${delimiter}${process.env.PATH}`, MARK: mark, SLOW: slow ? '1' : '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, exited, output: () => stdout }
}

const read = (file) => readFileSync(join(project, 'dist', file), 'utf8')

// Every file under dist with its contents, so that a check can say the whole
// directory is as it was, not just one file of it.
const listing = (dir = join(project, 'dist'), prefix = '') => readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory()
    ? listing(join(dir, entry.name), `${prefix}${entry.name}/`)
    : [[`${prefix}${entry.name}`, readFileSync(join(dir, entry.name), 'utf8')]])

try {
  mkdirSync(join(project, 'scripts'))
  mkdirSync(join(project, 'node_modules', 'wasm-pack'), { recursive: true })
  mkdirSync(join(project, 'bin'))
  cpSync(join(root, 'scripts', 'build.mjs'), join(project, 'scripts', 'build.mjs'))

  writeFileSync(join(project, 'node_modules', 'wasm-pack', 'run.js'), `
    const { mkdirSync, writeFileSync } = require('node:fs')
    const { join } = require('node:path')
    const args = process.argv.slice(2)
    const out = args[args.indexOf('--out-dir') + 1]
    const target = args[args.indexOf('--target') + 1]
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'samathgen.js'), process.env.MARK + '\\n')
    writeFileSync(join(out, 'samathgen_bg.wasm'), process.env.MARK + '\\n')
    for (const extra of ['.gitignore', 'LICENSE', 'README.md']) writeFileSync(join(out, extra), 'x')
    if (target === 'web' && process.env.SLOW) setInterval(() => {}, 1000)
  `)
  writeFileSync(join(project, 'bin', 'cargo'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(project, 'bin', 'cargo'), 0o755)

  const first = await start('first').exited
  const firstListing = listing()
  check('a build installs the output of both targets', () => {
    assert.equal(first.code, 0, first.stderr)
    assert.equal(read('node/samathgen.js'), 'first\n')
    assert.equal(read('web/samathgen.js'), 'first\n')
    assert.equal(JSON.parse(read('node/package.json')).type, 'commonjs')
    assert.equal(JSON.parse(read('web/package.json')).type, 'module')
  })
  check('the files wasm-pack adds that the package does not need are removed', () => {
    for (const dir of ['node', 'web']) {
      for (const extra of ['.gitignore', 'LICENSE', 'README.md']) {
        assert.equal(existsSync(join(project, 'dist', dir, extra)), false, `${dir}/${extra}`)
      }
    }
  })

  const interrupted = start('second', true)
  await waitFor(() => interrupted.output().includes('building web'))
  process.kill(-interrupted.child.pid, 'SIGTERM')
  await interrupted.exited
  check('a build interrupted mid-way leaves the last dist as it was', () => {
    assert.deepEqual(listing(), firstListing)
  })

  const third = await start('third').exited
  check('the build after an interrupted one installs its output', () => {
    assert.equal(third.code, 0, third.stderr)
    assert.equal(read('node/samathgen.js'), 'third\n')
    assert.equal(read('web/samathgen.js'), 'third\n')
  })
  const thirdListing = listing()

  if (process.getuid?.() === 0) {
    console.log('  skip  a read-only dist, since root can write to it')
  } else {
    const node = join(project, 'dist', 'node')
    chmodSync(node, 0o555)
    let locked
    try {
      locked = await start('fourth').exited
    } finally {
      chmodSync(node, 0o755)
    }
    check('a dist that cannot be replaced is reported in one line', () => {
      assert.equal(locked.code, 1)
      assert.match(locked.stderr, /^build failed: EACCES/m)
      assert.doesNotMatch(locked.stderr, /^\s+at /m)
    })
    check('a dist that cannot be replaced is left as it was, every file of it', () => {
      assert.deepEqual(listing(), thirdListing)
    })
  }
} finally {
  rmSync(project, { recursive: true, force: true })
}

console.log(`\n${checks} passed, ${failures} failed`)
process.exitCode = failures === 0 ? 0 : 1
