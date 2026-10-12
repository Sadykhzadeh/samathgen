//! Expression generation.
//!
//! The TypeScript version built a task by splicing a sub-expression in place
//! of an operand and then printing the pieces flat. Nothing told it that
//! `2 * 11` cannot simply become `2 * 9 + 2`, so operator precedence changed
//! the value and about 6% of generated tasks did not evaluate to the answer
//! they reported. `genValidOperator` tried to forbid the combinations that
//! would break, which is the hard way round and it never closed the gap.
//!
//! Here the task is a tree. Every split replaces a leaf holding `v` with a
//! node that evaluates to exactly `v`, so the root keeps its value whatever
//! the shape. Parentheses are then placed by precedence when the text is
//! produced. Both halves are exact, so `eval(text) == answer` holds by
//! construction rather than by luck.

use crate::rng::Rng;

/// Leaves and intermediate values stay inside this, so the numbers remain
/// readable and nothing can overflow on the way. An answer past it cannot be
/// split at all, so the wrappers refuse one.
pub const MAX_ABS: i64 = 10_000;
/// How far `+` and `-` reach for their second operand.
const OFFSET_MAX: i64 = 30;
/// Divisors `/` will introduce. Two at the least: `x / 1` teaches nothing.
const DIVISOR_MIN: i64 = 2;
const DIVISOR_MAX: i64 = 10;

/// The discriminants are the symbol codes handed to JavaScript, after
/// `SYMBOL_BASE`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Op {
    Add = 0,
    Sub = 1,
    Mul = 2,
    Div = 3,
}

impl Op {
    #[cfg(test)]
    pub fn symbol(self) -> &'static str {
        match self {
            Op::Add => "+",
            Op::Sub => "-",
            Op::Mul => "*",
            Op::Div => "/",
        }
    }

    fn precedence(self) -> u8 {
        match self {
            Op::Add | Op::Sub => 1,
            Op::Mul | Op::Div => 2,
        }
    }

    fn bit(self) -> u8 {
        1 << self as u8
    }

    /// `a - (b - c)` and `a / (b * c)` are not the same as dropping the
    /// brackets, while `a + (b - c)` and `a * (b / c)` are.
    fn right_operand_needs_brackets_at_equal_precedence(self) -> bool {
        matches!(self, Op::Sub | Op::Div)
    }
}

/// The operators a task may use, one bit per `Op`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Ops(u8);

impl Ops {
    pub const ALL: Ops = Ops(0b1111);

    /// `None` for an empty set or a bit that names no operator.
    pub fn from_bits(bits: u32) -> Option<Ops> {
        if bits == 0 || bits > Ops::ALL.0 as u32 {
            None
        } else {
            Some(Ops(bits as u8))
        }
    }

    pub fn has(self, op: Op) -> bool {
        self.0 & op.bit() != 0
    }

    /// With only `+`, or only `*`, no grouping ever changes the value, so no
    /// task can need a bracket and asking for one again is wasted work.
    fn can_need_brackets(self) -> bool {
        self != Ops(Op::Add.bit()) && self != Ops(Op::Mul.bit())
    }
}

#[derive(Clone, Debug)]
pub enum Expr {
    Num(i64),
    Binary {
        op: Op,
        left: Box<Expr>,
        right: Box<Expr>,
    },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Token {
    Num(i64),
    Op(Op),
    Open,
    Close,
}

enum Visit {
    Missed,
    Split,
    Failed,
}

impl Expr {
    /// The value this subtree evaluates to. Exact by construction.
    pub fn value(&self) -> i64 {
        match self {
            Expr::Num(n) => *n,
            Expr::Binary { op, left, right } => {
                let (l, r) = (left.value(), right.value());
                match op {
                    Op::Add => l + r,
                    Op::Sub => l - r,
                    Op::Mul => l * r,
                    // Every division introduced here is exact, so this is too.
                    Op::Div => l / r,
                }
            }
        }
    }

    #[cfg(test)]
    pub fn leaf_count(&self) -> usize {
        match self {
            Expr::Num(_) => 1,
            Expr::Binary { left, right, .. } => left.leaf_count() + right.leaf_count(),
        }
    }

