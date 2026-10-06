import { genNumber } from "./genNumber";
import { genValidOperator } from "../genValidOperator";
import { genPairExpression } from "./genPairExpression";
import { Operators } from "../types";

export const genExpression = (
  answer: number,
  length: number,
  leftOperator?: Operators,
  rightOperator?: Operators,
  onLeft?: boolean
): Array<number | Operators> => {
  const validOperators: Array<Operators> = genValidOperator(
    answer,
    onLeft,
    leftOperator,
    rightOperator
  );

  const pairExpression: [number, Operators, number] = genPairExpression(
    answer,
    validOperators
  );

  const returnExpression: Array<number | Operators> = [...pairExpression];

  if (length > 2) {
    const left: boolean =
      (pairExpression[1] === "/" ||
        pairExpression[1] === "-" ||
        rightOperator === "/"
        ? 0
        : genNumber(0, 1)) === 0;

    const oneMoreExpression = genExpression(
      pairExpression[left ? 0 : 2],
      --length,
      left ? leftOperator : pairExpression[1],
      left ? pairExpression[1] : rightOperator,
      left
    );

    return left
      ? [...oneMoreExpression, ...returnExpression.slice(1)]
      : [
        ...returnExpression.slice(0, returnExpression.length - 1),
        ...oneMoreExpression,
      ];
  }

  for (let i = 2; i < returnExpression.length; i += 2) {
    const operand = returnExpression[i];
    // Narrowing the operand first: the array holds operators too, and
    // comparing or negating that union is not sound.
    if (typeof operand === "number" && operand < 0) {
      // These used to be two sequential ifs, which undid each other - "+"
      // became "-" and was then turned straight back into "+", while the
      // operand had already been negated. "a + -5" came out as "a + 5".
      if (returnExpression[i - 1] === "+") returnExpression[i - 1] = "-";
      else if (returnExpression[i - 1] === "-") returnExpression[i - 1] = "+";
      returnExpression[i] = -operand;
    }
  }
  return returnExpression;
};
