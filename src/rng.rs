//! PCG32, so generation is seedable and therefore reproducible.
//!
//! The TypeScript version reached straight for Math.random, which is why its
//! own spec was a coin toss: a failure could not be replayed. Every draw here
//! comes from a seed the caller can pin.

pub struct Rng {
    state: u64,
    inc: u64,
}

const MULTIPLIER: u64 = 6364136223846793005;

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut rng = Rng {
            state: 0,
            inc: (seed << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(MULTIPLIER).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    fn next_u64(&mut self) -> u64 {
        ((self.next_u32() as u64) << 32) | self.next_u32() as u64
    }

    /// Uniform in `0..bound`. Rejection sampling, so there is no modulo bias -
    /// `% bound` on its own would favour the low end of the range.
    pub fn below(&mut self, bound: u64) -> u64 {
        assert!(bound > 0, "bound must be positive");
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let value = self.next_u64();
            if value >= threshold {
                return value % bound;
            }
        }
    }

    /// Uniform in `low..=high`.
    pub fn range(&mut self, low: i64, high: i64) -> i64 {
        assert!(low <= high, "empty range");
        let span = (high as i128 - low as i128 + 1) as u64;
        low.wrapping_add(self.below(span) as i64)
    }

    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }

    /// Fisher-Yates. The TypeScript version sorted with a comparator that
    /// mutated a shared cache, which is not a defined way to shuffle.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i as u64 + 1) as usize;
            items.swap(i, j);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_gives_the_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = Rng::new(1);
        let mut b = Rng::new(2);
        let diverged = (0..32).any(|_| a.next_u32() != b.next_u32());
        assert!(diverged);
    }

    #[test]
    fn range_stays_inside_its_bounds() {
        let mut rng = Rng::new(7);
        for _ in 0..100_000 {
            let value = rng.range(-30, 30);
            assert!((-30..=30).contains(&value), "{value} out of range");
        }
    }

    #[test]
    fn range_covers_both_ends() {
        let mut rng = Rng::new(9);
        let mut low = false;
        let mut high = false;
        for _ in 0..100_000 {
            match rng.range(0, 9) {
                0 => low = true,
                9 => high = true,
                _ => {}
            }
        }
        assert!(low && high, "endpoints were never drawn");
    }

    #[test]
    fn shuffle_keeps_every_element() {
        let mut rng = Rng::new(11);
        for _ in 0..1000 {
            let mut items: Vec<i32> = (0..8).collect();
            rng.shuffle(&mut items);
            items.sort();
            assert_eq!(items, (0..8).collect::<Vec<i32>>());
        }
    }

    #[test]
    fn shuffle_is_roughly_uniform() {
        // Each of 6 elements should land first about 1/6 of the time.
        let mut rng = Rng::new(13);
        let draws = 60_000;
        let mut first = [0u32; 6];
        for _ in 0..draws {
            let mut items: Vec<usize> = (0..6).collect();
            rng.shuffle(&mut items);
            first[items[0]] += 1;
        }
        let expected = draws as f64 / 6.0;
        for (value, count) in first.iter().enumerate() {
            let drift = (*count as f64 - expected).abs() / expected;
            assert!(drift < 0.1, "element {value} landed first {count} times");
        }
    }
}
