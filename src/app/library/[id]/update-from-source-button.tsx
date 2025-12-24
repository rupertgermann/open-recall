"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { updateDocumentFromSource } from "@/actions/documents";

export function UpdateFromSourceButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      try {
        const res = await updateDocumentFromSource(documentId);
        if (!res.success) {
          throw new Error(res.error || "Failed to update document");
        }
        toast({
          title: "Updated from source",
          description: "The document was refreshed.",
        });
        router.refresh();
      } catch (e) {
        toast({
          title: "Update failed",
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
