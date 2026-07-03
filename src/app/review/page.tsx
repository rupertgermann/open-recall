import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listDueSrsItems } from "@/actions/srs";
import { Header } from "@/components/layout/header";
import { ReviewClient } from "./review-client";

export default async function ReviewPage() {
  const dueCards = await listDueSrsItems(50);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <Link href="/library" className="mb-6 inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </Link>

          <ReviewClient initialCards={dueCards} />
        </div>
      </main>
    </div>
  );
}
