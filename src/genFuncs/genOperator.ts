import { genNumber } from './genNumber';

export const genOperator = (validOperators?: Array<"+" | "-" | "*" | "/">): "+" | "-" | "*" | "/" => {
  if (validOperators && validOperators.length)
    return validOperators[genNumber(0, validOperators.length - 1)];
  else {
    let operators: Array<"+" | "-" | "*" | "/"> = [
      "+", "-", "*", "/"
    ];
    return operators[genNumber(0, operators.length - 1)];
  }
};