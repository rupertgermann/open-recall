export const DEFAULT_FLASHCARD_COUNT = 5;
export const MAX_FLASHCARD_COUNT = 12;
export const MAX_FLASHCARD_SOURCE_CHARS = 12_000;
export const MAX_FLASHCARD_QUESTION_CHARS = 500;
export const MAX_FLASHCARD_ANSWER_CHARS = 1_200;

export type FlashcardSourceInput = {
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  chunks?: string[];
};

export type GeneratedFlashcard = {
  question: string;
  answer: string;
};

export function normalizeFlashcardCount(count?: number): number {
  if (!Number.isFinite(count)) {
    return DEFAULT_FLASHCARD_COUNT;
  }

  return Math.min(MAX_FLASHCARD_COUNT, Math.max(1, Math.floor(count as number)));
}

export function buildFlashcardSource(
  input: FlashcardSourceInput,
  maxChars = MAX_FLASHCARD_SOURCE_CHARS
): string {
  const sections: string[] = [];
  const title = cleanSourceText(input.title);
  const summary = cleanSourceText(input.summary);
  const content = cleanSourceText(input.content);
  const chunkText = cleanSourceText(input.chunks?.join("\n\n"));

  if (title) sections.push(`Title:\n${title}`);
  if (summary) sections.push(`Summary:\n${summary}`);
  if (content) {
    sections.push(`Content:\n${content}`);
  } else if (chunkText) {
    sections.push(`Content chunks:\n${chunkText}`);
  }

  return sections.join("\n\n").slice(0, maxChars).trimEnd();
}

export function shapeGeneratedFlashcards(
  flashcards: GeneratedFlashcard[],
  limit = MAX_FLASHCARD_COUNT
): GeneratedFlashcard[] {
  const seenQuestions = new Set<string>();
  const shaped: GeneratedFlashcard[] = [];

  for (const card of flashcards) {
    const question = cleanCardText(card.question).slice(0, MAX_FLASHCARD_QUESTION_CHARS).trimEnd();
    const answer = cleanCardText(card.answer).slice(0, MAX_FLASHCARD_ANSWER_CHARS).trimEnd();
    const questionKey = question.toLocaleLowerCase();

    if (!question || !answer || seenQuestions.has(questionKey)) {
      continue;
    }

    shaped.push({ question, answer });
    seenQuestions.add(questionKey);

    if (shaped.length >= normalizeFlashcardCount(limit)) {
      break;
    }
  }

  return shaped;
}

function cleanSourceText(value?: string | null): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function cleanCardText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