    fn precedence(&self) -> u8 {
        match self {
            // A leaf binds tighter than any operator, so a parent never has
            // to wrap it. A negative leaf carries its own brackets instead,
            // because `a - -5` is `a--5`, which does not even parse.
            Expr::Num(_) => 3,
            Expr::Binary { op, .. } => op.precedence(),
        }
    }

    fn split_nth_leaf(&mut self, index: &mut usize, config: &Config, rng: &mut Rng) -> Visit {
        match self {
            Expr::Num(value) => {
                let current = *value;
                if *index > 0 {
                    *index -= 1;
                    return Visit::Missed;
                }
                match split_value(current, config, rng) {
                    Some((left, op, right)) => {
                        *self = Expr::Binary {
                            op,
                            left: Box::new(Expr::Num(left)),
                            right: Box::new(Expr::Num(right)),
                        };
                        Visit::Split
                    }
                    None => Visit::Failed,
                }
            }
            Expr::Binary { left, right, .. } => match left.split_nth_leaf(index, config, rng) {
                Visit::Missed => right.split_nth_leaf(index, config, rng),
                reached => reached,
            },
        }
    }

    #[cfg(test)]
    pub fn tokens(&self) -> Vec<Token> {
        let mut out = Vec::new();
        self.write(&mut out);
        out
    }

