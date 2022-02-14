import { genMinus } from "./genMinus";
import { genPlus } from "./genPlus";
import { genMultiply } from "./genMultiply";
import { genDivisor } from "./genDivisor";
import { Operators } from '../types';

export const genPairNums = (
  n: number,
  operator: Operators
): [number, number] => {
  return operator === "+"
    ? genPlus(n)
    : operator === "-"
      ? genMinus(n)
      : operator === "/"
        ? genDivisor(n)
        : genMultiply(n);
};