# Product Specification: open-recall

## 1. Overview

**open-recall** is a privacy-focused, local-first Personal Knowledge Management
application. It turns saved web pages and notes into a searchable GraphRAG
knowledge base by extracting readable content, summaries, tags, entities,
relationships, chunks, embeddings, and review cards. Local AI providers are the
default path, and OpenAI can be configured for chat, embeddings, and entity web
research.

## 2. Product Positioning

The application is for users who want AI-assisted knowledge management without
making cloud storage the default. Personal source content, derived graph data,
chat history, flashcards, settings, and metadata live in the local PostgreSQL
database. Cloud AI is opt-in through settings and environment configuration.

## 3. Core Runtime Surfaces

### 3.1 Dashboard

The dashboard summarizes the knowledge base with document, entity, relationship,
chunk, chat, and collection counts. It shows recent documents, recent chats,
document type breakdown, a 30-day activity chart, and quick actions for common
flows.

### 3.2 Library and Document Detail

The library provides document search, type filters, collection filters, card/list
views, persisted view preference, paginated loading, source refresh, and deletion
confirmation. Collection workflows include create, rename, delete, filter,
bulk-assign, and AI-assisted organization with reviewable suggestions.

Document detail pages show the source URL, downloaded lead image, summary,
editable tags, flashcards, chunks, collections, related chats, entities,
relationships, document-scoped chat, graph focus, source refresh, and deletion.

### 3.3 Ingestion

The Add Content page accepts URLs and pasted text. URL mode fetches HTML and
extracts article-like text with Mozilla Readability. Text mode creates note
documents directly from a title and body. The ingestion flow emits streaming
progress events for fetch, chunk, summarize, tag, extract, embed, save, and
complete states.

The entity detail slider maps user intent to extraction budgets, from roughly 25
entities at the low end to roughly 300 entities at the high end. Relationship
budget is twice the entity budget.

Source-backed documents can be refreshed. Refresh compares the current content
hash and embedding model with the stored document metadata, skips derived-data
rebuilds when both match, and rebuilds chunks, tags, mentions, relationships,
and embeddings when either changes.

### 3.4 Knowledge Graph

The graph view is an interactive 2D force graph. It supports entity search,
multi-select entity type filters, tag autocomplete filters, collection filters,
URL-driven entity/document focus, saved camera/selection state, hover
highlighting, selected-node glow, zoom controls, and cluster/detail label
rendering.

Entity panels show type, description, connected entities, mentioned documents,
related chats, graph filtering, contextual chat, and OpenAI-backed entity web
research. Web research returns source previews and routes selected URLs into the
Add Content screen.

### 3.5 Discover

Discover analyzes the stored relationship graph and presents hidden connections,
bridge entities, and knowledge clusters. Hidden connections identify indirect
entity paths through bridge entities. Bridge entities identify highly connected
graph nodes. Knowledge clusters identify connected components and their dominant
entity types.

AI insights stream from the Discover insight API and are stored in
`discover_insights` by normalized entity id sets.

### 3.6 Chat

Chat is persistent and threaded. Threads are categorized as general, entity,
document, or project. The chat sidebar supports category filters, project
filters, debounced search suggestions, thread deletion, and project creation.
Full-page thread views include context back-links, deletion, source/entity
metadata, and starter prompts for entity and document chats.

The chat API retrieves context with vector chunk search, entity name matching,
and graph-neighborhood expansion. Assistant messages store source citations and
entity references. Tool calls can search saved documents, create notes, look up
entities, and find related documents.

### 3.7 Review and Spaced Repetition

Document detail pages generate flashcards from document text, summaries, and
chunks. The review page lists due flashcards across documents. Ratings of Again,
Hard, Good, and Easy update due dates, repetitions, lapses, stability,
difficulty, elapsed days, scheduled days, and learning state.

### 3.8 Settings

Settings are stored in the database and fall back to environment defaults.
Separate chat and embedding provider panels support Local and OpenAI providers,
model selection, explicit connection testing, model discovery, and auto-save.
OpenAI key validation checks the models endpoint and updates available model
lists. Stored OpenAI chat preferences include reasoning effort, verbosity, and
web search.

## 4. Architecture

### 4.1 Frontend and Application

- **Framework**: Next.js App Router
- **Language**: TypeScript
- **UI**: Shadcn UI, Radix primitives, TailwindCSS, lucide-react
- **Client state**: React state plus localStorage for view preferences and graph state
- **Streaming**: Server-sent progress for ingestion and AI SDK UI message streams for chat

