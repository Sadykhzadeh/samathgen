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

use expr::{Config, Ops, Token};
use rng::Rng;
use wasm_bindgen::prelude::wasm_bindgen;

/// Default answer range, as in every version before this one.
const DEFAULT_ANSWER_LOW: i64 = 10;
const DEFAULT_ANSWER_HIGH: i64 = 20;

/// `+ - * / ( )` travel as `SYMBOL_BASE + 0..=5`, in that order.
pub const SYMBOL_BASE: i32 = 1 << 24;

/// In `allowed`, next to one bit per operator: no negative numbers.
const NO_NEGATIVES: u32 = 1 << 4;

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
/// caller does not supply it. `allowed` has bit `1 << n` set for each of
/// `+ - * /` the task may use, in that order, and `NO_NEGATIVES` to keep
/// every number in it at 0 or above.
///
/// An empty array means those rules cannot build a task of that length for
/// that answer; see `expr::generate`.
#[wasm_bindgen]
pub fn generate(
    length: u32,
    answer: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    allowed: u32,
    seed: f64,
) -> Vec<i32> {
    let mut out = Vec::with_capacity(64);
    let request = Request {
        length,
        answer,
        use_answer,
        brackets,
        quiz_mode,
        ops: Ops::from_bits(allowed & !NO_NEGATIVES).unwrap_or(Ops::ALL),
        negatives: allowed & NO_NEGATIVES == 0,
    };
    write_task(
        &mut out,
        &mut Vec::with_capacity(96),
        &request,
        seed.abs() as u64,
    );
    out
}

/// `count` tasks laid out one after another as `generate` lays out one, task
/// `i` drawn from `seed + i` - so it is exactly the task `generate` gives for
/// that seed, and a batch costs one crossing of the boundary instead of
/// `count`. Empty, like `generate`, if any task cannot be built.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn generate_batch(
    count: u32,
    length: u32,
    answer: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    allowed: u32,
    seed: f64,
) -> Vec<i32> {
    let mut out = Vec::with_capacity(count as usize * 24);
    let mut tokens = Vec::with_capacity(96);
    let request = Request {
        length,
        answer,
        use_answer,
        brackets,
        quiz_mode,
        ops: Ops::from_bits(allowed & !NO_NEGATIVES).unwrap_or(Ops::ALL),
        negatives: allowed & NO_NEGATIVES == 0,
    };
    let seed = seed.abs() as u64;
    for i in 0..count {
        if !write_task(&mut out, &mut tokens, &request, seed.wrapping_add(i as u64)) {
            return Vec::new();
        }
    }
    out
}

struct Request {
    length: u32,
    answer: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    ops: Ops,
    negatives: bool,
}

/// Appends one task to `out`, or returns false and appends nothing when the
/// operators cannot build it.
fn write_task(out: &mut Vec<i32>, tokens: &mut Vec<Token>, request: &Request, seed: u64) -> bool {
    let Request {
        length,
        answer,
        use_answer,
        brackets,
        quiz_mode,
        ops,
        negatives,
    } = *request;
    let mut rng = Rng::new(seed);

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

    let Some(expression) = expr::generate(
        &Config {
            answer,
            length: length as usize,
            brackets,
            ops,
            negatives,
        },
        &mut rng,
        tokens,
    ) else {
        return false;
    };

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
        options::quiz_options(answer, if negatives { i64::MIN } else { 0 }, &mut rng)
    } else {
        Vec::new()
    };

    out.push(answer as i32);
    out.push(quiz.len() as i32);
    out.extend(quiz.iter().map(|&option| option as i32));
    out.push(tokens.len() as i32);
    out.extend(tokens.iter().map(|&token| code(token)));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: u32 = 0b1111;

    #[derive(PartialEq, Debug)]
    struct Decoded {
        answer: i32,
        quiz: Vec<i32>,
        task: String,
    }

    fn decode(data: &[i32]) -> Decoded {
        let (decoded, used) = decode_at(data);
        assert_eq!(used, data.len(), "trailing data in {data:?}");
        decoded
    }

    /// One task from the front of `data`, and how many integers it took.
    fn decode_at(data: &[i32]) -> (Decoded, usize) {
        let quiz_len = data[1] as usize;
        let quiz = data[2..2 + quiz_len].to_vec();
        let tokens_at = 2 + quiz_len;
        let token_len = data[tokens_at] as usize;
        let tokens = &data[tokens_at + 1..tokens_at + 1 + token_len];
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
        let decoded = Decoded {
            answer: data[0],
            quiz,
            task,
        };
        (decoded, tokens_at + 1 + token_len)
    }

    #[test]
    fn a_batch_is_the_same_tasks_as_one_call_per_seed() {
        for (length, use_answer, brackets, quiz_mode) in [
            (2, false, false, true),
            (5, true, true, false),
            (9, false, true, true),
            (32, true, false, true),
        ] {
            let data = generate_batch(
                50, length, -7.0, use_answer, brackets, quiz_mode, ALL, 1000.0,
            );
            let mut at = 0;
            for i in 0..50 {
                let (task, used) = decode_at(&data[at..]);
                let single = generate(
                    length,
                    -7.0,
                    use_answer,
                    brackets,
                    quiz_mode,
                    ALL,
                    1000.0 + i as f64,
                );
                assert_eq!(task, decode(&single), "task {i} of the batch");
                at += used;
            }
            assert_eq!(at, data.len());
        }
    }

    #[test]
    fn an_empty_batch_is_empty() {
        assert!(generate_batch(0, 4, 0.0, false, false, true, ALL, 1.0).is_empty());
    }

    #[test]
    fn the_layout_is_what_the_wrapper_expects() {
        let data = generate(3, 12.0, true, false, true, ALL, 1234.0);
        let decoded = decode(&data);
        assert_eq!(decoded.answer, 12);
        assert_eq!(decoded.quiz.len(), 4);
        assert!(decoded.quiz.contains(&12), "{:?}", decoded.quiz);
        assert!(!decoded.task.is_empty());
    }

    #[test]
    fn quiz_mode_off_gives_an_empty_option_list() {
        let data = generate(3, 12.0, true, false, false, ALL, 1.0);
        assert!(decode(&data).quiz.is_empty());
    }

    #[test]
    fn an_explicit_answer_of_zero_survives_the_boundary() {
        let data = generate(3, 0.0, true, false, false, ALL, 7.0);
        assert_eq!(decode(&data).answer, 0);
    }

    #[test]
    fn without_an_answer_one_is_drawn_from_the_documented_range() {
        for seed in 1..500 {
            let answer = decode(&generate(2, 0.0, false, false, false, ALL, seed as f64)).answer;
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
        let task = decode(&generate(2, 6.0, true, false, false, ALL, 3.0)).task;
        assert!(task.chars().any(|c| "+-*/".contains(c)), "{task}");
        assert!(task.chars().any(|c| c.is_ascii_digit()), "{task}");
    }
}
