// Throughput of the built package, the way a caller sees it.
//
//   npm run build && npm run bench
//
// Each figure is the best of nine runs over the same number of tasks, with
// lengths cycling through 2..8 and quiz options on, which is what SaMathAPI
// asks for. The best run rather than the median, because on a busy machine
// the slow runs measure the other processes.

import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const started = performance.now()
const { mathGen, mathGenBatch } = require('../js/node.cjs')
const loadMs = performance.now() - started

const TASKS = 100_000
const RUNS = 9
let sink = 0

const measure = (label, run) => {
  const times = []
  for (let r = 0; r < RUNS; r++) {
    const start = performance.now()
    run()
    times.push(performance.now() - start)
  }
  const best = Math.min(...times)
  const perSecond = Math.round((TASKS / best) * 1000).toLocaleString('en-US')
  const micros = ((best * 1000) / TASKS).toFixed(2)
  console.log(`${label.padEnd(34)} ${perSecond.padStart(11)} tasks/s  ${micros.padStart(6)} us/task`)
}

console.log(`node ${process.version}, ${TASKS.toLocaleString('en-US')} tasks per run`)
console.log(`require('samathgen')                ${loadMs.toFixed(1)} ms`)

measure('mathGen', () => {
  for (let i = 0; i < TASKS; i++) sink += mathGen(2 + (i % 7), { quizMode: true }).answer
})

measure('mathGen, brackets', () => {
  for (let i = 0; i < TASKS; i++) sink += mathGen(2 + (i % 7), { quizMode: true, brackets: true }).answer
})

// A batch has one length for all of its tasks, so each length gets its own
// share of calls, which keeps the mix of lengths the same as above.
for (const size of [10, 100, 1000]) {
  measure(`mathGenBatch, ${size} per call`, () => {
    for (let i = 0; i < TASKS / size; i++) {
      for (const task of mathGenBatch(size, 2 + (i % 7), { quizMode: true })) sink += task.answer
    }
  })
}

if (sink === 0.5) console.log(sink)
