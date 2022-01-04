import { Operators } from "../types";
import { genNumber } from "./genNumber";

export const genOperator = (validOperators?: Array<Operators>): Operators => {
  if (validOperators && validOperators.length)
    return validOperators[genNumber(0, validOperators.length - 1)];
  let operators: Array<Operators> = ["+", "-", "*", "/"];
  return operators[genNumber(0, operators.length - 1)];
};