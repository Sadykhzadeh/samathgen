import { Operators } from '../types';
import { genOperator } from "./genOperator";
import { genPairNums } from "./genPairNumbers";

export const genPairExpression = (
  n: number,
  validOpers: Array<Operators>
): [number, Operators, number] => {
  const operator: Operators = genOperator(validOpers);
  const numbers: [number, number] = genPairNums(n, operator);
  return [numbers[0], operator, numbers[1]];
};
