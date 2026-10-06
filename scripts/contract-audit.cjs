// mathGen's contract is that evaluating `task` gives back `answer`. It does
// not always hold: sub-expressions are spliced into the parent without
// parentheses, so operator precedence can change the value. This reports how
// often that happens, over far more samples than the spec's twenty.
//
//   npm run build && npm run audit:contract [samples]
//
// Fixing it needs genExpression/genValidOperator reworked to parenthesise by
// precedence, which changes the shape of every generated task - so the rate
// is measured here rather than papered over.
const { mathGen } = require('../dist/samathgen.js');

const samples = Number(process.argv[2] || 20000);
let evaluated = 0, wrong = 0, threw = 0;
const examples = [];

for (let i = 0; i < samples; i++) {
  let task, answer;
  try {
    const result = mathGen(2 + Math.floor(Math.random() * 4), { quizMode: true });
    task = result.task.join('');
    answer = result.answer;
    // eslint-disable-next-line no-eval
    const value = eval(task);
    evaluated++;
    if (value !== answer) {
      wrong++;
      if (examples.length < 5) examples.push(`${task} = ${value}, reported ${answer}`);
    }
  } catch {
    threw++;
  }
}

const rate = (wrong / evaluated * 100).toFixed(2);
console.log(`samples ${samples}, evaluated ${evaluated}, threw ${threw}`);
console.log(`task does not evaluate to the reported answer: ${wrong} (${rate}%)`);
examples.forEach((e) => console.log('  e.g. ' + e));
process.exitCode = 0;
