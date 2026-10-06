//! Quiz options: the answer plus three near misses, in a random order.

use crate::rng::Rng;

const NEAR: i64 = 5;
pub const COUNT: usize = 4;

pub fn quiz_options(answer: i64, rng: &mut Rng) -> Vec<i64> {
    let mut options = vec![answer];

    // Ten candidates for three slots, so this finishes quickly; the guard is
    // only there so a future change to NEAR cannot turn it into a hang. The
    // TypeScript version looped on `while [...].includes(fourth)` with no
    // bound at all.
    let mut guard = 0;
    while options.len() < COUNT && guard < 200 {
        guard += 1;
        let offset = rng.range(-NEAR, NEAR);
        if offset == 0 {
            continue;
        }
        let candidate = answer + offset;
        if !options.contains(&candidate) {
            options.push(candidate);
        }
    }

    let mut step = NEAR + 1;
    while options.len() < COUNT {
        let candidate = answer + step;
        if !options.contains(&candidate) {
            options.push(candidate);
        }
        step += 1;
    }

    rng.shuffle(&mut options);
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_are_always_four_distinct_options() {
        for seed in 0..5000 {
            let mut rng = Rng::new(seed);
            let answer = (seed as i64) % 97 - 48;
            let options = quiz_options(answer, &mut rng);
            assert_eq!(options.len(), COUNT);
            let mut sorted = options.clone();
            sorted.sort();
            sorted.dedup();
            assert_eq!(sorted.len(), COUNT, "duplicates in {options:?}");
        }
    }

    #[test]
    fn the_answer_is_always_among_them() {
        for seed in 0..5000 {
            let mut rng = Rng::new(seed);
            let answer = (seed as i64) % 31 - 15;
            assert!(quiz_options(answer, &mut rng).contains(&answer));
        }
    }

    #[test]
    fn the_answer_does_not_sit_in_one_place() {
        let mut positions = [0u32; COUNT];
        for seed in 0..8000 {
            let mut rng = Rng::new(seed);
            let options = quiz_options(12, &mut rng);
            let at = options.iter().position(|o| *o == 12).unwrap();
            positions[at] += 1;
        }
        let expected = 8000.0 / COUNT as f64;
        for (slot, count) in positions.iter().enumerate() {
            let drift = (*count as f64 - expected).abs() / expected;
            assert!(drift < 0.1, "answer landed in slot {slot} {count} times");
        }
    }
}
