"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatAboutButtonProps {
  entityId?: string;
  entityName?: string;
  documentId?: string;
  documentTitle?: string;
}

export function ChatAboutButton({
  entityId,
  entityName,
  documentId,
  documentTitle,
}: ChatAboutButtonProps) {
  const router = useRouter();
  const { toast } = useToast();

  const handleClick = async () => {
    try {
      const response = await fetch("/api/chats/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: entityId ? "entity" : "document",
          entityId: entityId || null,
          documentId: documentId || null,
          title: entityId 
            ? `Chat about ${entityName || "this entity"}`
            : `Chat about ${documentTitle || "this document"}`,
        }),
      });

      if (response.ok) {
        const { thread } = await response.json();
        router.push(`/chat/${thread.id}`);
      } else {
        throw new Error("Failed to create chat");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create chat. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={handleClick}>
      <MessageSquare className="h-4 w-4" />
      Chat about this
    </Button>
  );
}
