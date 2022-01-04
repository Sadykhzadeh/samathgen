import { erathosthenes } from "./eratosthenes";

export const sieveSet = (max: number): { [index: number]: number } => {
  return erathosthenes(max + 1).reduce(
    (elem: { [index: number]: number }, value) => {
      elem[value] = 1;
      return elem;
    },
    {}
  );
};