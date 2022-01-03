import { genExpression } from './genFuncs/genExpression';
import { genNumber } from './genFuncs/genNumber';
import { Operators } from './types';

export const mathGen = (
  length: number,
  more?: {
    answer?: number
    brackets?: boolean
    quizMode?: boolean
  }
): {
  task: Array<number | Operators | string>,
  answer: number
} => {
  const answer = more?.answer ? more.answer : genNumber(10, 20);
  const expression: Array<number | Operators | string> = genExpression(answer, length);
  if (more?.brackets) {
    const evenInds = Array.from(Array(expression.length).keys()).filter(i => i % 2 == 0)
    let randInd = evenInds[genNumber(0, evenInds.length - 1)];
    const bracketsEx = (genExpression(
      expression[randInd] as number,
      genNumber(2, 3)
    ).join("") as string).replaceAll("--", "+").replaceAll("+-", "-").replaceAll("-+", "-");
    expression[randInd] = `(${bracketsEx})`;
  }
  return {
    "task": expression,
    "answer": answer
  }
}