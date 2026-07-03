import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FLASHCARD_COUNT,
  MAX_FLASHCARD_SOURCE_CHARS,
  buildFlashcardSource,
  normalizeFlashcardCount,
  shapeGeneratedFlashcards,
} from "../src/lib/srs/flashcards.ts";
import {
  SRS_RATINGS,
  SRS_STATES,
  scheduleSrsReview,
  type SrsScheduleInput,
} from "../src/lib/srs/scheduler.ts";
import { countDueCardsByDocument } from "../src/lib/srs/due-counts.ts";

test("normalizeFlashcardCount clamps unsafe requested counts", () => {
  assert.equal(normalizeFlashcardCount(undefined), 5);
  assert.equal(normalizeFlashcardCount(0), 1);
  assert.equal(normalizeFlashcardCount(3.8), 3);
  assert.equal(normalizeFlashcardCount(999), MAX_FLASHCARD_COUNT);
});

test("buildFlashcardSource prefers document text and caps prompt size", () => {
  const source = buildFlashcardSource({
    title: "  Test driven notes  ",
    summary: " A compact summary. ",
    content: "x".repeat(MAX_FLASHCARD_SOURCE_CHARS * 2),
    chunks: ["chunk one", "chunk two"],
  });

  assert.match(source, /^Title:\nTest driven notes\n\nSummary:\nA compact summary\./);
  assert.equal(source.length, MAX_FLASHCARD_SOURCE_CHARS);
});

test("shapeGeneratedFlashcards trims, deduplicates, and drops empty cards", () => {
  const shaped = shapeGeneratedFlashcards([
    { question: " What is SRS? ", answer: " Spaced repetition. " },
    { question: "what is srs?", answer: "Duplicate question." },
    { question: "", answer: "Missing question" },
    { question: "Missing answer", answer: "  " },
  ]);

  assert.deepEqual(shaped, [
    { question: "What is SRS?", answer: "Spaced repetition." },
  ]);
});

test("scheduleSrsReview moves a new card to review on good rating", () => {
  const now = new Date("2026-07-03T10:00:00.000Z");
  const card: SrsScheduleInput = {
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: SRS_STATES.new,
    dueDate: now,
    lastReviewDate: null,
  };

  const next = scheduleSrsReview(card, SRS_RATINGS.good, now);

  assert.equal(next.state, SRS_STATES.review);
  assert.equal(next.reps, 1);
  assert.equal(next.lapses, 0);
  assert.equal(next.scheduledDays, 1);
  assert.equal(next.dueDate.toISOString(), "2026-07-04T10:00:00.000Z");
  assert.equal(next.lastReviewDate.toISOString(), now.toISOString());
});

test("scheduleSrsReview sends a failed review card to relearning", () => {
  const now = new Date("2026-07-03T10:00:00.000Z");
  const card: SrsScheduleInput = {
    stability: 5,
    difficulty: 4,
    reps: 3,
    lapses: 1,
    state: SRS_STATES.review,
    dueDate: now,
    lastReviewDate: new Date("2026-06-28T10:00:00.000Z"),
  };

  const next = scheduleSrsReview(card, SRS_RATINGS.again, now);

  assert.equal(next.state, SRS_STATES.relearning);
  assert.equal(next.reps, 4);
  assert.equal(next.lapses, 2);
  assert.equal(next.scheduledDays, 0);
  assert.equal(next.dueDate.toISOString(), "2026-07-03T10:05:00.000Z");
  assert.equal(next.elapsedDays, 5);
});

test("scheduleSrsReview makes easy reviews farther out than good reviews", () => {
  const now = new Date("2026-07-03T10:00:00.000Z");
  const card: SrsScheduleInput = {
    stability: 4,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    state: SRS_STATES.review,
    dueDate: now,
    lastReviewDate: new Date("2026-07-01T10:00:00.000Z"),
  };

  const good = scheduleSrsReview(card, SRS_RATINGS.good, now);
  const easy = scheduleSrsReview(card, SRS_RATINGS.easy, now);

  assert.equal(good.state, SRS_STATES.review);
  assert.equal(easy.state, SRS_STATES.review);
  assert.ok(easy.scheduledDays > good.scheduledDays);
});

test("countDueCardsByDocument aggregates only cards due at or before now", () => {
  const now = new Date("2026-07-03T10:00:00.000Z");

  assert.deepEqual(
    countDueCardsByDocument(
      [
        { documentId: "doc-a", dueDate: new Date("2026-07-03T09:59:59.000Z") },
        { documentId: "doc-a", dueDate: new Date("2026-07-03T10:00:00.000Z") },
        { documentId: "doc-a", dueDate: new Date("2026-07-03T10:00:01.000Z") },
        { documentId: "doc-b", dueDate: "2026-07-02T10:00:00.000Z" },
      ],
      now
    ),
    { "doc-a": 2, "doc-b": 1 }
  );
});
