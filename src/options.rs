//! Quiz options: the answer plus three near misses, in a random order.
//!
//! The four are a pattern of four numbers out of `WINDOW` in a row, laid
//! over the answer so that it is equally likely to be the smallest of them,
//! the largest or either one between, whatever the pattern. Where it falls
//! among them says nothing about which one it is.

use crate::rng::Rng;

/// The options are four of this many numbers in a row, so none is more than
/// `WINDOW - 1` from the answer.
const WINDOW: usize = 6;
pub const COUNT: usize = 4;

/// No option is below `floor`, so a task without negative numbers does not
/// offer one as a possible answer. Within three of the floor there is not
/// room for every rank, and the answer takes the ranks there is room for,
/// each as likely as the others.
pub fn quiz_options(answer: i64, floor: i64, rng: &mut Rng) -> Vec<i64> {
    // How many options are below the answer. Every number from the floor up
    // to the answer is a place for one, and there are three to place.
    let reach = answer.saturating_sub(floor);
    let rank = rng.below(reach.min(COUNT as i64 - 1) as u64 + 1) as usize;

    // Four numbers in a row always fit, so this ends.
    let mut window: [i64; WINDOW] = [0, 1, 2, 3, 4, 5];
    let pattern = loop {
        rng.shuffle(&mut window);
        let pattern = &mut window[..COUNT];
        pattern.sort_unstable();
        if pattern[rank] - pattern[0] <= reach {
            break pattern;
        }
    };

    let place = pattern[rank];
    let mut options: Vec<i64> = pattern.iter().map(|&p| answer + p - place).collect();
    rng.shuffle(&mut options);
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Where the answer ranks among the options, 0 for the smallest.
    fn rank(options: &[i64], answer: i64) -> usize {
        options.iter().filter(|&&o| o < answer).count()
    }

    #[test]
    fn there_are_always_four_distinct_options() {
        for seed in 0..5000 {
            let mut rng = Rng::new(seed);
            let answer = (seed as i64) % 97 - 48;
            let options = quiz_options(answer, i64::MIN, &mut rng);
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
            assert!(quiz_options(answer, i64::MIN, &mut rng).contains(&answer));
        }
    }

    #[test]
    fn every_option_is_near_the_answer() {
        for seed in 0..5000 {
            let mut rng = Rng::new(seed);
            let options = quiz_options(-10_000, i64::MIN, &mut rng);
            let furthest = options.iter().map(|o| (o + 10_000).abs()).max().unwrap();
            assert!(furthest < WINDOW as i64, "{options:?}");
        }
    }

    #[test]
    fn no_option_falls_below_the_floor() {
        for seed in 0..5000 {
            let mut rng = Rng::new(seed);
            let answer = (seed as i64) % 8;
            let options = quiz_options(answer, 0, &mut rng);
            assert!(options.iter().all(|&o| o >= 0), "{options:?} for {answer}");
            assert!(options.contains(&answer));
            let mut sorted = options.clone();
            sorted.sort();
            sorted.dedup();
            assert_eq!(sorted.len(), COUNT, "duplicates in {options:?}");
        }
    }

    #[test]
    fn the_answer_does_not_sit_in_one_place() {
        let mut positions = [0u32; COUNT];
        for seed in 0..8000 {
            let mut rng = Rng::new(seed);
            let options = quiz_options(12, i64::MIN, &mut rng);
            let at = options.iter().position(|o| *o == 12).unwrap();
            positions[at] += 1;
        }
        let expected = 8000.0 / COUNT as f64;
        for (slot, count) in positions.iter().enumerate() {
            let drift = (*count as f64 - expected).abs() / expected;
            assert!(drift < 0.1, "answer landed in slot {slot} {count} times");
        }
    }

    #[test]
    fn the_options_alone_do_not_tell_which_is_the_answer() {
        // For every shape the four can take, the answer has to be as likely
        // to be the smallest of them as the second, third or largest, or a
        // pupil could pick by the shape without working anything out.
        let mut by_shape = std::collections::HashMap::new();
        for seed in 0..60_000 {
            let mut rng = Rng::new(seed);
            let mut options = quiz_options(12, i64::MIN, &mut rng);
            let at = rank(&options, 12);
            options.sort();
            let shape: Vec<i64> = options.iter().map(|o| o - options[0]).collect();
            by_shape.entry(shape).or_insert([0u32; COUNT])[at] += 1;
        }
        assert_eq!(by_shape.len(), 10, "every four of six in a row");
        for (shape, ranks) in &by_shape {
            let expected = ranks.iter().sum::<u32>() as f64 / COUNT as f64;
            for (at, count) in ranks.iter().enumerate() {
                let drift = (*count as f64 - expected).abs() / expected;
                assert!(drift < 0.15, "{shape:?}: answer ranked {at} {count} times");
            }
        }
    }

    #[test]
    fn near_the_floor_the_answer_takes_every_rank_there_is_room_for() {
        // 0 can only be the smallest; 2 can be any but the largest, since
        // only 0 and 1 are below it.
        for seed in 0..1000 {
            let options = quiz_options(0, 0, &mut Rng::new(seed));
            assert_eq!(rank(&options, 0), 0, "{options:?}");
        }
        let mut ranks = [0u32; COUNT];
        for seed in 0..9000 {
            let options = quiz_options(2, 0, &mut Rng::new(seed));
            ranks[rank(&options, 2)] += 1;
        }
        assert!(
            ranks[..3].iter().all(|&count| count.abs_diff(3000) < 300),
            "{ranks:?}"
        );
        assert_eq!(ranks[3], 0, "{ranks:?}");
    }
}