    pub fn write(&self, out: &mut Vec<Token>) {
        match self {
            Expr::Num(n) => {
                if *n < 0 {
                    out.push(Token::Open);
                    out.push(Token::Num(*n));
                    out.push(Token::Close);
                } else {
                    out.push(Token::Num(*n));
                }
            }
            Expr::Binary { op, left, right } => {
                let precedence = op.precedence();

                if left.precedence() < precedence {
                    bracket(left, out);
                } else {
                    left.write(out);
                }

                out.push(Token::Op(*op));

                let right_precedence = right.precedence();
                let needs_brackets = right_precedence < precedence
                    || (right_precedence == precedence
                        && op.right_operand_needs_brackets_at_equal_precedence());
                if needs_brackets {
                    bracket(right, out);
                } else {
                    right.write(out);
                }
            }
        }
    }
}

fn bracket(expr: &Expr, out: &mut Vec<Token>) {
    out.push(Token::Open);
    expr.write(out);
    out.push(Token::Close);
}

/// Whether the task groups part of itself in brackets, as in `(2+3)*4`. The
/// brackets a negative number carries, as in `7-(-5)`, are not a group: they
/// open straight onto that number, where a group opens onto a number of 0 or
/// more or onto another bracket.
fn has_group(tokens: &[Token]) -> bool {
    tokens
        .windows(2)
        .any(|pair| pair[0] == Token::Open && !matches!(pair[1], Token::Num(n) if n < 0))
}

/// Only the tests and the doc examples need the task as one string; the
/// wrapper is handed the token array.
#[cfg(test)]
pub fn render(tokens: &[Token]) -> String {
    tokens
        .iter()
        .map(|token| match token {
            Token::Num(n) => n.to_string(),
            Token::Op(op) => op.symbol().to_string(),
            Token::Open => "(".to_string(),
            Token::Close => ")".to_string(),
        })
        .collect()
}

/// No number up to MAX_ABS has more divisors than this: 7560 and 9240
/// have 64.
const MAX_DIVISORS: usize = 64;

/// Divisors of `|value|` worth using, which is everything but 1 and the
/// value itself - `1 * 12` and `12 * 1` are not a multiplication exercise.
/// For a prime there is nothing else, so those come back as the fallback.
///
/// Written into `out`, smallest of each pair first, and the count returned:
/// this runs on every multiplication, and a pair of fresh vectors each time
/// cost more than the arithmetic.
fn useful_divisors(value: i64, out: &mut [i64; MAX_DIVISORS]) -> usize {
    let magnitude = value.abs();
    debug_assert!(magnitude <= MAX_ABS);
    let mut count = 0;
    let mut d = 2;
    while d * d <= magnitude {
        if magnitude % d == 0 {
            out[count] = d;
            count += 1;
            let other = magnitude / d;
            if other != d {
                out[count] = other;
                count += 1;
            }
        }
        d += 1;
    }
    if count == 0 {
        out[0] = 1;
        count = 1;
        if magnitude != 1 {
            out[1] = magnitude;
            count = 2;
        }
    }
    count
}

/// Picks `(a, op, b)` such that `a op b == value` exactly, or `None` when
/// this value cannot be split within the bounds above.
fn split_value(value: i64, config: &Config, rng: &mut Rng) -> Option<(i64, Op, i64)> {
    let ops = config.ops;
    // 0 * anything and 0 / anything are degenerate: the other operand carries
    // no constraint, which is how the old generator ended up emitting
    // "1*3*2*0+0*0*0*0..." for a large length. Without negatives, 0 and 1
    // cannot be a sum either: one of the two terms would be 0 or below.
    let usable = [
        config.negatives || value >= 2,
        true,
        value != 0 && value.abs() <= MAX_ABS,
        value != 0 && value.abs() * DIVISOR_MIN <= MAX_ABS,
    ];
    let mut candidates = [Op::Add; 4];
    let mut count = 0;
    for op in [Op::Add, Op::Sub, Op::Mul, Op::Div] {
        if usable[op as usize] && ops.has(op) {
            candidates[count] = op;
            count += 1;
        }
    }

    let candidates = &mut candidates[..count];
    rng.shuffle(candidates);
    for &op in candidates.iter() {
        if let Some(split) = try_split(value, op, config.negatives, rng) {
            return Some(split);
        }
    }
    None
}

/// Negative operands are legal and correctly handled, but a page of
/// `(-1)*(-7)+(-48)/(-4)` is not what a school exercise should look like.
/// One draw in six may flip, which keeps negatives in the mix without
/// letting them become the norm.
const NEGATIVE_IN: u64 = 6;

fn occasionally_negative(rng: &mut Rng) -> i64 {
    if rng.below(NEGATIVE_IN) == 0 {
        -1
    } else {
        1
    }
}

fn try_split(value: i64, op: Op, negatives: bool, rng: &mut Rng) -> Option<(i64, Op, i64)> {
    // The sign that keeps an operand on the same side of zero as the value
    // it came from.
    let toward_value = if value < 0 { -1 } else { 1 };
    // Without negatives every value split is already 0 or more, so keeping
    // each operand on its side of zero, and never flipping one, keeps every
    // number in the task and every node of the tree at 0 or above.
    let flip = |rng: &mut Rng| {
        if negatives {
            occasionally_negative(rng)
        } else {
            1
        }
    };

    // A handful of attempts: the bounds reject some draws, and another draw
    // is cheaper than reasoning about which ones.
    for _ in 0..16 {
        let candidate = match op {
            Op::Add => {
                // Staying under the value splits 19 as 14+5 rather than
                // (-6)+25, so both halves keep the value's own sign.
                let reach = if value.abs() >= 2 {
                    OFFSET_MAX.min(value.abs() - 1)
                } else {
                    OFFSET_MAX
                };
                let right = rng.range(1, reach.max(1)) * toward_value * flip(rng);
                (value - right, Op::Add, right)
            }
            Op::Sub => {
                let right = rng.range(1, OFFSET_MAX) * toward_value * flip(rng);
                (value + right, Op::Sub, right)
            }
            Op::Mul => {
                let mut divisors = [0; MAX_DIVISORS];
                let count = useful_divisors(value, &mut divisors);
                let left = *rng.pick(&divisors[..count]) * flip(rng);
                if left == 0 || value % left != 0 {
                    continue;
                }
                (left, Op::Mul, value / left)
            }
            Op::Div => {
                let right = rng.range(DIVISOR_MIN, DIVISOR_MAX) * flip(rng);
                let left = value.checked_mul(right)?;
                (left, Op::Div, right)
            }
        };

        let (left, _, right) = candidate;
        if left == 0 || right == 0 {
            continue;
        }
        if left.abs() > MAX_ABS || right.abs() > MAX_ABS {
            continue;
        }
        if !negatives && (left < 0 || right < 0) {
            continue;
        }
        return Some(candidate);
    }
    None
}

pub struct Config {
    pub answer: i64,
    pub length: usize,
    pub brackets: bool,
    pub ops: Ops,
    /// When false, no number in the task is negative and neither is any
    /// step of working it out left to right.
    pub negatives: bool,
}

/// Builds the task and writes its tokens into `tokens`, which the bracket
/// check needs anyway, so the caller does not render it a second time.
///
/// `None` when the operators cannot reach the length asked for. With the
/// bounds above that happens in two cases only: an answer of 0 with neither
/// `+` nor `-` (0 cannot be a product or a quotient without a zero in it),
/// and an answer past `MAX_ABS / 2` with `/` alone.
///
/// Without negatives there are more: a negative answer, an answer of 0
/// without `-`, `+` alone with an answer smaller than the number of terms
/// (every term is at least 1), and an answer of `MAX_ABS` with neither `+`
/// nor `*`, since `-` and `/` would both need a first number past it.
pub fn generate(config: &Config, rng: &mut Rng, tokens: &mut Vec<Token>) -> Option<Expr> {
    let wanted = config.length.clamp(2, 32);
    if !config.negatives && config.answer < 0 {
        return None;
    }

    // `brackets` asks for a shape, not a different answer, so the whole task
    // is simply drawn again until the shape appears. If it does not after a
    // few tries the last one is returned: a task that evaluates correctly
    // without brackets beats no task at all. A group needs a sum or product
    // inside another one, so two numbers can never have one.
    let attempts = if config.brackets && config.ops.can_need_brackets() && wanted >= 3 {
        24
    } else {
        1
    };
    let mut last = None;

    for _ in 0..attempts {
        let mut expr = Expr::Num(config.answer);
        // Counted as it grows rather than walked for on every step.
        let mut leaves = 1;
        let mut guard = 0;
        while leaves < wanted && guard < wanted * 64 {
            guard += 1;
            let mut index = rng.below(leaves as u64) as usize;
            if let Visit::Split = expr.split_nth_leaf(&mut index, config, rng) {
                leaves += 1;
            }
        }
        if leaves < wanted {
            return None;
        }
        tokens.clear();
        expr.write(tokens);
        if !config.brackets || has_group(tokens) {
            return Some(expr);
        }
        last = Some(expr);
    }

    // `tokens` still holds the last attempt, which is the one returned.
    last
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(config: &Config, rng: &mut Rng) -> Expr {
        generate(config, rng, &mut Vec::new()).expect("every operator can build any length")
    }

    fn has_brackets(expr: &Expr) -> bool {
        has_group(&expr.tokens())
    }

    /// A parser written independently of the renderer: if the two agree on
    /// thousands of random tasks, the brackets are in the right places. The
    /// JavaScript side then evaluates the same strings with eval(), which is
    /// a third opinion.
    struct Parser<'a> {
        tokens: &'a [Token],
        at: usize,
        /// The lowest value met on the way: every number, and every running
        /// result as the task is worked out left to right.
        lowest: i64,
    }

