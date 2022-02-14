import { genNumber } from './genFuncs/genNumber';
import { mathGen } from "./samathgen";

for (let i = 1; i <= 20; i++) {
  describe(`Generate task #${i}`, () => {
    const result = mathGen(genNumber(2, 5), { quizMode: true });
    console.log(i, result);
    it(`Test if eval of task is equal to answer`, () => {
      expect(eval(result.task.join(""))).toBe(result.answer);
    });
    it(`Check if options of quiz include the correct answer`, () => {
      expect(result.quizOptions.includes(result.answer)).toBeTruthy();
    });
  });
}