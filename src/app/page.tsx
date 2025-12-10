import { Brain, Plus, MessageSquare, Network, BookOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/40 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold">open-recall</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/library">
              <Button variant="ghost">Library</Button>
            </Link>
            <Link href="/graph">
              <Button variant="ghost">Graph</Button>
            </Link>
            <Link href="/chat">
              <Button variant="ghost">Chat</Button>
            </Link>
            <Link href="/settings">
              <Button variant="ghost">Settings</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <h1 className="text-5xl font-bold tracking-tight">
            Your Knowledge, <span className="text-primary">Your Control</span>
          </h1>
          <p className="text-xl text-muted-foreground">
            Privacy-focused Personal Knowledge Management powered by local AI.
            Save, summarize, and connect your digital content with GraphRAG.
          </p>

          <div className="flex justify-center gap-4">
            <Link href="/add">
              <Button size="lg" className="gap-2">
                <Plus className="h-5 w-5" />
                Add Content
              </Button>
            </Link>
            <Link href="/chat">
              <Button size="lg" variant="outline" className="gap-2">
                <MessageSquare className="h-5 w-5" />
                Start Chat
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mt-24">
          <FeatureCard
            icon={<Network className="h-10 w-10" />}
            title="GraphRAG"
            description="Automatically extract entities and relationships to build a semantic knowledge graph from your content."
          />
          <FeatureCard
            icon={<Brain className="h-10 w-10" />}
            title="Local AI"
            description="Run everything locally with Ollama. Your data never leaves your machine."
          />
          <FeatureCard
            icon={<BookOpen className="h-10 w-10" />}
            title="Spaced Repetition"
            description="Generate flashcards and review with FSRS algorithm for optimal retention."
          />
        </div>
      </main>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-lg border text-card-foreground glass-card">
      <div className="text-primary mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