    impl<'a> Parser<'a> {
        fn parse(tokens: &'a [Token]) -> i64 {
            Parser::parse_with_lowest(tokens).0
        }

        fn parse_with_lowest(tokens: &'a [Token]) -> (i64, i64) {
            let mut parser = Parser {
                tokens,
                at: 0,
                lowest: i64::MAX,
            };
            let value = parser.sum();
            assert_eq!(parser.at, tokens.len(), "trailing tokens in {:?}", tokens);
            (value, parser.lowest)
        }

        fn saw(&mut self, value: i64) -> i64 {
            self.lowest = self.lowest.min(value);
            value
        }

        fn peek(&self) -> Option<Token> {
            self.tokens.get(self.at).copied()
        }

        fn sum(&mut self) -> i64 {
            let mut value = self.product();
            while let Some(Token::Op(op)) = self.peek() {
                match op {
                    Op::Add => {
                        self.at += 1;
                        value += self.product();
                        self.saw(value);
                    }
                    Op::Sub => {
                        self.at += 1;
                        value -= self.product();
                        self.saw(value);
                    }
                    _ => break,
                }
            }
            value
        }

        fn product(&mut self) -> i64 {
            let mut value = self.atom();
            while let Some(Token::Op(op)) = self.peek() {
                match op {
                    Op::Mul => {
                        self.at += 1;
                        value *= self.atom();
                        self.saw(value);
                    }
                    Op::Div => {
                        self.at += 1;
                        let divisor = self.atom();
                        assert_ne!(divisor, 0, "division by zero in {:?}", self.tokens);
                        assert_eq!(
                            value % divisor,
                            0,
                            "inexact division {value}/{divisor} in {:?}",
                            self.tokens
                        );
                        value /= divisor;
                        self.saw(value);
                    }
                    _ => break,
                }
            }
            value
        }

