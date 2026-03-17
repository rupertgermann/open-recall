import { getDiscoverSnapshot } from "@/actions/discover";
import { DiscoverClient } from "@/components/discover/discover-client";
import { Header } from "@/components/layout/header";

export default async function DiscoverPage() {
  const initialData = await getDiscoverSnapshot();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto max-w-7xl px-4 py-8">
        <DiscoverClient initialData={initialData} />
      </main>
    </div>
  );
}
