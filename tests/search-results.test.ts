import assert from "node:assert/strict";
import test from "node:test";

import { buildGlobalSearchResults } from "../src/lib/search/results.ts";

test("buildGlobalSearchResults shapes result types, hrefs, subtypes, and descriptions", () => {
  const results = buildGlobalSearchResults({
    documents: [
      {
        id: "doc-1",
        title: "Architecture Notes",
        type: "note",
        summary: "d".repeat(120),
      },
    ],
    entities: [
      {
        id: "entity-1",
        name: "PostgreSQL",
        type: "technology",
        description: "e".repeat(105),
      },
    ],
    chats: [
      {
        id: "chat-1",
        title: "Database planning",
        category: "general",
      },
    ],
  });

  assert.deepEqual(results, [
    {
      id: "doc-1",
      title: "Architecture Notes",
      type: "document",
      subtype: "note",
      description: "d".repeat(100),
      href: "/library/doc-1",
    },
    {
      id: "entity-1",
      title: "PostgreSQL",
      type: "entity",
      subtype: "technology",
      description: "e".repeat(100),
      href: "/graph?entity=entity-1",
    },
    {
      id: "chat-1",
      title: "Database planning",
      type: "chat",
      subtype: "general",
      href: "/chat/chat-1",
    },
  ]);
});

test("buildGlobalSearchResults omits empty descriptions", () => {
  const results = buildGlobalSearchResults({
    documents: [
      {
        id: "doc-1",
        title: "Untitled",
        type: "note",
        summary: "",
      },
    ],
    entities: [
      {
        id: "entity-1",
        name: "No Description",
        type: "concept",
        description: null,
      },
    ],
    chats: [],
  });

  assert.deepEqual(results, [
    {
      id: "doc-1",
      title: "Untitled",
      type: "document",
      subtype: "note",
      href: "/library/doc-1",
    },
    {
      id: "entity-1",
      title: "No Description",
      type: "entity",
      subtype: "concept",
      href: "/graph?entity=entity-1",
    },
  ]);
});
