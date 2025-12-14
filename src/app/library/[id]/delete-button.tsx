"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteDocument } from "@/actions/documents";

interface DeleteButtonProps {
  documentId: string;
}

export function DeleteButton({ documentId }: DeleteButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm("Are you sure you want to delete this document? This action cannot be undone.")) {
      return;
    }

    startTransition(async () => {
      try {
        await deleteDocument(documentId);
        router.push("/library");
      } catch (error) {
        console.error("Failed to delete document:", error);
        alert("Failed to delete document. Please try again.");
      }
    });
  };

  return (
    <Button 
      variant="destructive" 
      size="sm" 
      onClick={handleDelete}
      disabled={isPending}
      className="gap-2"
    >
      <Trash2 className="h-4 w-4" />
      {isPending ? "Deleting..." : "Delete Document"}
    </Button>
  );
}
