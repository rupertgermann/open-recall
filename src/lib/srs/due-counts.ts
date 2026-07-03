export type DueCountCard = {
  documentId: string;
  dueDate: Date | string;
};

export function countDueCardsByDocument(
  cards: DueCountCard[],
  now: Date
): Record<string, number> {
  const nowMs = now.getTime();
  const counts: Record<string, number> = {};

  for (const card of cards) {
    const dueDate = typeof card.dueDate === "string" ? new Date(card.dueDate) : card.dueDate;

    if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() > nowMs) {
      continue;
    }

    counts[card.documentId] = (counts[card.documentId] ?? 0) + 1;
  }

  return counts;
}
