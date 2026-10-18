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

use expr::{Config, Op, Ops, Token};
use rng::Rng;
use std::cell::RefCell;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;

/// How many times a tree is grown again when a factor of 1 is not allowed.
/// Few: where it can be built without one it almost always is at the first
/// try, and where it cannot, as with `*` alone and an answer of 13, growing
/// it again is the same tree, and the answers that allow one are not waiting
/// for it.
const WITHOUT_UNITS_RESTARTS: usize = 1;

/// How many trees are grown, in all, by each of the two searches made once the
/// usual one has refused a request: one for tasks without a factor of 1 and
/// one with. Some chains, such as `/` alone within 10 without brackets, grow
/// into a corner in all but a few tries, so the usual 64 restarts refused a
/// buildable request for one seed in seven. Those seeds get this many more
/// growths, shared by the answers on offer, which at most about doubles the
/// time a refusal takes.
const FALLBACK_GROWTHS: usize = 1024;

/// How many answers of a range are tried before the request is refused: all
/// of a range this small, this many drawn from a bigger one.
const ANSWER_TRIES: usize = 64;

/// Default answer range. Under a max below 20 it is half the max up to the
/// max instead.
const DEFAULT_ANSWER_LOW: i64 = 10;
const DEFAULT_ANSWER_HIGH: i64 = 20;

/// `+ - * / ( )` travel as `SYMBOL_BASE + 0..=5`, in that order.
pub const SYMBOL_BASE: i32 = 1 << 24;

/// In `allowed`, next to one bit per operator: no negative numbers.
const NO_NEGATIVES: u32 = 1 << 4;
/// And no brackets that group anything.
const FLAT: u32 = 1 << 5;

fn code(token: Token) -> i32 {
    match token {
        // Within ±MAX_ABS by construction, so the cast is exact.
        Token::Num(n) => n as i32,
        Token::Op(op) => SYMBOL_BASE + op as i32,
        Token::Open => SYMBOL_BASE + 4,
        Token::Close => SYMBOL_BASE + 5,
    }
}

// Where a result is left for JavaScript to read in place. It is kept
// between calls, so a call neither allocates a vector for its result nor
// has the glue copy it out and free it again: for a single task, that was
// a quarter of the cost of the call.
thread_local! {
    static RESULT: RefCell<Vec<i32>> = const { RefCell::new(Vec::new()) };
}

/// A result bigger than this, a batch of thousands, is let go of at the
/// next call rather than kept.
const RESULT_KEEP: usize = 1 << 14;

/// Runs `fill` on the shared result vector, which starts with room for its
/// length, and returns where it begins in memory: the length of what
/// follows, then the integers. A length of 0 means `fill` could not build
/// what was asked.
fn publish(fill: impl FnOnce(&mut Vec<i32>) -> bool) -> *const i32 {
    RESULT.with(|result| {
        let mut out = result.borrow_mut();
        if out.capacity() > RESULT_KEEP {
            *out = Vec::new();
        }
        out.clear();
        out.push(0);
        if fill(&mut out) {
            out[0] = (out.len() - 1) as i32;
        } else {
            out.truncate(1);
        }
        out.as_ptr()
    })
}

/// The WebAssembly memory, for the glue to read results from.
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

/// Produces `[answer, option count, options..., token count, tokens...]`,
/// at the address returned, after a first integer saying how many follow.
/// Those are valid until the next call.
///
/// `seed` makes a run reproducible. The JavaScript wrapper draws one when the
/// caller does not supply it. `allowed` has bit `1 << n` set for each of
/// `+ - * /` the task may use, in that order, `NO_NEGATIVES` to keep
/// every number in it at 0 or above and `FLAT` to group nothing in brackets. `max` keeps every number in it, every
/// step of working it out and every option within that far of zero.
///
/// A count of 0 means those rules cannot build a task of that length for
/// that answer, or without `use_answer` for any answer it would draw; see
/// `expr::generate`.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn generate(
    length: u32,
    answer_low: f64,
    answer_high: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    allowed: u32,
    max: u32,
    seed: f64,
) -> *const i32 {
    publish(|out| {
        fill_task(
            out,
            length,
            answer_low,
            answer_high,
            use_answer,
            brackets,
            quiz_mode,
            allowed,
            max,
            seed,
        )
    })
}

