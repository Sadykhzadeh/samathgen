import { sieveSet } from './sieveSet';

let sieve: { [index: number]: number } = {}, upperBound = 0;

function updateSieve(max: number): void {
  sieve = sieveSet(max);
  upperBound = max;
}

export function isPrime(x: number): boolean {
  if (x > upperBound)
    updateSieve(x);
  return !!sieve[x];
};