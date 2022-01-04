import { genNumber } from "./genNumber";

const putToCache = (item: number, cache: Array<number>): Array<number> | "" =>
  cache.indexOf(item) != -1
    ? ""
    : cache.splice(genNumber(0, cache.length), 0, item);

const shufflingMadness = () => {
  const cache: Array<number> = [];
  return (a: number, b: number): number => {
    putToCache(a, cache);
    putToCache(b, cache);
    return cache.indexOf(b) - cache.indexOf(a);
  };
};

export const genOptions = (first: number): Array<number> => {
  const second: number = first + genNumber(2, 3);
  const third: number = first - genNumber(2, 3);
  let fourth: number = first + genNumber(-3, 3);
  while ([first, second, third].includes(fourth))
    fourth = first + genNumber(-3, 3);
  return [first, second, third, fourth].sort(shufflingMadness());
};