/// `generate` for one task, appended to `out`.
#[allow(clippy::too_many_arguments)]
fn fill_task(
    out: &mut Vec<i32>,
    length: u32,
    answer_low: f64,
    answer_high: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    allowed: u32,
    max: u32,
    seed: f64,
) -> bool {
    let request = Request::new(
        length,
        (answer_low, answer_high),
        use_answer,
        brackets,
        quiz_mode,
        allowed,
        max,
    );
    write_task(
        out,
        &mut Vec::with_capacity(96),
        &request,
        seed.abs() as u64,
    )
}

/// `count` tasks laid out one after another as `generate` lays out one, task
/// `i` drawn from `seed + i` - so it is exactly the task `generate` gives for
/// that seed, and a batch costs one crossing of the boundary instead of
/// `count`. Empty, like `generate`, if any task cannot be built.
///
/// With `distinct`, a task that repeats one before it in the batch is drawn
/// again from the seeds after the batch's own, `seed + count` onwards, each
/// used once, and kept as it is after `DISTINCT_TRIES` repeats in a row.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn generate_batch(
    count: u32,
    length: u32,
    answer_low: f64,
    answer_high: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    allowed: u32,
    max: u32,
    seed: f64,
    distinct: bool,
) -> *const i32 {
    publish(|out| {
        fill_batch(
            out,
            count,
            length,
            answer_low,
            answer_high,
            use_answer,
            brackets,
            quiz_mode,
            allowed,
            max,
            seed,
            distinct,
        )
    })
}

/// `generate_batch`, appended to `out`.
#[allow(clippy::too_many_arguments)]
fn fill_batch(
    out: &mut Vec<i32>,
    count: u32,
    length: u32,
    answer_low: f64,
    answer_high: f64,
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    allowed: u32,
    max: u32,
    seed: f64,
    distinct: bool,
) -> bool {
    out.reserve(count as usize * 24);
    let mut tokens = Vec::with_capacity(96);
    let request = Request::new(
        length,
        (answer_low, answer_high),
        use_answer,
        brackets,
        quiz_mode,
        allowed,
        max,
    );
    let seed = seed.abs() as u64;
    let mut seen = Seen::new(if distinct { count as usize } else { 0 });
    let mut spare = seed.wrapping_add(count as u64);
    for i in 0..count {
        let start = out.len();
        if !write_task(out, &mut tokens, &request, seed.wrapping_add(i as u64)) {
            return false;
        }
        if !distinct {
            continue;
        }
        let mut tries = 0;
        while !seen.insert(&tokens) && tries < DISTINCT_TRIES {
            out.truncate(start);
            if !write_task(out, &mut tokens, &request, spare) {
                return false;
            }
            spare = spare.wrapping_add(1);
            tries += 1;
        }
    }
    true
}

/// How many tasks in a row a distinct batch draws in place of a repeat
/// before it keeps one. Two numbers of `*` make 58 tasks between them, and
/// while a draw is as likely to be new as not, sixteen repeats in a row
/// come once in 65 536.
const DISTINCT_TRIES: u32 = 16;

/// The tasks a batch holds so far, kept as 64-bit hashes of their tokens
/// in an open-addressed table. Two different tasks sharing a hash would
/// cost one task drawn again, and with at most 10 000 of them it is not
/// worth the memory of keeping the tokens to tell them apart.
struct Seen {
    slots: Vec<u64>,
}

impl Seen {
    fn new(count: usize) -> Seen {
        let size = if count == 0 {
            0
        } else {
            (count * 2).next_power_of_two()
        };
        Seen {
            slots: vec![0; size],
        }
    }

