export const erathosthenes = (max: number): Array<number> => {
  let flags: Array<boolean> = [],
    primes: Array<number> = [],
    prime: number = 2,
    copyOfMax: number = max;

  while (copyOfMax--) flags[max - copyOfMax] = true;
  for (prime = 2; prime < Math.sqrt(max); prime++)
    if (flags[prime])
      for (let j = 2 * prime; j < max; j += prime) flags[j] = false;
  for (let i = 2; i < max; i++) if (flags[i]) primes.push(i);

  return primes;
};