### 4.2 Data Layer

- **Database**: PostgreSQL
- **Vector store**: pgvector generic `vector` columns
- **Graph storage**: relational entity, mention, and relationship tables, with Apache AGE initialized at database startup
- **ORM**: Drizzle ORM
- **Migrations**: Drizzle migrations under `drizzle/` plus SQL helpers under `docker/migrations/`

### 4.3 AI Layer

- **Provider shape**: OpenAI-compatible chat and embedding clients
- **Local providers**: Ollama and LM Studio via local base URLs
- **OpenAI provider**: Shared API key, model validation, and model discovery
- **Structured output**: Zod schemas for tags, entities, relationships, collection suggestions, auto-organize plans, flashcards, and web-search result shaping
- **Error handling**: Provider failures are normalized into user-facing messages for missing keys, rejected keys, forbidden keys, unavailable models, rate limits, and unreachable providers

### 4.4 Ingestion Pipeline

1. Fetch source content or accept pasted text.
2. Extract readable text and source image metadata when available.
3. Compute a document content hash.
4. Split text with structure-aware chunking.
5. Deduplicate chunk hashes within the ingestion run.
6. Generate summary and reusable lowercase tags.
7. Extract entities and relationships with configured budgets.
8. Generate retrieval embeddings for chunks and graph embeddings for entities created during the run.
9. Save document metadata, chunks, tags, entities, mentions, and relationships in one transaction.

### 4.5 Retrieval Pipeline

1. Generate an embedding for the user query.
2. Search embedded chunks by cosine distance and convert distance into similarity scores.
3. Search embedded entities by cosine distance.
4. Search entity names with bounded normalized phrase matching.
5. Merge entity matches by best score.
6. Expand matched entities through bounded graph-neighborhood relationships.
7. Assemble content chunks, graph relationships, and entity descriptions into the prompt context.

## 5. Data Model

- **Documents**: URL, title, type, raw content, content hash, summary, processing status, embedding model/version, metadata, timestamps
- **Chunks**: Document-linked text chunks, content hash, vector embedding, embedding cache reference, chunk index, token count, embedding status, embedding purpose
- **Embedding Cache**: Content hash, model, purpose, vector, timestamp, and uniqueness across hash/model/purpose
- **Entities**: Name, type, description, optional embedding, timestamps
- **Entity Mentions**: Entity, chunk, document, confidence, timestamp
- **Relationships**: Source entity, target entity, relation type, description, weight, source document, timestamp
- **Tags**: Unique tag names with document links
- **SRS Items**: Document-linked flashcards with scheduling fields and review state
- **Collections**: Named document groups with description, color, and document links
- **Projects**: Chat/document groupings with description, goal, color, and links
- **Chat Threads**: Thread title, category, entity/document/project links, timestamps
- **Chat Messages**: Role, content, thread link, timestamp, source/entity metadata
- **Discover Insights**: Entity id sets and generated insight text
- **Settings**: Database-backed key-value configuration

## 6. Supported Commands

```bash
npm run dev          # Start the Next.js development server
npm run build        # Build the production app
npm run start        # Start the production server
npm run lint         # Run ESLint
npm test             # Run unit tests with Node's test runner
npm run db:generate  # Generate Drizzle migrations
npm run db:push      # Push schema changes in development
npm run db:migrate   # Run migrations
npm run db:studio    # Open Drizzle Studio
```

## 7. Environment and Provider Configuration

The app reads `.env` values first and then uses database-backed settings after a
user saves settings in the UI. Separate chat and embedding settings allow mixed
configurations such as local chat with OpenAI embeddings or all-local operation.

Primary environment keys are `DATABASE_URL`, `AI_BASE_URL`, `AI_MODEL`,
`EMBEDDING_MODEL`, `CHAT_PROVIDER`, `CHAT_BASE_URL`, `CHAT_MODEL`,
`CHAT_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_BASE_URL`,
`EMBEDDING_API_KEY`, and `OPENAI_API_KEY`.

## 8. Current Boundaries

- URL ingestion uses HTML fetching and Mozilla Readability for article-like
  pages.
- Pasted text creates note documents directly.
- Source refresh requires a stored source URL.
- Mixed embedding dimensions require re-ingestion or source refresh under a
  single chosen embedding model.
- Chat, summarization, tagging, entity extraction, collection suggestions,
  flashcards, Discover insights, and entity web research use the configured chat
  provider.
- Retrieval embeddings use the configured embedding provider.
