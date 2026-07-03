const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_DELAY_MS = 5 * 60 * 1000;

export const SRS_STATES = {
  new: 0,
  learning: 1,
  review: 2,
  relearning: 3,
} as const;

export const SRS_RATINGS = {
  again: "again",
  hard: "hard",
  good: "good",
  easy: "easy",
} as const;

export type SrsState = (typeof SRS_STATES)[keyof typeof SRS_STATES];
export type SrsRating = (typeof SRS_RATINGS)[keyof typeof SRS_RATINGS];

export type SrsScheduleInput = {
  stability?: number | null;
  difficulty?: number | null;
  reps?: number | null;
  lapses?: number | null;
  state?: number | null;
  dueDate: Date;
  lastReviewDate?: Date | null;
};

export type SrsScheduleResult = {
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: SrsState;
  dueDate: Date;
  lastReviewDate: Date;
};

export function scheduleSrsReview(
  card: SrsScheduleInput,
  rating: SrsRating,
  now: Date
): SrsScheduleResult {
  const state = normalizeState(card.state);
  const stability = positiveNumber(card.stability, 0);
  const difficulty = clamp(positiveNumber(card.difficulty, 5), 1, 10);
  const elapsedDays = card.lastReviewDate
    ? Math.max(0, Math.floor((now.getTime() - card.lastReviewDate.getTime()) / DAY_MS))
    : 0;

  if (rating === SRS_RATINGS.again) {
    return {
      stability: roundOneDecimal(Math.max(0.4, stability * 0.45)),
      difficulty: roundOneDecimal(clamp(difficulty + 1.2, 1, 10)),
      elapsedDays,
      scheduledDays: 0,
      reps: positiveInteger(card.reps) + 1,
      lapses: positiveInteger(card.lapses) + (state === SRS_STATES.new ? 0 : 1),
      state: state === SRS_STATES.review ? SRS_STATES.relearning : SRS_STATES.learning,
      dueDate: new Date(now.getTime() + AGAIN_DELAY_MS),
      lastReviewDate: new Date(now),
    };
  }

  const scheduledDays = getScheduledDays(state, stability, rating);
  const nextStability = getNextStability(stability, scheduledDays, rating);

  return {
    stability: nextStability,
    difficulty: getNextDifficulty(difficulty, rating),
    elapsedDays,
    scheduledDays,
    reps: positiveInteger(card.reps) + 1,
    lapses: positiveInteger(card.lapses),
    state: rating === SRS_RATINGS.hard && state === SRS_STATES.new
      ? SRS_STATES.learning
      : SRS_STATES.review,
    dueDate: addDays(now, scheduledDays),
    lastReviewDate: new Date(now),
  };
}

function getScheduledDays(state: SrsState, stability: number, rating: SrsRating): number {
  if (state === SRS_STATES.new || state === SRS_STATES.learning || state === SRS_STATES.relearning) {
    if (rating === SRS_RATINGS.hard) return 1;
    if (rating === SRS_RATINGS.good) return 1;
    return 4;
  }

  const base = Math.max(1, stability);
  if (rating === SRS_RATINGS.hard) return Math.max(1, Math.round(base * 1.2));
  if (rating === SRS_RATINGS.good) return Math.max(1, Math.round(base * 2.5));
  return Math.max(2, Math.round(base * 3.5));
}

function getNextStability(stability: number, scheduledDays: number, rating: SrsRating): number {
  const base = Math.max(1, stability);
  if (rating === SRS_RATINGS.hard) return roundOneDecimal(Math.max(1, base * 1.15));
  if (rating === SRS_RATINGS.good) return roundOneDecimal(Math.max(scheduledDays, base * 1.9));
  return roundOneDecimal(Math.max(scheduledDays, base * 2.5));
}

function getNextDifficulty(difficulty: number, rating: SrsRating): number {
  if (rating === SRS_RATINGS.hard) return roundOneDecimal(clamp(difficulty + 0.6, 1, 10));
  if (rating === SRS_RATINGS.good) return roundOneDecimal(clamp(difficulty - 0.2, 1, 10));
  return roundOneDecimal(clamp(difficulty - 0.8, 1, 10));
}

function normalizeState(state?: number | null): SrsState {
  if (
    state === SRS_STATES.learning ||
    state === SRS_STATES.review ||
    state === SRS_STATES.relearning
  ) {
    return state;
  }

  return SRS_STATES.new;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function positiveInteger(value?: number | null): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0;
}

function positiveNumber(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== null && value !== undefined && value > 0
    ? value
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
