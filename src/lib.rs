//! samathgen - generates math expressions for education purposes.
//!
//! The core is plain Rust and is tested natively with `cargo test`. The one
//! wasm-bindgen export hands a JSON string to the JavaScript wrapper, which
//! keeps the published API exactly what it was: `mathGen(length, more?)`.
//!
//! Numbers cross the boundary as f64 rather than i64 on purpose: i64 becomes
//! BigInt in JavaScript, and every value here is a small integer that f64
//! represents exactly.

mod expr;
mod options;
mod rng;

use expr::{Config, Token};
use rng::Rng;
use wasm_bindgen::prelude::wasm_bindgen;

/// Default answer range, as in every version before this one.
const DEFAULT_ANSWER_LOW: i64 = 10;
const DEFAULT_ANSWER_HIGH: i64 = 20;

fn escape_json(value: &str) -> String {
    // The only symbols produced are + - * / ( ), none of which need escaping,
    // but a serializer that assumes its own input is not a serializer.
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn to_json(tokens: &[Token], answer: i64, quiz: &[i64]) -> String {
    let task = tokens
        .iter()
        .map(|token| match token {
            Token::Num(n) => n.to_string(),
            Token::Sym(s) => format!("\"{}\"", escape_json(s)),
        })
        .collect::<Vec<_>>()
        .join(",");

    let quiz_options = quiz
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");

    format!("{{\"task\":[{task}],\"answer\":{answer},\"quizOptions\":[{quiz_options}]}}")
}

/// Produces `{"task":[...],"answer":n,"quizOptions":[...]}`.
///
/// `seed` makes a run reproducible. The JavaScript wrapper draws one when the
/// caller does not supply it.
#[wasm_bindgen]
pub fn generate_json(
    length: u32,
    answer: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    seed: f64,
) -> String {
    let mut rng = Rng::new(seed.abs() as u64);

    let answer = if use_answer {
        // `more.answer ? more.answer : random` discarded an explicit 0; this
        // takes the caller at their word.
        answer.round() as i64
    } else {
        rng.range(DEFAULT_ANSWER_LOW, DEFAULT_ANSWER_HIGH)
    };

    let expression = expr::generate(
        &Config {
            answer,
            length: length as usize,
            brackets,
        },
        &mut rng,
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

    to_json(&expression.tokens(), answer, &quiz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_shape_is_what_the_wrapper_expects() {
        let json = generate_json(3, 12.0, true, false, true, 1234.0);
        assert!(json.starts_with("{\"task\":["), "{json}");
        assert!(json.contains("\"answer\":12"), "{json}");
        assert!(json.contains("\"quizOptions\":["), "{json}");
    }

    #[test]
    fn quiz_mode_off_gives_an_empty_option_list() {
        let json = generate_json(3, 12.0, true, false, false, 1.0);
        assert!(json.contains("\"quizOptions\":[]"), "{json}");
    }

    #[test]
    fn an_explicit_answer_of_zero_survives_the_boundary() {
        let json = generate_json(3, 0.0, true, false, false, 7.0);
        assert!(json.contains("\"answer\":0"), "{json}");
    }

    #[test]
    fn without_an_answer_one_is_drawn_from_the_documented_range() {
        for seed in 1..500 {
            let json = generate_json(2, 0.0, false, false, false, seed as f64);
            let answer: i64 = json
                .split("\"answer\":")
                .nth(1)
                .unwrap()
                .split(',')
                .next()
                .unwrap()
                .parse()
                .unwrap();
            assert!(
                (DEFAULT_ANSWER_LOW..=DEFAULT_ANSWER_HIGH).contains(&answer),
                "drew {answer}"
            );
        }
    }

    #[test]
    fn operators_are_quoted_and_numbers_are_not() {
        let json = generate_json(2, 6.0, true, false, false, 3.0);
        // "6" must never appear quoted, while an operator always is.
        assert!(!json.contains("\"6\""), "{json}");
        let has_quoted_operator = ["\"+\"", "\"-\"", "\"*\"", "\"/\""]
            .iter()
            .any(|op| json.contains(op));
        assert!(has_quoted_operator, "{json}");
    }
}
