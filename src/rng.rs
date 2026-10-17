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

/// SplitMix64, which turns each step of a counter into a well-mixed number.
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

impl Rng {
    /// The seed is mixed into both the starting state and the stream before
    /// anything is drawn. Used as they are, consecutive seeds give states a
    /// constant step apart, and the high bits PCG32 outputs are then a
    /// counting sequence: the tasks of a batch, which are the tasks for
    /// consecutive seeds, would follow a pattern.
    pub fn new(seed: u64) -> Self {
        let mut mixer = seed;
        let start = splitmix64(&mut mixer);
        let stream = splitmix64(&mut mixer);
        let mut rng = Rng {
            state: 0,
            inc: (stream << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(start);
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

    /// Uniform in `0..bound`, without the bias `% bound` on its own would
    /// give the low end of the range.
    ///
    /// A bound that fits 32 bits, which is every one the generator asks for,
    /// takes one draw and a multiplication (Lemire's method), and divides
    /// only on the rare draw that lands in the biased sliver. Division is
    /// the slow instruction in WebAssembly, and a 64-bit rejection loop
    /// does two of it on every call.
    pub fn below(&mut self, bound: u64) -> u64 {
        assert!(bound > 0, "bound must be positive");
        if bound <= u32::MAX as u64 {
            let bound = bound as u32;
            let mut product = self.next_u32() as u64 * bound as u64;
            if (product as u32) < bound {
                let threshold = bound.wrapping_neg() % bound;
                while (product as u32) < threshold {
                    product = self.next_u32() as u64 * bound as u64;
                }
            }
            return product >> 32;
        }
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
        let span = (high.wrapping_sub(low) as u64).wrapping_add(1);
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
    fn tasks_for_consecutive_seeds_are_independent() {
        // A batch is the tasks for seed, seed + 1, seed + 2... so what one
        // seed draws must say nothing about the next. A state that is only
        // the seed, stepped, makes the high bits of consecutive seeds a
        // counting sequence, and a worksheet then repeats a pattern.
        const SIDE: usize = 11;
        let draws = 120_000u64;
        let mut cells = [[0u32; SIDE]; SIDE];
        for seed in 0..draws {
            let first = Rng::new(seed).below(SIDE as u64) as usize;
            let next = Rng::new(seed + 1).below(SIDE as u64) as usize;
            cells[first][next] += 1;
        }
        let expected = draws as f64 / (SIDE * SIDE) as f64;
        let chi_squared: f64 = cells
            .iter()
            .flatten()
            .map(|&count| (count as f64 - expected).powi(2) / expected)
            .sum();
        // 120 degrees of freedom: mean 120, deviation about 15.5.
        assert!(chi_squared < 200.0, "chi-squared {chi_squared}");
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
    fn below_is_uniform_whatever_the_size_of_the_bound() {
        // 7 and 10 000 do not divide 2^32, so a draw reduced with `%` alone
        // would favour the low end; a bound past 32 bits takes the other
        // path.
        for bound in [7u64, 10_000, (1 << 33) + 5] {
            let mut rng = Rng::new(bound);
            let draws = 200_000u32;
            let buckets = bound.min(8) as usize;
            let mut counts = vec![0u32; buckets];
            for _ in 0..draws {
                let value = rng.below(bound);
                assert!(value < bound);
                counts[(value as u128 * buckets as u128 / bound as u128) as usize] += 1;
            }
            let expected = draws as f64 / buckets as f64;
            for (bucket, &count) in counts.iter().enumerate() {
                let drift = (count as f64 - expected).abs() / expected;
                assert!(drift < 0.05, "bound {bound}: bucket {bucket} drew {count}");
            }
        }
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
