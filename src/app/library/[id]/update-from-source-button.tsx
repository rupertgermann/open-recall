"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function UpdateFromSourceButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      try {
        // Navigate to add module with update parameters
        router.push(`/add?update=${documentId}&start=1`);
      } catch (e) {
        toast({
          title: "Navigation failed",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={isPending} className="gap-2">
      <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
      Update from source
    </Button>
  );
}