        fn atom(&mut self) -> i64 {
            match self.peek() {
                Some(Token::Num(n)) => {
                    self.at += 1;
                    self.saw(n)
                }
                Some(Token::Open) => {
                    self.at += 1;
                    let value = self.sum();
                    assert_eq!(self.peek(), Some(Token::Close), "unclosed bracket");
                    self.at += 1;
                    value
                }
                other => panic!("unexpected token {other:?} in {:?}", self.tokens),
            }
        }
    }

    fn check(answer: i64, length: usize, brackets: bool, seed: u64) {
        let mut rng = Rng::new(seed);
        let expr = build(
            &Config {
                answer,
                length,
                brackets,
                ops: Ops::ALL,
                negatives: true,
            },
            &mut rng,
        );
        let tokens = expr.tokens();
        let text = render(&tokens);

        assert_eq!(
            expr.value(),
            answer,
            "tree value drifted for {text} (answer {answer})"
        );
        assert_eq!(
            Parser::parse(&tokens),
            answer,
            "parsing {text} did not give {answer}"
        );
        assert_eq!(
            expr.leaf_count().min(length.clamp(2, 32)),
            length.clamp(2, 32),
            "wanted {length} terms, got {} in {text}",
            expr.leaf_count()
        );
    }

    #[test]
    fn the_task_always_evaluates_to_the_answer() {
        let mut seeds = Rng::new(0xC0FFEE);
        for _ in 0..20_000 {
            let answer = seeds.range(-50, 50);
            let length = seeds.range(2, 8) as usize;
            let brackets = seeds.below(2) == 0;
            check(answer, length, brackets, seeds.next_u32() as u64);
        }
    }

    #[test]
    fn every_answer_the_wrappers_accept_gets_the_length_asked_for() {
        // Both ends, the primes nearest them (nothing to multiply), and the
        // point past which `/` no longer fits.
        let answers = [
            -MAX_ABS, -9973, -5001, -1, 0, 1, 4999, 5000, 5001, 9973, MAX_ABS,
        ];
        for answer in answers {
            for length in 2..=32 {
                for seed in 0..12 {
                    check(answer, length, seed % 2 == 0, seed);
                }
            }
        }
    }

    #[test]
    fn divisors_come_out_in_the_order_the_draws_depend_on() {
        // The straightforward definition, in the order a seed has always
        // picked from: each pair as it is found, smallest first.
        fn reference(value: i64) -> Vec<i64> {
            let magnitude = value.abs();
            let mut interesting = Vec::new();
            let mut trivial = Vec::new();
            for d in (1..).take_while(|d| d * d <= magnitude) {
                if magnitude % d == 0 {
                    for candidate in [d, magnitude / d] {
                        let list = if candidate == 1 || candidate == magnitude {
                            &mut trivial
                        } else {
                            &mut interesting
                        };
                        if !list.contains(&candidate) {
                            list.push(candidate);
                        }
                    }
                }
            }
            if interesting.is_empty() {
                trivial
            } else {
                interesting
            }
        }

        let mut out = [0; MAX_DIVISORS];
        for value in -MAX_ABS..=MAX_ABS {
            if value == 0 {
                continue;
            }
            let count = useful_divisors(value, &mut out);
            assert_eq!(&out[..count], reference(value).as_slice(), "{value}");
        }
    }

