import { isPrime } from "./isPrime";

export const posDivs = (n: number): number[] => {
  const bigDivs: number[] = [],
    smallDivs: number[] = [];
  for (let i: number = 1, sqrt: number = Math.sqrt(n); i < sqrt + 1; i++) {
    if (i === smallDivs[smallDivs.length - 1]) break;
    if (n % i === 0 && (n === 1 || isPrime(n) || i !== 1)) {
      bigDivs.push(i);
      if (n / i !== i && (n === 1 || isPrime(n) || n !== i))
        smallDivs.push(n / i);
    }
  }
  return [...bigDivs, ...smallDivs];
};
