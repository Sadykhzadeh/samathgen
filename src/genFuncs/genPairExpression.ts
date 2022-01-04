import { genOperator } from "./genOperator";
import { genPairNums } from "./genPairNumbers";

export const genPairExpression = (
  n: number,
  validOpers: Array<"+" | "-" | "*" | "/">
): [number, "+" | "-" | "*" | "/", number] => {
  const operator: "+" | "-" | "*" | "/" = genOperator(validOpers);
  const numbers: [number, number] = genPairNums(n, operator);
  return [numbers[0], operator, numbers[1]];
};
