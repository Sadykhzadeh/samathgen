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
/// readable and nothing can overflow on the way.
const MAX_ABS: i64 = 10_000;
/// How far `+` and `-` reach for their second operand.
const OFFSET_MAX: i64 = 30;
/// Divisors `/` will introduce. Two at the least: `x / 1` teaches nothing.
const DIVISOR_MIN: i64 = 2;
const DIVISOR_MAX: i64 = 10;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
}

impl Op {
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

    /// `a - (b - c)` and `a / (b * c)` are not the same as dropping the
    /// brackets, while `a + (b - c)` and `a * (b / c)` are.
    fn right_operand_needs_brackets_at_equal_precedence(self) -> bool {
        matches!(self, Op::Sub | Op::Div)
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
    Sym(&'static str),
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

    fn split_nth_leaf(&mut self, index: &mut usize, rng: &mut Rng) -> Visit {
        match self {
            Expr::Num(value) => {
                let current = *value;
                if *index > 0 {
                    *index -= 1;
                    return Visit::Missed;
                }
                match split_value(current, rng) {
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
            Expr::Binary { left, right, .. } => match left.split_nth_leaf(index, rng) {
                Visit::Missed => right.split_nth_leaf(index, rng),
                reached => reached,
            },
        }
    }

    pub fn tokens(&self) -> Vec<Token> {
        let mut out = Vec::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut Vec<Token>) {
        match self {
            Expr::Num(n) => {
                if *n < 0 {
                    out.push(Token::Sym("("));
                    out.push(Token::Num(*n));
                    out.push(Token::Sym(")"));
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

                out.push(Token::Sym(op.symbol()));

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
    out.push(Token::Sym("("));
    expr.write(out);
    out.push(Token::Sym(")"));
}

/// Only the tests and the doc examples need the task as one string; the
/// wrapper is handed the token array.
#[cfg(test)]
pub fn render(tokens: &[Token]) -> String {
    tokens
        .iter()
        .map(|token| match token {
            Token::Num(n) => n.to_string(),
            Token::Sym(s) => (*s).to_string(),
        })
        .collect()
}

/// Divisors of `|value|` worth using, which is everything but 1 and the
/// value itself - `1 * 12` and `12 * 1` are not a multiplication exercise.
/// For a prime there is nothing else, so those come back as the fallback.
fn useful_divisors(value: i64) -> Vec<i64> {
    let magnitude = value.abs();
    let mut interesting = Vec::new();
    let mut trivial = Vec::new();
    let mut d = 1;
    while d * d <= magnitude {
        if magnitude % d == 0 {
            let other = magnitude / d;
            for candidate in [d, other] {
                if candidate == 1 || candidate == magnitude {
                    if !trivial.contains(&candidate) {
                        trivial.push(candidate);
                    }
                } else if !interesting.contains(&candidate) {
                    interesting.push(candidate);
                }
            }
        }
        d += 1;
    }
    if interesting.is_empty() {
        trivial
    } else {
        interesting
    }
}

/// Picks `(a, op, b)` such that `a op b == value` exactly, or `None` when
/// this value cannot be split within the bounds above.
fn split_value(value: i64, rng: &mut Rng) -> Option<(i64, Op, i64)> {
    let mut candidates: Vec<Op> = vec![Op::Add, Op::Sub];
    // 0 * anything and 0 / anything are degenerate: the other operand carries
    // no constraint, which is how the old generator ended up emitting
    // "1*3*2*0+0*0*0*0..." for a large length.
    if value != 0 {
        if value.abs() <= MAX_ABS {
            candidates.push(Op::Mul);
        }
        if value.abs() * DIVISOR_MIN <= MAX_ABS {
            candidates.push(Op::Div);
        }
    }

    rng.shuffle(&mut candidates);
    for op in candidates {
        if let Some(split) = try_split(value, op, rng) {
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

fn try_split(value: i64, op: Op, rng: &mut Rng) -> Option<(i64, Op, i64)> {
    // The sign that keeps an operand on the same side of zero as the value
    // it came from.
    let toward_value = if value < 0 { -1 } else { 1 };

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
                let right = rng.range(1, reach.max(1)) * toward_value * occasionally_negative(rng);
                (value - right, Op::Add, right)
            }
            Op::Sub => {
                let right = rng.range(1, OFFSET_MAX) * toward_value * occasionally_negative(rng);
                (value + right, Op::Sub, right)
            }
            Op::Mul => {
                let divisors = useful_divisors(value);
                if divisors.is_empty() {
                    return None;
                }
                let left = *rng.pick(&divisors) * occasionally_negative(rng);
                if left == 0 || value % left != 0 {
                    continue;
                }
                (left, Op::Mul, value / left)
            }
            Op::Div => {
                let right = rng.range(DIVISOR_MIN, DIVISOR_MAX) * occasionally_negative(rng);
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
        return Some(candidate);
    }
    None
}

pub struct Config {
    pub answer: i64,
    pub length: usize,
    pub brackets: bool,
}

fn has_brackets(expr: &Expr) -> bool {
    expr.tokens().contains(&Token::Sym("("))
}

pub fn generate(config: &Config, rng: &mut Rng) -> Expr {
    let wanted = config.length.clamp(2, 32);

    // `brackets` asks for a shape, not a different answer, so the whole task
    // is simply drawn again until the shape appears. If it does not after a
    // few tries the last one is returned: a task that evaluates correctly
    // without brackets beats no task at all.
    let attempts = if config.brackets { 24 } else { 1 };
    let mut last = None;

    for _ in 0..attempts {
        let mut expr = Expr::Num(config.answer);
        let mut guard = 0;
        while expr.leaf_count() < wanted && guard < wanted * 64 {
            guard += 1;
            let leaves = expr.leaf_count();
            let mut index = rng.below(leaves as u64) as usize;
            if let Visit::Split = expr.split_nth_leaf(&mut index, rng) {
                continue;
            }
        }
        if !config.brackets || has_brackets(&expr) {
            return expr;
        }
        last = Some(expr);
    }

    last.unwrap_or(Expr::Num(config.answer))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A parser written independently of the renderer: if the two agree on
    /// thousands of random tasks, the brackets are in the right places. The
    /// JavaScript side then evaluates the same strings with eval(), which is
    /// a third opinion.
    struct Parser<'a> {
        tokens: &'a [Token],
        at: usize,
    }

    impl<'a> Parser<'a> {
        fn parse(tokens: &'a [Token]) -> i64 {
            let mut parser = Parser { tokens, at: 0 };
            let value = parser.sum();
            assert_eq!(parser.at, tokens.len(), "trailing tokens in {:?}", tokens);
            value
        }

        fn peek(&self) -> Option<Token> {
            self.tokens.get(self.at).copied()
        }

        fn sum(&mut self) -> i64 {
            let mut value = self.product();
            while let Some(Token::Sym(s)) = self.peek() {
                match s {
                    "+" => {
                        self.at += 1;
                        value += self.product();
                    }
                    "-" => {
                        self.at += 1;
                        value -= self.product();
                    }
                    _ => break,
                }
            }
            value
        }

        fn product(&mut self) -> i64 {
            let mut value = self.atom();
            while let Some(Token::Sym(s)) = self.peek() {
                match s {
                    "*" => {
                        self.at += 1;
                        value *= self.atom();
                    }
                    "/" => {
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
                    n
                }
                Some(Token::Sym("(")) => {
                    self.at += 1;
                    let value = self.sum();
                    assert_eq!(self.peek(), Some(Token::Sym(")")), "unclosed bracket");
                    self.at += 1;
                    value
                }
                other => panic!("unexpected token {other:?} in {:?}", self.tokens),
            }
        }
    }

    fn check(answer: i64, length: usize, brackets: bool, seed: u64) {
        let mut rng = Rng::new(seed);
        let expr = generate(
            &Config {
                answer,
                length,
                brackets,
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
        let expr = generate(
            &Config {
                answer: 0,
                length: 3,
                brackets: false,
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
            let expr = generate(
                &Config {
                    answer: 24,
                    length: 5,
                    brackets: true,
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
    fn no_leaf_is_zero_unless_the_answer_forces_it() {
        for seed in 0..2000 {
            let mut rng = Rng::new(seed);
            let expr = generate(
                &Config {
                    answer: 12,
                    length: 6,
                    brackets: false,
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
        };
        let first = render(&generate(&config, &mut Rng::new(99)).tokens());
        let second = render(&generate(&config, &mut Rng::new(99)).tokens());
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
