import { genNumber } from "./genNumber";

export const genMinus = (x: number): [number, number] => {
  if (x === 0) return [0, 0];
  let tempRand: number = (x > 0) ? genNumber(1, Math.floor(Math.sqrt(x))) : genNumber(x, -x);
  if (tempRand - (tempRand + x) === x) return [tempRand, tempRand + x];
  return [tempRand + x, tempRand];
};
