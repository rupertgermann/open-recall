"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MessageSquare, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface RelatedChat {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

interface RelatedChatsProps {
  entityId?: string;
  documentId?: string;
}

export function RelatedChats({ entityId, documentId }: RelatedChatsProps) {
  const [chats, setChats] = useState<RelatedChat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChats = async () => {
      try {
        const id = entityId || documentId;
        const type = entityId ? "entity" : "document";
        
        const response = await fetch(`/api/related-chats/${id}?type=${type}`);
        if (response.ok) {
          const data = await response.json();
          setChats(data.chats || []);
        }
      } catch (error) {
        console.error("Failed to fetch related chats:", error);
      } finally {
        setLoading(false);
      }
    };

    if (entityId || documentId) {
      fetchChats();
    }
  }, [entityId, documentId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Related Chats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chats.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Related Chats
          </CardTitle>
          <CardDescription>No previous conversations found</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Related Chats
        </CardTitle>
        <CardDescription>
          {chats.length} previous conversation{chats.length !== 1 ? "s" : ""} found
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {chats.map((chat) => (
            <Link key={chat.id} href={`/chat/${chat.id}`}>
              <div className="p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate">{chat.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {chat.category}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(chat.lastMessageAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
