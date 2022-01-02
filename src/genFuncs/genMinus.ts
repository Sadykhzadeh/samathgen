import { genNumber } from './genNumber';

export const genMinus = (x: number): [number, number] => {
  if (x === 0) return [0, 0];

  if (x > 0) {
    const tempRand: number = genNumber(1, Math.floor(Math.sqrt(x)));
    if (tempRand - (tempRand + x) === x)
      return [
        tempRand,
        (tempRand + x)
      ];
    return [
      (tempRand + x),
      tempRand
    ];
  }

  const tempRand: number = genNumber(x, -x);
  if (tempRand - (tempRand + x) === x)
    return [
      tempRand,
      (tempRand + x)
    ];
  return [
    (tempRand + x),
    tempRand
  ];
};