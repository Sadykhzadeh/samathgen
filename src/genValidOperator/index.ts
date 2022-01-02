import { isPrime } from './isPrime';

export const genValidOperator = (
  n: number,
  onLeft?: boolean,
  left?: '+' | '-' | '*' | '/',
  right?: '+' | '-' | '*' | '/'
): Array<'+' | '-' | '*' | '/'> => {
  const validOpers: Array<'+' | '-' | '*' | '/'> = [];
  if (n !== 1 &&
    n !== -1 &&
    ((!left && !right) ||
      (left !== '/' && (onLeft && !right)) ||
      (!left && !right))) validOpers.push("/");
  if (n !== 1 &&
    n !== -1 &&
    (left !== '/' &&
      (!!left ||
        !!right ||
        (!isPrime(n) && n !== 1 && n !== -1)))) validOpers.push('*');
  if (n !== 1 &&
    n !== -1 &&
    ((!left && !right) ||
      (left !== '/' &&
        left !== '-' &&
        left !== '*' &&
        right !== '/' &&
        right !== '*'))) validOpers.push("+");
  if ((!left && !right) ||
    (left !== '/' &&
      left !== '*' &&
      right !== '/' &&
      right !== '*' &&
      left !== '-')) validOpers.push('-');
  return validOpers;
};