    /// False if `tokens` is already here. The table is twice the size of
    /// the batch and each task in it adds one hash at most, so it never
    /// fills.
    fn insert(&mut self, tokens: &[Token]) -> bool {
        // FNV-1a over the codes, with 0 kept to mark an empty slot.
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for &token in tokens {
            hash ^= code(token) as u32 as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        let hash = hash.max(1);
        let mask = self.slots.len() - 1;
        let mut at = (hash ^ (hash >> 32)) as usize & mask;
        loop {
            match self.slots[at] {
                0 => {
                    self.slots[at] = hash;
                    return true;
                }
                held if held == hash => return false,
                _ => at = (at + 1) & mask,
            }
        }
    }
}

struct Request {
    length: u32,
    /// The answers a task may have, the ends included, when `use_answer`.
    answers: (f64, f64),
    use_answer: bool,
    brackets: bool,
    quiz_mode: bool,
    ops: Ops,
    negatives: bool,
    max: i64,
    flat: bool,
}

impl Request {
    fn new(
        length: u32,
        answers: (f64, f64),
        use_answer: bool,
        brackets: bool,
        quiz_mode: bool,
        allowed: u32,
        max: u32,
    ) -> Request {
        Request {
            length,
            answers,
            use_answer,
            brackets,
            quiz_mode,
            ops: Ops::from_bits(allowed & !(NO_NEGATIVES | FLAT)).unwrap_or(Ops::ALL),
            negatives: allowed & NO_NEGATIVES == 0,
            max: max as i64,
            flat: allowed & FLAT != 0,
        }
    }
}

/// Grows a task for an answer from `low..=high`, and says which.
///
/// An answer the rules cannot build, such as 20 for `-` alone within 20
/// without negatives, is set aside and another drawn from those left, so
/// `None` comes only when none of them can be built. Each draw is uniform
/// over what is left, which makes the answer uniform over the ones that can
/// be, and the first takes the same number from the generator as
/// `rng.range(low, high)`.
///
/// A range of more than `ANSWER_TRIES` answers is not walked through: that
/// many are drawn from it, and `None` comes when none of them can be built,
/// which for a range where hardly any answer can is the better answer than a
/// wait.
///
/// An answer that runs short of room is grown again up to `restarts` times,
/// which for 32 terms of `-` without brackets or negatives takes a couple of
/// milliseconds before it gives up. Its neighbours mostly run short too, so
/// the ones drawn after it get an eighth of that, or a refusal would take
/// eleven times as long.
fn grow_for_some_answer(
    (low, high): (i64, i64),
    config: impl Fn(i64) -> Config,
    restarts: usize,
    rng: &mut Rng,
    tokens: &mut Vec<Token>,
) -> Option<(i64, expr::Expr)> {
    if low == high {
        return expr::generate_with(&config(low), rng, tokens, restarts).map(|e| (low, e));
    }
    let span = (high - low + 1) as u64;
    let walked = span <= ANSWER_TRIES as u64;
    let mut candidates = [0; ANSWER_TRIES];
    let mut left = if walked { span as usize } else { ANSWER_TRIES };
    if walked {
        for (slot, answer) in candidates[..left].iter_mut().zip(low..=high) {
            *slot = answer;
        }
    }
    let later = restarts / 8;
    let mut restarts = restarts;
    while left > 0 {
        let at = rng.below(if walked { left as u64 } else { span }) as usize;
        let answer = if walked {
            candidates[at]
        } else {
            low + at as i64
        };
        if let Some(expression) = expr::generate_with(&config(answer), rng, tokens, restarts) {
            return Some((answer, expression));
        }
        left -= 1;
        if walked {
            candidates.swap(at, left);
        }
        restarts = later;
    }
    None
}

/// Grows a task for an answer from `low..=high` as `grow_for_some_answer`
/// does, but with the growths in `growths` shared by the answers tried: once
/// they are spent the search stops, and nothing restarts on its own account.
fn grow_within(
    (low, high): (i64, i64),
    config: impl Fn(i64) -> Config,
    rng: &mut Rng,
    tokens: &mut Vec<Token>,
    growths: &mut usize,
) -> Option<(i64, expr::Expr)> {
    let span = (high - low + 1) as u64;
    let walked = span <= ANSWER_TRIES as u64;
    let mut candidates = [0; ANSWER_TRIES];
    let mut left = if walked { span as usize } else { ANSWER_TRIES };
    for (at, slot) in candidates[..left].iter_mut().enumerate() {
        *slot = if walked {
            low + at as i64
        } else {
            low + rng.below(span) as i64
        };
    }
    while left > 0 && *growths > 0 {
        let at = rng.below(left as u64) as usize;
        let answer = candidates[at];
        if let Some(expression) = expr::generate_within(&config(answer), rng, tokens, growths) {
            return Some((answer, expression));
        }
        left -= 1;
        candidates.swap(at, left);
    }
    None
}

/// Appends one task to `out`, or returns false and appends nothing when the
/// operators cannot build it.
fn write_task(out: &mut Vec<i32>, tokens: &mut Vec<Token>, request: &Request, seed: u64) -> bool {
    let Request {
        length,
        answers,
        use_answer,
        brackets,
        quiz_mode,
        ops,
        negatives,
        max,
        flat,
    } = *request;
    assert!(
        (expr::MAX_MIN..=expr::MAX_ABS).contains(&max),
        "max out of range"
    );
    let mut rng = Rng::new(seed);
    let config = |answer, units| Config {
        answer,
        length: length as usize,
        brackets,
        ops,
        negatives,
        max,
        flat,
        units,
    };

    let (low, high) = if use_answer {
        // The wrappers have already turned away anything past max, where no
        // split fits and an f64 past i64 would saturate and then wrap.
        let (low, high) = (answers.0.round() as i64, answers.1.round() as i64);
        assert!(
            low <= high && low.abs() <= max && high.abs() <= max,
            "answer out of range"
        );
        (low, high)
    } else if max >= DEFAULT_ANSWER_HIGH {
        (DEFAULT_ANSWER_LOW, DEFAULT_ANSWER_HIGH)
    } else {
        ((max + 1) / 2, max)
    };

    // A factor of 1 is the last resort: tasks without one are looked for
    // among every answer on offer first, and the others only when there are
    // none. Without `*` the question does not arise.
    let found = {
        let mut search = |rng: &mut Rng, first: usize, second: usize| {
            if ops.has(Op::Mul) {
                grow_for_some_answer(
                    (low, high),
                    |answer| config(answer, false),
                    first,
                    rng,
                    tokens,
                )
                .or_else(|| {
                    grow_for_some_answer(
                        (low, high),
                        |answer| config(answer, true),
                        second,
                        rng,
                        tokens,
                    )
                })
            } else {
                grow_for_some_answer(
                    (low, high),
                    |answer| config(answer, true),
                    second,
                    rng,
                    tokens,
                )
            }
        };
        search(&mut rng, WITHOUT_UNITS_RESTARTS, expr::RESTARTS)
    }
    // Only a request the usual search refuses is searched again, within a
    // budget of growths, so a seed that gave a task before gives the same
    // one now.
    .or_else(|| {
        let mut without_units = FALLBACK_GROWTHS;
        let mut with_units = FALLBACK_GROWTHS;
        if ops.has(Op::Mul) {
            grow_within(
                (low, high),
                |answer| config(answer, false),
                &mut rng,
                tokens,
                &mut without_units,
            )
            .or_else(|| {
                grow_within(
                    (low, high),
                    |answer| config(answer, true),
                    &mut rng,
                    tokens,
                    &mut with_units,
                )
            })
        } else {
            grow_within(
                (low, high),
                |answer| config(answer, true),
                &mut rng,
                tokens,
                &mut with_units,
            )
        }
    });
    let Some((answer, expression)) = found else {
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
        options::quiz_options(answer, if negatives { -max } else { 0 }, max, &mut rng)
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
    const MAX: u32 = expr::MAX_ABS as u32;

    // The tests read the integers of a result as a vector, empty when the
    // task cannot be built, which is how the exports used to hand them over.
    #[allow(clippy::too_many_arguments)]
    fn generate(
        length: u32,
        answer: f64,
        use_answer: bool,
        brackets: bool,
        quiz_mode: bool,
        allowed: u32,
        max: u32,
        seed: f64,
    ) -> Vec<i32> {
        let mut out = Vec::new();
        let built = fill_task(
            &mut out, length, answer, answer, use_answer, brackets, quiz_mode, allowed, max, seed,
        );
        if built {
            out
        } else {
            Vec::new()
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn generate_batch(
        count: u32,
        length: u32,
        answer: f64,
        use_answer: bool,
        brackets: bool,
        quiz_mode: bool,
        allowed: u32,
        max: u32,
        seed: f64,
        distinct: bool,
    ) -> Vec<i32> {
        let mut out = Vec::new();
        let built = fill_batch(
            &mut out, count, length, answer, answer, use_answer, brackets, quiz_mode, allowed, max,
            seed, distinct,
        );
        if built {
            out
        } else {
            Vec::new()
        }
    }

    /// What the exports leave in memory: the integers after the length that
    /// leads them.
    fn published(pointer: *const i32) -> Vec<i32> {
        // SAFETY: `publish` returns the start of the shared vector, whose
        // first integer is the count of those after it, and nothing touches
        // it until the next call.
        unsafe {
            let length = *pointer as usize;
            std::slice::from_raw_parts(pointer.add(1), length).to_vec()
        }
    }

    #[test]
    fn what_is_left_in_memory_is_what_the_vector_functions_give() {
        let task = published(super::generate(
            5, 12.0, 12.0, true, true, true, ALL, MAX, 77.0,
        ));
        assert_eq!(task, generate(5, 12.0, true, true, true, ALL, MAX, 77.0));

        let batch = published(super::generate_batch(
            30, 4, 0.0, 0.0, false, false, true, ALL, MAX, 5.0, true,
        ));
        assert_eq!(
            batch,
            generate_batch(30, 4, 0.0, false, false, true, ALL, MAX, 5.0, true)
        );
    }

    #[test]
    fn a_task_that_cannot_be_built_leaves_a_length_of_zero() {
        // Zero is not a product of anything but zero.
        let none = published(super::generate(
            3,
            0.0,
            0.0,
            true,
            false,
            false,
            1 << 2,
            MAX,
            1.0,
        ));
        assert!(none.is_empty());
        // And the next result is not left with the last one's integers.
        let next = published(super::generate(
            2, 6.0, 6.0, true, false, false, ALL, MAX, 3.0,
        ));
        assert_eq!(next[0], 6);
    }

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
                50, length, -7.0, use_answer, brackets, quiz_mode, ALL, MAX, 1000.0, false,
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
                    MAX,
                    1000.0 + i as f64,
                );
                assert_eq!(task, decode(&single), "task {i} of the batch");
                at += used;
            }
            assert_eq!(at, data.len());
        }
    }

