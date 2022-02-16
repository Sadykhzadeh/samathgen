import { genNumber } from '../../src/genFuncs/genNumber';
import { genPlus } from '../../src/genFuncs/genPlus';
import { genMinus } from '../../src/genFuncs/genMinus';
import { genMultiply } from '../../src/genFuncs/genMultiply';
import { genDivisor } from '../../src/genFuncs/genDivisor';

for (let i = 1; i <= 20; i++) {
  const number = genNumber(-1000, 1000);
  it(`should give correct range #${i}`, () => {
    expect(-1000 <= number && number <= 1000).toBeTruthy();
  });
}


for (let i = 1; i <= 30; i++) {
  const number = genNumber(0, 100);

  describe(`${i} Testing basic generations (+-*/) [number=${number}]`, () => {
    const plus = genPlus(number),
      minus = genMinus(number),
      multiply = genMultiply(number),
      divisor = genDivisor(number);

    const plusResult = eval(plus.join('+')),
      minusResult = eval(minus.join('-')),
      multiplyResult = eval(multiply.join('*')),
      divisorResult = eval(divisor.join('/'));

    console.table([{ "expression": plus, "result": plusResult },
    { "expression": minus, "result": minusResult },
    { "expression": multiply, "result": multiplyResult },
    { "expression": divisor, "result": divisorResult }]);

    it('Test plus (+) generation', () => { expect(plusResult).toBeCloseTo(number); })
    it('Test minus (-) generation', () => { expect(minusResult).toBeCloseTo(number); })
    it('Test multiply (*) generation', () => { expect(multiplyResult).toBeCloseTo(number); })
    it('Test divisor (/) generation', () => { expect(divisorResult).toBeCloseTo(number); })
  });
}