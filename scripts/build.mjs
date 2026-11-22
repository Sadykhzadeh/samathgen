// Builds both wasm targets and tidies up after wasm-pack.
//
// Two things need doing that wasm-pack will not do itself:
//
//   * It writes a .gitignore containing "*" into each output directory. npm
//     honours nested .gitignore files, so with those in place `npm pack`
//     shipped a tarball with no WebAssembly in it at all, despite `files`
//     listing dist.
//   * It copies the 36 kB LICENSE and the README into every output directory,
//     where they are already carried at the package root.
//
// The package.json in each directory is replaced with the one thing it is
// actually needed for: telling Node whether the .js beside it is CommonJS or
// an ES module. Leaving that to wasm-pack's generator would make the module
// type depend on a tool's unrelated choices.

import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, lstatSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const targets = [
  { target: 'nodejs', dir: 'dist/node', type: 'commonjs' },
  { target: 'web', dir: 'dist/web', type: 'module' },
]

// The package's own Node entry point rather than the .bin shim: since Node 20
// closed CVE-2024-27980, spawning a .cmd without a shell fails with EINVAL,
// and going through a shell to reach a shim is worse than skipping both.
const wasmPack = join('node_modules', 'wasm-pack', 'run.js')
if (!existsSync(wasmPack)) {
  console.error(`${wasmPack} is missing: run npm ci first, which installs wasm-pack`)
  process.exit(1)
}

try {
  execFileSync('cargo', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('cargo was not found: install Rust from https://rustup.rs, then run rustup target add wasm32-unknown-unknown')
  process.exit(1)
}

// The build goes into a directory beside dist first, and replaces dist only once
// every target has built, so an interrupted or failed build leaves the last good
// dist where it was. The old dist is moved aside rather than deleted, so that it
// can be put back if the new one cannot be moved in. A rename cannot cross a
// disk, and node_modules is often a volume or a link to another disk, so the
// staging directory is not inside it.
const staging = '.samathgen-build'
const previous = join(staging, 'previous')

// Deleting a directory needs write permission on each directory in it, so this
// finds a read-only one before anything is moved, rather than halfway through
// deleting the old dist.
const replaceable = (path) => {
  if (!lstatSync(path).isDirectory()) return
  accessSync(path, constants.W_OK)
  for (const name of readdirSync(path)) replaceable(join(path, name))
}

try {
  rmSync(staging, { recursive: true, force: true })
  if (existsSync('dist')) replaceable('dist')

  for (const { target, dir, type } of targets) {
    console.log(`building ${target} -> ${dir}`)
    execFileSync(
      process.execPath,
      [wasmPack, 'build', '--release', '--target', target, '--out-dir', join(staging, dir), '--out-name', 'samathgen'],
      { stdio: 'inherit' }
    )

    for (const unwanted of ['.gitignore', 'LICENSE', 'README.md']) {
      rmSync(join(staging, dir, unwanted), { force: true })
    }

    writeFileSync(
      join(staging, dir, 'package.json'),
      `${JSON.stringify({ type }, null, 2)}\n`
    )
  }

  let moved = false
  if (existsSync('dist')) {
    renameSync('dist', previous)
    moved = true
  }
  try {
    renameSync(join(staging, 'dist'), 'dist')
  } catch (error) {
    if (moved) renameSync(previous, 'dist')
    throw error
  }
  rmSync(staging, { recursive: true, force: true })
} catch (error) {
  console.error(`build failed: ${error.message}`)
  rmSync(staging, { recursive: true, force: true })
  process.exit(1)
}

console.log('done')
