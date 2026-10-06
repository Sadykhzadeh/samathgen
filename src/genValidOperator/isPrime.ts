/* Trial division by 2, 3 and then the 6k +/- 1 candidates. This used to be
   backed by a sieve that allocated an array as large as its argument, so a
   single call with a big number could exhaust memory - and the sieve was
   rebuilt from scratch every time the argument grew. */
export const isPrime = (x: number): boolean => {
  if (!Number.isInteger(x) || x < 2) return false;
  if (x < 4) return true;
  if (x % 2 === 0 || x % 3 === 0) return false;
  for (let divisor = 5; divisor * divisor <= x; divisor += 6)
    if (x % divisor === 0 || x % (divisor + 2) === 0) return false;
  return true;
};
