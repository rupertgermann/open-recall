"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Brain, Loader2, Trash2 } from "lucide-react";
import {
  deleteSrsItem,
  generateDocumentFlashcards,
  type SrsCardListItem,
  type SrsStats,
} from "@/actions/srs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const stateLabels: Record<number, string> = {
  0: "New",
  1: "Learning",
  2: "Review",
  3: "Relearning",
};

export function FlashcardsPanel({
  documentId,
  initialCards,
  initialStats,
}: {
  documentId: string;
  initialCards: SrsCardListItem[];
  initialStats: SrsStats;
}) {
  const [cards, setCards] = useState(initialCards);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const dueCount = useMemo(
    () => cards.filter((card) => isCardDue(card, nowMs)).length,
    [cards, nowMs]
  );
  const totalCount = cards.length || initialStats.total;

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await generateDocumentFlashcards(documentId);
        setCards(result.cards);
        setNowMs(Date.now());
        setError(result.error ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate flashcards");
      }
    });
  };

  const handleDelete = (cardId: string) => {
    setError(null);
    setDeletingId(cardId);
    startTransition(async () => {
      try {
        const result = await deleteSrsItem(cardId);
        if (!result.success) {
          setError(result.error ?? "Failed to delete flashcard");
        } else {
          setCards((current) => current.filter((card) => card.id !== cardId));
          setNowMs(Date.now());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete flashcard");
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Flashcards
            </CardTitle>
            <CardDescription>
              {totalCount} card{totalCount === 1 ? "" : "s"} · {dueCount} due now
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {dueCount > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/review">Review due</Link>
              </Button>
            )}
            <Button size="sm" onClick={handleGenerate} disabled={isPending}>
              {isPending && !deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Generate
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {cards.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            {isPending ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating flashcards...
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No flashcards yet</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map((card) => {
              const isDue = isCardDue(card, nowMs);

              return (
                <div key={card.id} className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={isDue ? "default" : "secondary"}>
                          {isDue ? "Due" : "Scheduled"}
                        </Badge>
                        <Badge variant="outline">{stateLabels[card.state] ?? "New"}</Badge>
                        {card.reps > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {card.reps} review{card.reps === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{card.question}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{card.answer}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(card.id)}
                      disabled={isPending}
                      title="Delete flashcard"
                    >
                      {deletingId === card.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function isCardDue(card: SrsCardListItem, nowMs: number | null): boolean {
  if (nowMs === null) {
    return card.isDue;
  }

  return new Date(card.dueDate).getTime() <= nowMs;
}