    #[test]
    fn every_set_of_operators_builds_what_it_can_and_refuses_the_rest() {
        let only_div = Ops::from_bits(1 << Op::Div as u32).unwrap();
        for bits in 1..=15 {
            let ops = Ops::from_bits(bits).unwrap();
            for answer in [
                -MAX_ABS, -5001, -5000, -37, -1, 0, 1, 2, 12, 97, 4999, 5000, 5001, 9973, MAX_ABS,
            ] {
                let impossible = (answer == 0 && !ops.has(Op::Add) && !ops.has(Op::Sub))
                    || (answer.abs() > MAX_ABS / 2 && ops == only_div);
                for length in [2, 3, 5, 8, 16, 32] {
                    for seed in 0..8 {
                        let config = Config {
                            answer,
                            length,
                            brackets: seed % 2 == 0,
                            ops,
                            negatives: true,
                        };
                        let mut tokens = Vec::new();
                        let built = generate(&config, &mut Rng::new(seed), &mut tokens);
                        let what = format!("answer {answer}, length {length}, ops {bits:04b}");
                        let Some(expr) = built else {
                            assert!(impossible, "refused {what}");
                            continue;
                        };
                        assert!(!impossible, "built {what}");
                        assert_eq!(expr.leaf_count(), length, "{what}");
                        assert_eq!(Parser::parse(&tokens), answer, "{what}");
                        for token in &tokens {
                            match token {
                                Token::Op(op) => assert!(ops.has(*op), "{op:?} in {what}"),
                                Token::Num(n) => assert!(n.abs() <= MAX_ABS, "{n} in {what}"),
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn without_negatives_nothing_dips_below_zero() {
        let only = |op: Op| Ops::from_bits(1 << op as u32).unwrap();
        for bits in 1..=15 {
            let ops = Ops::from_bits(bits).unwrap();
            for answer in [
                -5, 0, 1, 2, 3, 5, 12, 31, 97, 4999, 5000, 5001, 9973, 9999, MAX_ABS,
            ] {
                for length in [2, 3, 5, 8, 16, 32] {
                    let impossible = answer < 0
                        || (answer == 0 && !ops.has(Op::Sub))
                        || (ops == only(Op::Add) && answer < length as i64)
                        || (answer == MAX_ABS && !ops.has(Op::Add) && !ops.has(Op::Mul))
                        || (ops == only(Op::Div) && answer > MAX_ABS / 2);
                    for seed in 0..8 {
                        let config = Config {
                            answer,
                            length,
                            brackets: seed % 2 == 0,
                            ops,
                            negatives: false,
                        };
                        let mut tokens = Vec::new();
                        let built = generate(&config, &mut Rng::new(seed), &mut tokens);
                        let what = format!("answer {answer}, length {length}, ops {bits:04b}");
                        let Some(expr) = built else {
                            assert!(impossible, "refused {what}");
                            continue;
                        };
                        assert!(!impossible, "built {what}");
                        assert_eq!(expr.leaf_count(), length, "{what}");
                        let (value, lowest) = Parser::parse_with_lowest(&tokens);
                        let text = render(&tokens);
                        assert_eq!(value, answer, "{text} for {what}");
                        assert!(lowest >= 0, "{text} goes down to {lowest} for {what}");
                    }
                }
            }
        }
    }

    #[test]
    fn negatives_appear_unless_they_are_ruled_out() {
        // The switch must not have turned them off for everyone else.
        let negative_somewhere = (0..500).any(|seed| {
            build(
                &Config {
                    answer: 12,
                    length: 6,
                    brackets: false,
                    ops: Ops::ALL,
                    negatives: true,
                },
                &mut Rng::new(seed),
            )
            .tokens()
            .iter()
            .any(|token| matches!(token, Token::Num(n) if *n < 0))
        });
        assert!(negative_somewhere);
    }

    #[test]
    fn an_empty_or_unknown_operator_set_is_refused() {
        assert_eq!(Ops::from_bits(0), None);
        assert_eq!(Ops::from_bits(16), None);
        assert_eq!(Ops::from_bits(15), Some(Ops::ALL));
    }

    #[test]
    fn it_holds_for_an_answer_of_zero() {
        for seed in 0..2000 {
            check(0, 4, false, seed);
        }
    }

    #[test]
    fn it_holds_for_long_tasks() {
        for seed in 0..500 {
            check(17, 16, true, seed);
        }
    }

    #[test]
    fn an_explicit_answer_of_zero_is_kept() {
        let mut rng = Rng::new(5);
        let expr = build(
            &Config {
                answer: 0,
                length: 3,
                brackets: false,
                ops: Ops::ALL,
                negatives: true,
            },
            &mut rng,
        );
        assert_eq!(expr.value(), 0);
    }

    #[test]
    fn brackets_are_asked_for_and_delivered() {
        let mut produced = 0;
        for seed in 0..400 {
            let mut rng = Rng::new(seed);
            let expr = build(
                &Config {
                    answer: 24,
                    length: 5,
                    brackets: true,
                    ops: Ops::ALL,
                    negatives: true,
                },
                &mut rng,
            );
            if has_brackets(&expr) {
                produced += 1;
            }
        }
        assert!(
            produced > 380,
            "brackets requested 400 times, produced {produced}"
        );
    }

    #[test]
    fn the_brackets_of_a_negative_number_are_not_a_group() {
        use Token::{Close, Num, Open};
        let sum = Token::Op(Op::Add);
        let difference = Token::Op(Op::Sub);
        let product = Token::Op(Op::Mul);
        // 7-(-5)
        assert!(!has_group(&[Num(7), difference, Open, Num(-5), Close]));
        // (-2)*(-3)
        assert!(!has_group(&[
            Open,
            Num(-2),
            Close,
            product,
            Open,
            Num(-3),
            Close
        ]));
        // (2+3)*4
        assert!(has_group(&[
            Open,
            Num(2),
            sum,
            Num(3),
            Close,
            product,
            Num(4)
        ]));
        // ((-2)+5)*3
        assert!(has_group(&[
            Open,
            Open,
            Num(-2),
            Close,
            sum,
            Num(5),
            Close,
            product,
            Num(3)
        ]));
    }

    #[test]
    fn brackets_bring_a_group_whenever_there_is_room_for_one() {
        for length in 3..=12 {
            for negatives in [true, false] {
                for seed in 0..300 {
                    let expr = build(
                        &Config {
                            answer: 12,
                            length,
                            brackets: true,
                            ops: Ops::ALL,
                            negatives,
                        },
                        &mut Rng::new(seed),
                    );
                    assert!(
                        has_brackets(&expr),
                        "no group in {} (length {length}, seed {seed})",
                        render(&expr.tokens())
                    );
                }
            }
        }
    }

    #[test]
    fn no_leaf_is_zero_unless_the_answer_forces_it() {
        for seed in 0..2000 {
            let mut rng = Rng::new(seed);
            let expr = build(
                &Config {
                    answer: 12,
                    length: 6,
                    brackets: false,
                    ops: Ops::ALL,
                    negatives: true,
                },
                &mut rng,
            );
            for token in expr.tokens() {
                if let Token::Num(0) = token {
                    panic!("a zero leaf appeared in {}", render(&expr.tokens()));
                }
            }
        }
    }

    #[test]
    fn the_same_seed_gives_the_same_task() {
        let config = Config {
            answer: 15,
            length: 5,
            brackets: true,
            ops: Ops::ALL,
            negatives: true,
        };
        let first = render(&build(&config, &mut Rng::new(99)).tokens());
        let second = render(&build(&config, &mut Rng::new(99)).tokens());
        assert_eq!(first, second);
    }

    #[test]
    fn brackets_go_where_precedence_needs_them() {
        let sum = Expr::Binary {
            op: Op::Add,
            left: Box::new(Expr::Num(2)),
            right: Box::new(Expr::Num(3)),
        };
        let product = Expr::Binary {
            op: Op::Mul,
            left: Box::new(sum.clone()),
            right: Box::new(Expr::Num(4)),
        };
        assert_eq!(render(&product.tokens()), "(2+3)*4");

        let difference = Expr::Binary {
            op: Op::Sub,
            left: Box::new(Expr::Num(10)),
            right: Box::new(sum.clone()),
        };
        assert_eq!(render(&difference.tokens()), "10-(2+3)");

        // a + (b - c) does not need them
        let flat = Expr::Binary {
            op: Op::Add,
            left: Box::new(Expr::Num(10)),
            right: Box::new(Expr::Binary {
                op: Op::Sub,
                left: Box::new(Expr::Num(3)),
                right: Box::new(Expr::Num(1)),
            }),
        };
        assert_eq!(render(&flat.tokens()), "10+3-1");

        // a negative leaf brings its own, or "7--5" would not parse
        let negative = Expr::Binary {
            op: Op::Sub,
            left: Box::new(Expr::Num(7)),
            right: Box::new(Expr::Num(-5)),
        };
        assert_eq!(render(&negative.tokens()), "7-(-5)");
    }
}
