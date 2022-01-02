import { genExpression } from './genFuncs/genExpression';
import { genNumber } from './genFuncs/genNumber';

export const mathGen = (
  length: number,
  more?: {
    answer?: number
    brackets?: boolean
    quizMode?: boolean // To-do
  }
): {
  task: Array<number | '+' | '-' | '*' | '/' | string>,
  answer: number
} => {
  const answer = more?.answer ? more.answer : genNumber(10, 20);
  const expression: Array<number | '+' | '-' | '*' | '/' | string> = genExpression(answer, length);
  return {
    "task": expression,
    "answer": answer
  }
}