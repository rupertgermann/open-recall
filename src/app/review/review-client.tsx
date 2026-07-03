"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Loader2 } from "lucide-react";
import { reviewSrsItem, type DueSrsCard } from "@/actions/srs";
import { SRS_RATINGS, type SrsRating } from "@/lib/srs/scheduler";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ratingButtons: { rating: SrsRating; label: string; variant: "destructive" | "outline" | "secondary" | "default" }[] = [
  { rating: SRS_RATINGS.again, label: "Again", variant: "destructive" },
  { rating: SRS_RATINGS.hard, label: "Hard", variant: "outline" },
  { rating: SRS_RATINGS.good, label: "Good", variant: "secondary" },
  { rating: SRS_RATINGS.easy, label: "Easy", variant: "default" },
];

export function ReviewClient({ initialCards }: { initialCards: DueSrsCard[] }) {
  const [cards, setCards] = useState(initialCards);
  const [showAnswer, setShowAnswer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const current = cards[0];

  const handleReview = (rating: SrsRating) => {
    if (!current) return;

    setError(null);
    startTransition(async () => {
      try {
        const result = await reviewSrsItem(current.id, rating);
        if (!result.success) {
          setError(result.error ?? "Failed to review flashcard");
          return;
        }

        setCards((queue) => queue.filter((card) => card.id !== current.id));
        setShowAnswer(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to review flashcard");
      }
    });
  };

  if (!current) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-primary" />
          <h1 className="text-2xl font-semibold">No cards due</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Generate flashcards from document detail pages to build your review queue.
          </p>
          <Button asChild className="mt-6">
            <Link href="/library">Open Library</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review</h1>
        <p className="text-muted-foreground">
          {cards.length} due card{cards.length === 1 ? "" : "s"}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">{current.question}</CardTitle>
              <CardDescription className="mt-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                <Link href={`/library/${current.documentId}`} className="hover:underline">
                  {current.documentTitle}
                </Link>
              </CardDescription>
            </div>
            <Badge variant="outline">
              {current.reps} review{current.reps === 1 ? "" : "s"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="min-h-40 rounded-lg border bg-muted/30 p-6">
            {showAnswer ? (
              <p className="whitespace-pre-wrap text-base leading-7">{current.answer}</p>
            ) : (
              <div className="flex h-28 items-center justify-center">
                <Button onClick={() => setShowAnswer(true)}>Show answer</Button>
              </div>
            )}
          </div>

          {showAnswer && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ratingButtons.map((button) => (
                <Button
                  key={button.rating}
                  variant={button.variant}
                  disabled={isPending}
                  onClick={() => handleReview(button.rating)}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {button.label}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
