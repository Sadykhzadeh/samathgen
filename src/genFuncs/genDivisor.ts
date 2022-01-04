import { genNumber } from "./genNumber";

export const genDivisor = (n: number): [number, number] => {
  if (n === 0) return [0, 0];

  if (n > 0) {
    const first: number = genNumber(2, Math.floor(Math.sqrt(n))),
      second: number = n * first;
    return first / second === n ? [first, second] : [second, first];
  }

  const maxNum: number = Math.floor(Math.sqrt(-n)),
    first: number = genNumber(2, maxNum) * (genNumber(1, 2) === 1 ? -1 : 1),
    second: number = n * first;
  return first / second === n ? [first, second] : [second, first];
};
