import { genMinus } from "./genMinus";
import { genPlus } from "./genPlus";
import { genMultiply } from "./genMultiply";
import { genDivisor } from "./genDivisor";

export const genPairNums = (
  n: number,
  operator: "+" | "-" | "*" | "/"
): [number, number] => {
  return operator === "+"
    ? genPlus(n)
    : operator === "-"
      ? genMinus(n)
      : operator === "/"
        ? genDivisor(n)
        : genMultiply(n);
};