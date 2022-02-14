import { posDivs } from "../genValidOperator/posDivs";
import { genNumber } from "./genNumber";

export const genMultiply = (n: number): [number, number] => {
  if (n === 0) return [0, 0];

  if (n > 0) {
    const divsOfN: number[] = posDivs(n);
    if (!divsOfN.length) return [0, 0];
    const randDiv: number = divsOfN[Math.floor(Math.random() * divsOfN.length)];
    return [randDiv, n / randDiv];
  }

  const divsOfMinusN: number[] = posDivs(-n);
  if (!divsOfMinusN.length) return [0, 0];
  const randDiv: number = divsOfMinusN[Math.floor(Math.random() * divsOfMinusN.length)] *
    ((genNumber(1, 2) === 1) ? 1 : -1);

  return [randDiv, n / randDiv];
};
