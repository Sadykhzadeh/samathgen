import { genNumber } from "./genNumber";

export const genPlus = (x: number): [number, number] => {
  if (x === 0) {
    const forZero: number = genNumber(3, 15);
    return [-forZero, forZero];
  }
  const genNum: number = genNumber(-2 * x, 2 * x);
  if (!genNum || genNum == x)
    return [Math.min(0, x), Math.max(0, x)];
  if (x > 0) {
    if (genNum > 0) {
      if (genNum < x) {
        return [Math.min(genNum, x - genNum), Math.max(genNum, x - genNum)];
      } else return [-Math.abs(x - genNum), genNum];
    } else return [genNum, x - genNum];
  } else return [x - Math.abs(genNum), Math.abs(genNum)];
};
