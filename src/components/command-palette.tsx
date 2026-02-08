"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileText, Video, Globe, Network, MessageSquare, Search, Command } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { globalSearch, type SearchResult } from "@/actions/search";

const typeIcons: Record<string, typeof Globe> = {
  document: FileText,
  entity: Network,
  chat: MessageSquare,
};

const subtypeIcons: Record<string, typeof Globe> = {
  article: Globe,
  youtube: Video,
  pdf: FileText,
  note: FileText,
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await globalSearch(query);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setResults([]);
      router.push(href);
    },
    [router]
  );

  const docResults = results.filter((r) => r.type === "document");
  const entityResults = results.filter((r) => r.type === "entity");
  const chatResults = results.filter((r) => r.type === "chat");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 text-sm text-muted-foreground border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search...</span>
        <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <Command className="h-3 w-3" />K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search documents, entities, chats..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {!query.trim() && (
            <CommandEmpty>
              Type to search across your knowledge base
            </CommandEmpty>
          )}
          {query.trim() && results.length === 0 && !isSearching && (
            <CommandEmpty>No results found</CommandEmpty>
          )}

          {docResults.length > 0 && (
            <CommandGroup heading="Documents">
              {docResults.map((r) => {
                const Icon = subtypeIcons[r.subtype || ""] || FileText;
                return (
                  <CommandItem
                    key={r.id}
                    value={`doc-${r.id}-${r.title}`}
                    onSelect={() => handleSelect(r.href)}
                  >
                    <Icon className="h-4 w-4 mr-2 shrink-0" />
                    <div className="min-w-0">
                      <span className="truncate">{r.title}</span>
                      {r.description && (
                        <span className="block text-xs text-muted-foreground truncate">
                          {r.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {entityResults.length > 0 && (
            <CommandGroup heading="Entities">
              {entityResults.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`entity-${r.id}-${r.title}`}
                  onSelect={() => handleSelect(r.href)}
                >
                  <Network className="h-4 w-4 mr-2 shrink-0" />
                  <div className="min-w-0">
                    <span className="truncate">{r.title}</span>
                    {r.subtype && (
                      <span className="ml-2 text-xs text-muted-foreground capitalize">
                        ({r.subtype})
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {chatResults.length > 0 && (
            <CommandGroup heading="Chats">
              {chatResults.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`chat-${r.id}-${r.title}`}
                  onSelect={() => handleSelect(r.href)}
                >
                  <MessageSquare className="h-4 w-4 mr-2 shrink-0" />
                  <span className="truncate">{r.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Quick navigation */}
          {!query.trim() && (
            <CommandGroup heading="Quick Navigation">
              <CommandItem onSelect={() => handleSelect("/library")}>
                <FileText className="h-4 w-4 mr-2" />
                Library
              </CommandItem>
              <CommandItem onSelect={() => handleSelect("/graph")}>
                <Network className="h-4 w-4 mr-2" />
                Knowledge Graph
              </CommandItem>
              <CommandItem onSelect={() => handleSelect("/chat")}>
                <MessageSquare className="h-4 w-4 mr-2" />
                Chat
              </CommandItem>
              <CommandItem onSelect={() => handleSelect("/add")}>
                <Search className="h-4 w-4 mr-2" />
                Add Content
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