    fn decode_batch(data: &[i32]) -> Vec<String> {
        let mut tasks = Vec::new();
        let mut at = 0;
        while at < data.len() {
            let (task, used) = decode_at(&data[at..]);
            tasks.push(task.task);
            at += used;
        }
        tasks
    }

    #[test]
    fn a_distinct_batch_repeats_nothing_and_leaves_the_rest_in_place() {
        const MUL: u32 = 1 << 2;
        for seed in (0..50).map(|n| n as f64 * 1000.0) {
            let batch = |distinct| {
                decode_batch(&generate_batch(
                    20, 2, 0.0, false, false, true, MUL, MAX, seed, distinct,
                ))
            };
            let (plain, distinct) = (batch(false), batch(true));
            assert_eq!(distinct.len(), 20);
            let unique: std::collections::BTreeSet<&String> = distinct.iter().collect();
            assert_eq!(unique.len(), 20, "{distinct:?}");

            // A task that is not a repeat stays where it was, and the ones
            // in place of repeats come from the seeds after the batch, in
            // order.
            let mut spares = (20..).map(|i| {
                decode(&generate(
                    2,
                    0.0,
                    false,
                    false,
                    true,
                    MUL,
                    MAX,
                    seed + i as f64,
                ))
                .task
            });
            for (i, task) in distinct.iter().enumerate() {
                if !distinct[..i].contains(&plain[i]) {
                    assert_eq!(task, &plain[i], "task {i} from seed {seed}");
                } else {
                    assert!(
                        spares.any(|spare| &spare == task),
                        "task {i} from seed {seed}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_distinct_batch_keeps_repeats_once_there_is_nothing_new() {
        // 10 as a sum of two numbers from 1 up is one of nine tasks.
        const ADD: u32 = 1;
        let data = generate_batch(
            30,
            2,
            10.0,
            true,
            false,
            false,
            ADD | NO_NEGATIVES,
            MAX,
            1.0,
            true,
        );
        let tasks = decode_batch(&data);
        assert_eq!(tasks.len(), 30);
        let unique: std::collections::BTreeSet<&String> = tasks.iter().collect();
        assert_eq!(unique.len(), 9, "{tasks:?}");
    }

    #[test]
    fn an_empty_batch_is_empty() {
        assert!(generate_batch(0, 4, 0.0, false, false, true, ALL, MAX, 1.0, true).is_empty());
    }

    #[test]
    fn a_task_that_can_be_built_is_not_refused_for_want_of_a_lucky_seed() {
        const DIV: u32 = 1 << 3;
        const SUB: u32 = 1 << 1;
        // 8/2/2/2 is the one task of four numbers, flat and within 10, that
        // makes 1, and a fixed count of restarts used to refuse one seed in
        // seven of them.
        for seed in 0..1000 {
            let data = generate(4, 1.0, true, false, false, DIV | FLAT, 10, seed as f64);
            assert!(!data.is_empty(), "refused seed {seed}");
            assert_eq!(decode(&data).answer, 1);
            let data = generate_in(4, 1.0, 5.0, DIV | FLAT, 10, seed as f64);
            assert!(!data.is_empty(), "refused seed {seed} for a range");
        }
        // 18-1-1-1-1-1 makes 13 within 20, flat and without negatives.
        for seed in 0..1000 {
            let data = generate(
                6,
                13.0,
                true,
                false,
                false,
                SUB | FLAT | NO_NEGATIVES,
                20,
                seed as f64,
            );
            assert!(!data.is_empty(), "refused seed {seed}");
        }
    }

    /// One task for an answer drawn from `low..=high`, empty if none can be
    /// built.
    #[allow(clippy::too_many_arguments)]
    fn generate_in(
        length: u32,
        low: f64,
        high: f64,
        allowed: u32,
        max: u32,
        seed: f64,
    ) -> Vec<i32> {
        let mut out = Vec::new();
        let built = fill_task(
            &mut out, length, low, high, true, false, true, allowed, max, seed,
        );
        if built {
            out
        } else {
            Vec::new()
        }
    }

    #[test]
    fn an_answer_is_drawn_from_a_range_with_both_ends_in_it() {
        let mut drawn = std::collections::BTreeMap::new();
        for seed in 0..4400 {
            let data = generate_in(3, 30.0, 40.0, ALL, MAX, seed as f64);
            let decoded = decode(&data);
            assert!(decoded.quiz.contains(&decoded.answer));
            *drawn.entry(decoded.answer).or_insert(0u32) += 1;
        }
        assert_eq!(
            drawn.keys().copied().collect::<Vec<i32>>(),
            (30..=40).collect::<Vec<i32>>()
        );
        for (answer, count) in drawn {
            assert!(count.abs_diff(400) < 100, "{answer} drawn {count} times");
        }
    }

    #[test]
    fn a_range_of_one_answer_is_that_answer_and_draws_nothing_for_it() {
        for seed in 0..50 {
            let in_range = generate_in(4, 17.0, 17.0, ALL, MAX, seed as f64);
            let exact = generate(4, 17.0, true, false, true, ALL, MAX, seed as f64);
            assert_eq!(in_range, exact);
        }
    }

    #[test]
    fn a_range_wider_than_the_answers_it_walks_is_drawn_from_across_its_width() {
        let mut buckets = [0u32; 10];
        for seed in 0..5000 {
            let data = generate_in(3, -9000.0, 9000.0, ALL, MAX, seed as f64);
            let answer = decode(&data).answer;
            assert!((-9000..=9000).contains(&answer), "drew {answer}");
            buckets[((answer + 9000) / 1800).min(9) as usize] += 1;
        }
        assert!(buckets.iter().all(|&count| count > 350), "{buckets:?}");
    }

    #[test]
    fn a_range_is_refused_when_none_of_its_answers_can_be_built() {
        const ADD: u32 = 1;
        // With no negatives every term of a sum is at least 1, so 14 terms
        // reach 14 at the least.
        assert!(generate_in(14, 1.0, 13.0, ADD | NO_NEGATIVES, MAX, 1.0).is_empty());
        let data = generate_in(14, 1.0, 20.0, ADD | NO_NEGATIVES, MAX, 1.0);
        assert!(decode(&data).answer >= 14);
        // And every one of 31 answers is below 32 terms.
        assert!(generate_in(32, 0.0, 30.0, ADD | NO_NEGATIVES, MAX, 1.0).is_empty());
    }

    /// Whether a task has a factor of 1 or -1 in it.
    fn has_unit_factor(task: &str) -> bool {
        task.split(['+', '-', '/', '(', ')'])
            .any(|piece| piece.split('*').count() > 1 && piece.split('*').any(|f| f == "1"))
            || task.contains("(-1)*")
            || task.contains("*(-1)")
    }

    #[test]
    fn with_star_alone_the_answers_that_need_no_factor_of_one_are_the_ones_drawn() {
        const MUL: u32 = 1 << 2;
        // (length, the default answers, 10 to 20, that can have that many
        // prime factors, and so no 1)
        for (length, expected) in [
            (2, vec![10, 12, 14, 15, 16, 18, 20]),
            (3, vec![12, 16, 18, 20]),
            (4, vec![16]),
        ] {
            let mut drawn = std::collections::BTreeSet::new();
            for seed in 0..600 {
                let data = generate(length, 0.0, false, false, false, MUL, MAX, seed as f64);
                let decoded = decode(&data);
                assert!(!has_unit_factor(&decoded.task), "{}", decoded.task);
                drawn.insert(decoded.answer);
            }
            assert_eq!(
                drawn.into_iter().collect::<Vec<_>>(),
                expected,
                "length {length}"
            );
        }
    }

    #[test]
    fn a_factor_of_one_is_still_there_when_nothing_else_can_make_the_task() {
        const MUL: u32 = 1 << 2;
        // Five numbers need five prime factors, and nothing from 10 to 20
        // has them; 13 is a prime and is only ever 1*13.
        for seed in 0..50 {
            let data = generate(5, 0.0, false, false, false, MUL, MAX, seed as f64);
            assert!(has_unit_factor(&decode(&data).task));
            let data = generate(2, 13.0, true, false, false, MUL, MAX, seed as f64);
            assert!(has_unit_factor(&decode(&data).task));
        }
        // But among 11 to 14 the primes are set aside while 12 and 14 stay.
        for seed in 0..200 {
            let data = generate_in(2, 11.0, 14.0, MUL, MAX, seed as f64);
            let decoded = decode(&data);
            assert!([12, 14].contains(&decoded.answer), "{}", decoded.task);
            assert!(!has_unit_factor(&decoded.task));
        }
    }

    #[test]
    fn with_other_operators_beside_it_no_prime_answer_becomes_a_product_with_one() {
        for seed in 0..500 {
            let data = generate(3, 13.0, true, false, false, ALL, MAX, seed as f64);
            assert!(!has_unit_factor(&decode(&data).task));
        }
    }

    #[test]
    fn the_layout_is_what_the_wrapper_expects() {
        let data = generate(3, 12.0, true, false, true, ALL, MAX, 1234.0);
        let decoded = decode(&data);
        assert_eq!(decoded.answer, 12);
        assert_eq!(decoded.quiz.len(), 4);
        assert!(decoded.quiz.contains(&12), "{:?}", decoded.quiz);
        assert!(!decoded.task.is_empty());
    }

    #[test]
    fn quiz_mode_off_gives_an_empty_option_list() {
        let data = generate(3, 12.0, true, false, false, ALL, MAX, 1.0);
        assert!(decode(&data).quiz.is_empty());
    }

    #[test]
    fn an_explicit_answer_of_zero_survives_the_boundary() {
        let data = generate(3, 0.0, true, false, false, ALL, MAX, 7.0);
        assert_eq!(decode(&data).answer, 0);
    }

    #[test]
    fn without_an_answer_one_is_drawn_from_the_documented_range() {
        for seed in 1..500 {
            let answer = decode(&generate(
                2,
                0.0,
                false,
                false,
                false,
                ALL,
                MAX,
                seed as f64,
            ))
            .answer;
            assert!(
                (DEFAULT_ANSWER_LOW..=DEFAULT_ANSWER_HIGH).contains(&(answer as i64)),
                "drew {answer}"
            );
        }
    }

    #[test]
    fn under_a_small_max_the_answer_and_options_fit_it() {
        for max in 10..=25 {
            let low = if max >= 20 { 10 } else { (max + 1) / 2 };
            let high = max.min(20);
            let mut drawn = std::collections::BTreeSet::new();
            for seed in 0..400 {
                let data = generate(3, 0.0, false, false, true, ALL, max, seed as f64);
                let decoded = decode(&data);
                drawn.insert(decoded.answer);
                let past = decoded.quiz.iter().find(|o| o.abs() > max as i32);
                assert!(past.is_none(), "{:?} under max {max}", decoded.quiz);
            }
            let expected: std::collections::BTreeSet<i32> = (low as i32..=high as i32).collect();
            assert_eq!(drawn, expected, "answers drawn under max {max}");
        }
    }

    #[test]
    fn without_an_answer_one_that_can_be_built_is_drawn() {
        // Without negatives, `-` alone cannot make 20 within 20, `/` alone
        // nothing past 10 within 20, and `+` alone of 14 terms nothing
        // below 14.
        const ADD: u32 = 1;
        const SUB: u32 = 1 << 1;
        const DIV: u32 = 1 << 3;
        for (length, ops, max, low, high) in [
            (3, SUB, 20, 10, 19),
            (3, DIV, 20, 10, 10),
            (14, ADD, MAX, 14, 20),
        ] {
            let mut drawn = std::collections::BTreeMap::new();
            for seed in 0..2000 {
                let data = generate(
                    length,
                    0.0,
                    false,
                    false,
                    false,
                    ops | NO_NEGATIVES,
                    max,
                    seed as f64,
                );
                assert!(!data.is_empty(), "refused seed {seed} for {ops:04b}");
                *drawn.entry(decode(&data).answer).or_insert(0u32) += 1;
            }
            let answers: Vec<i32> = drawn.keys().copied().collect();
            assert_eq!(answers, (low..=high).collect::<Vec<i32>>(), "{ops:04b}");
            let expected = 2000 / (high - low + 1) as u32;
            for (answer, count) in drawn {
                assert!(
                    count.abs_diff(expected) < expected / 4,
                    "{answer} drawn {count} times for {ops:04b}"
                );
            }
        }
        // `/` alone without brackets cannot make any of them in 8 terms
        // within 100: the first number would be the answer times 2^7.
        assert!(generate(8, 0.0, false, false, false, DIV | FLAT, 100, 1.0).is_empty());
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
        let task = decode(&generate(2, 6.0, true, false, false, ALL, MAX, 3.0)).task;
        assert!(task.chars().any(|c| "+-*/".contains(c)), "{task}");
        assert!(task.chars().any(|c| c.is_ascii_digit()), "{task}");
    }
}
