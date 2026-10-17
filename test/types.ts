// Type-checked, never run: `tsc --noEmit --strict --module nodenext test/types.ts`.
// What the declarations accept is what the library accepts, and what they turn
// away is what it throws for, so a typo is caught before the program runs.
// Every `@ts-expect-error` has to mark a line that really is an error, or tsc
// says so.

import { init, mathGen, mathGenBatch } from '../js/node.cjs'
import type { MathGenOptions, MathGenResult, Operators } from '../js/node.cjs'

// Everything there is to ask for.
const everything: MathGenOptions = {
  answer: 12,
  brackets: 'never',
  quizMode: true,
  operators: ['+', '-', '*', '/'],
  negatives: false,
  max: 20,
  seed: 2024,
}
const task: MathGenResult = mathGen(4, everything)

// An answer is a number or a range, which may be a constant tuple.
mathGen(3, { answer: [50, 100] })
const range = [50, 100] as const
mathGen(3, { answer: range })

// A task is made of numbers, operators and brackets.
const pieces: Array<number | Operators | '(' | ')'> = task.task
const answer: number = task.answer
const options: number[] = task.quizOptions

// A batch is an array of results, and takes `distinct` besides.
const batch: MathGenResult[] = mathGenBatch(20, 2, { operators: ['*'], distinct: true })
batch.map((each) => each.task.join(''))

// init() is there under Node as well, and resolves.
init().then(() => mathGen(2))

// @ts-expect-error a misspelt option is an error, as it is at run time
mathGen(4, { negative: false })
// @ts-expect-error a flag is true or false, not the string a query string gives
mathGen(4, { negatives: 'false' })
// @ts-expect-error brackets is true, false or 'never'
mathGen(4, { brackets: 'always' })
// @ts-expect-error there are four operators
mathGen(4, { operators: ['+', 'x'] })
// @ts-expect-error a range has two ends
mathGen(4, { answer: [10] })
// @ts-expect-error the length is a number
mathGen('4')
// @ts-expect-error a count is a number
mathGenBatch('20', 4)
// @ts-expect-error distinct belongs to a batch
const single: MathGenOptions = { distinct: true }

export { pieces, answer, options, single }
