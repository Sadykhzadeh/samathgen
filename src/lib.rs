//! samathgen - generates math expressions for education purposes.
//!
//! The core is plain Rust and is tested natively with `cargo test`. The one
//! wasm-bindgen export hands a flat array of integers to the JavaScript
//! wrapper, which turns it back into the published API exactly as it was:
//! `mathGen(length, more?)` returning `{ task, answer, quizOptions }`.
//!
//! Integers rather than a JSON string, because the generation itself is the
//! cheap part of a call. Formatting the result, decoding the string on the
//! other side and handing it to JSON.parse cost more than building the task.
//! Every number in a task is within `expr::MAX_ABS`, so it fits an i32 and
//! the symbols can travel as codes no number reaches.

mod expr;
mod options;
mod rng;

use expr::{Config, Token};
use rng::Rng;
use wasm_bindgen::prelude::wasm_bindgen;

/// Default answer range, as in every version before this one.
const DEFAULT_ANSWER_LOW: i64 = 10;
const DEFAULT_ANSWER_HIGH: i64 = 20;

/// `+ - * / ( )` travel as `SYMBOL_BASE + 0..=5`, in that order.
pub const SYMBOL_BASE: i32 = 1 << 24;

fn code(token: Token) -> i32 {
    match token {
        // Within ±MAX_ABS by construction, so the cast is exact.
        Token::Num(n) => n as i32,
        Token::Op(op) => SYMBOL_BASE + op as i32,
        Token::Open => SYMBOL_BASE + 4,
        Token::Close => SYMBOL_BASE + 5,
    }
}

/// Produces `[answer, option count, options..., token count, tokens...]`.
///
/// `seed` makes a run reproducible. The JavaScript wrapper draws one when the
/// caller does not supply it.
#[wasm_bindgen]
pub fn generate(
    length: u32,
    answer: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    seed: f64,
) -> Vec<i32> {
    let mut rng = Rng::new(seed.abs() as u64);

    let answer = if use_answer {
        // `more.answer ? more.answer : random` discarded an explicit 0; this
        // takes the caller at their word. The wrappers have already turned
        // away anything past MAX_ABS, where no split fits and an f64 past
        // i64 would saturate and then wrap.
        let answer = answer.round() as i64;
        assert!(answer.abs() <= expr::MAX_ABS, "answer out of range");
        answer
    } else {
        rng.range(DEFAULT_ANSWER_LOW, DEFAULT_ANSWER_HIGH)
    };

    let mut tokens = Vec::with_capacity(96);
    let expression = expr::generate(
        &Config {
            answer,
            length: length as usize,
            brackets,
        },
        &mut rng,
        &mut tokens,
    );

    // The tree is built so that this holds whatever shape it takes, and the
    // brackets are placed by precedence, so the two halves cannot disagree.
    // Walking at most 32 leaves to say so out loud is cheap, and it means a
    // later change cannot quietly bring back the bug this rewrite removed.
    assert_eq!(
        expression.value(),
        answer,
        "generated task does not evaluate to its answer"
    );

    let quiz = if quiz_mode {
        options::quiz_options(answer, &mut rng)
    } else {
        Vec::new()
    };

    let mut out = Vec::with_capacity(3 + quiz.len() + tokens.len());
    out.push(answer as i32);
    out.push(quiz.len() as i32);
    out.extend(quiz.iter().map(|&option| option as i32));
    out.push(tokens.len() as i32);
    out.extend(tokens.iter().map(|&token| code(token)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Decoded {
        answer: i32,
        quiz: Vec<i32>,
        task: String,
    }

    fn decode(data: &[i32]) -> Decoded {
        let quiz_len = data[1] as usize;
        let quiz = data[2..2 + quiz_len].to_vec();
        let tokens_at = 2 + quiz_len;
        let token_len = data[tokens_at] as usize;
        let tokens = &data[tokens_at + 1..];
        assert_eq!(tokens.len(), token_len, "trailing data in {data:?}");
        let task = tokens
            .iter()
            .map(|&t| {
                if t >= SYMBOL_BASE {
                    ["+", "-", "*", "/", "(", ")"][(t - SYMBOL_BASE) as usize].to_string()
                } else {
                    t.to_string()
                }
            })
            .collect();
        Decoded {
            answer: data[0],
            quiz,
            task,
        }
    }

    #[test]
    fn the_layout_is_what_the_wrapper_expects() {
        let data = generate(3, 12.0, true, false, true, 1234.0);
        let decoded = decode(&data);
        assert_eq!(decoded.answer, 12);
        assert_eq!(decoded.quiz.len(), 4);
        assert!(decoded.quiz.contains(&12), "{:?}", decoded.quiz);
        assert!(!decoded.task.is_empty());
    }

    #[test]
    fn quiz_mode_off_gives_an_empty_option_list() {
        let data = generate(3, 12.0, true, false, false, 1.0);
        assert!(decode(&data).quiz.is_empty());
    }

    #[test]
    fn an_explicit_answer_of_zero_survives_the_boundary() {
        let data = generate(3, 0.0, true, false, false, 7.0);
        assert_eq!(decode(&data).answer, 0);
    }

    #[test]
    fn without_an_answer_one_is_drawn_from_the_documented_range() {
        for seed in 1..500 {
            let answer = decode(&generate(2, 0.0, false, false, false, seed as f64)).answer;
            assert!(
                (DEFAULT_ANSWER_LOW..=DEFAULT_ANSWER_HIGH).contains(&(answer as i64)),
                "drew {answer}"
            );
        }
    }

    #[test]
    fn no_number_can_be_mistaken_for_a_symbol() {
        assert!(expr::MAX_ABS < SYMBOL_BASE as i64);
        assert_eq!(code(Token::Num(expr::MAX_ABS)), 10_000);
        assert_eq!(code(Token::Num(-expr::MAX_ABS)), -10_000);
        assert_eq!(code(Token::Op(expr::Op::Div)), SYMBOL_BASE + 3);
    }

    #[test]
    fn operators_and_numbers_both_come_through() {
        let task = decode(&generate(2, 6.0, true, false, false, 3.0)).task;
        assert!(task.chars().any(|c| "+-*/".contains(c)), "{task}");
        assert!(task.chars().any(|c| c.is_ascii_digit()), "{task}");
    }
}
