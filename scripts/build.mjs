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
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const targets = [
  { target: 'nodejs', dir: 'dist/node', type: 'commonjs' },
  { target: 'web', dir: 'dist/web', type: 'module' },
]

rmSync('dist', { recursive: true, force: true })

// The package's own Node entry point rather than the .bin shim: since Node 20
// closed CVE-2024-27980, spawning a .cmd without a shell fails with EINVAL,
// and going through a shell to reach a shim is worse than skipping both.
const wasmPack = join('node_modules', 'wasm-pack', 'run.js')

for (const { target, dir, type } of targets) {
  console.log(`building ${target} -> ${dir}`)
  execFileSync(
    process.execPath,
    [wasmPack, 'build', '--release', '--target', target, '--out-dir', dir, '--out-name', 'samathgen'],
    { stdio: 'inherit' }
  )

  for (const unwanted of ['.gitignore', 'LICENSE', 'README.md']) {
    rmSync(join(dir, unwanted), { force: true })
  }

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ type }, null, 2)}\n`
  )
}

console.log('done')
