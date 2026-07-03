import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeChatSources,
  detectChatCategoryFromContext,
  fallbackTitleFromUserText,
} from "../src/lib/chat/helpers.ts";
import {
  formatKnowledgeBaseSearchResults,
  formatLookupEntityResults,
  formatRelatedDocumentsResults,
} from "../src/lib/chat/tool-results.ts";

test("fallbackTitleFromUserText trims, collapses whitespace, and truncates long titles", () => {
  assert.equal(fallbackTitleFromUserText("  Explain\n\nPostgres   indexes  "), "Explain Postgres indexes");
  assert.equal(fallbackTitleFromUserText(" \n\t "), "New chat");

  const longText = "a".repeat(80);
  assert.equal(fallbackTitleFromUserText(longText), `${"a".repeat(57)}...`);
});

test("dedupeChatSources keeps the highest-scoring source per document", () => {
  const sources = dedupeChatSources([
    { documentId: "doc-a", documentTitle: "Alpha low", score: 0.2 },
    { documentId: "doc-b", documentTitle: "Beta", score: 0.7 },
    { documentId: "doc-a", documentTitle: "Alpha high", score: 0.9 },
    { documentId: "doc-a", documentTitle: "Alpha later", score: 0.4 },
  ]);

  assert.deepEqual(sources, [
    { documentId: "doc-a", title: "Alpha high", score: 0.9 },
    { documentId: "doc-b", title: "Beta", score: 0.7 },
  ]);
});

test("detectChatCategoryFromContext prefers entities, then the most referenced document", () => {
  assert.deepEqual(
    detectChatCategoryFromContext({
      entities: [{ id: "entity-a" }],
      chunks: [{ documentId: "doc-a" }],
    }),
    { category: "entity", entityId: "entity-a" }
  );

  assert.deepEqual(
    detectChatCategoryFromContext({
      entities: [],
      chunks: [
        { documentId: "doc-a" },
        { documentId: "doc-b" },
        { documentId: "doc-b" },
      ],
    }),
    { category: "document", documentId: "doc-b" }
  );

  assert.deepEqual(detectChatCategoryFromContext({ entities: [], chunks: [] }), {
    category: "general",
  });
});

test("formatKnowledgeBaseSearchResults formats document rows and empty state", () => {
  assert.equal(formatKnowledgeBaseSearchResults([]), "No documents found matching the query.");

  assert.equal(
    formatKnowledgeBaseSearchResults([
      { title: "Deep Modules", type: "article", summary: "s".repeat(220) },
      { title: "Scratchpad", type: "note", summary: null },
    ]),
    `[Deep Modules] (article): ${"s".repeat(200)}\n\n[Scratchpad] (note): No summary`
  );
});

test("formatLookupEntityResults formats entity rows and query-specific empty state", () => {
  assert.equal(formatLookupEntityResults([], "SQLite"), 'No entity found matching "SQLite".');

  assert.equal(
    formatLookupEntityResults([
      { name: "PostgreSQL", type: "technology", description: "Relational database" },
      { name: "MVCC", type: "concept", description: null },
    ], "postgres"),
    "**PostgreSQL** (technology): Relational database\n\n**MVCC** (concept): No description"
  );
});

test("formatRelatedDocumentsResults formats date, summary truncation, and empty state", () => {
  const createdAt = new Date("2024-02-03T12:00:00Z");

  assert.equal(formatRelatedDocumentsResults([], "database"), 'No documents found related to "database".');
  assert.equal(
    formatRelatedDocumentsResults([
      { title: "Roadmap", type: "note", summary: "r".repeat(180), createdAt },
      { title: "Empty", type: "pdf", summary: null, createdAt },
    ], "roadmap"),
    `- **Roadmap** (note, ${createdAt.toLocaleDateString()}): ${"r".repeat(150)}...\n- **Empty** (pdf, ${createdAt.toLocaleDateString()}): No summary...`
  );
});
