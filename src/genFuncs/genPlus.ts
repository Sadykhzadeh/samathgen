import { genNumber } from "./genNumber";

export const genPlus = (x: number): [number, number] => {
  if (x === 0) { const forZero: number = genNumber(0, 15); return [-forZero, forZero]; }
  const genNum: number = genNumber(-2 * x, 2 * x);
  if (!genNum || genNum == x) return [0, x].sort((a, b) => a - b) as [number, number];
  if (x > 0) {
    if (genNum > 0) {
      if (genNum < x) {
        return [genNum, x - genNum].sort(() => Math.random() - .5) as [number, number];
      } else return [-Math.abs(x - genNum), genNum];
    } else return [genNum, x - genNum];
  } else return [x - Math.abs(genNum), Math.abs(genNum)];
};