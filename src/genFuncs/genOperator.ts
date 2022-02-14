import { Operators } from "../types";
import { genNumber } from "./genNumber";

export const genOperator = (validOperators?: Array<Operators>): Operators => {
  let operators: Array<Operators> = ["+", "-", "*", "/"];
  return (validOperators && validOperators.length)
    ? validOperators[genNumber(0, validOperators.length - 1)]
    : operators[genNumber(0, operators.length - 1)];
};