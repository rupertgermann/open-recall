# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open-recall is a privacy-focused, local-first Personal Knowledge Management system powered by GraphRAG. It uses a hybrid approach combining vector similarity search with knowledge graph traversal to provide intelligent context retrieval.

**Core Technologies:**
- **Frontend**: Next.js 16 (App Router), TypeScript, Shadcn UI, TailwindCSS
- **Database**: PostgreSQL with pgvector (vector embeddings) + Apache AGE (graph queries)
- **AI**: Vercel AI SDK with flexible provider support (Ollama/LM Studio for local, OpenAI for cloud)
- **ORM**: Drizzle

## Development Commands

```bash
# Development
npm run dev                 # Start Next.js dev server (http://localhost:3000)

# Database
npm run db:generate         # Generate migration files from schema changes
npm run db:push             # Push schema changes directly to database (development)
npm run db:migrate          # Run migrations (production)
npm run db:studio           # Open Drizzle Studio UI

# Docker
docker compose up db -d     # Start PostgreSQL with pgvector + Apache AGE
docker compose up --build   # Build and start full stack (app + db)

# Code Quality
npm run lint                # Run ESLint
npm run build               # Production build
```

## Database Setup

The database requires pgvector and Apache AGE extensions:
- **pgvector**: Vector similarity search for embeddings
- **Apache AGE**: Graph database for entity relationships
- Extensions are initialized via `docker/init-db.sql` on first start
- Default connection: `postgres://postgres:postgres@localhost:6432/openrecall`

**Important**: Docker exposes the database on host port 6432 (mapped to container port 5432) to avoid conflicts with any local PostgreSQL. The local connection string uses `localhost:6432`.

## Architecture

### Data Flow: Ingestion Pipeline

The ingestion pipeline processes content through several stages (see `src/actions/ingest.ts`):

1. **Extraction** (`src/lib/content/extractor.ts`): Fetch and parse content using Mozilla Readability
2. **Chunking** (`src/lib/content/chunker.ts`): Split content into semantic chunks
3. **Embedding** (`src/lib/embedding/`): Generate vector embeddings with caching
   - Uses content-hash based deduplication (`cache.ts`)
   - Batched processing for efficiency (`service.ts`)
   - Separate embeddings for graph vs retrieval purposes
4. **Entity Extraction** (`src/lib/ai/client.ts`): Extract entities and relationships using LLM
5. **Storage**: Persist to PostgreSQL via Drizzle ORM

### Database Schema Architecture

The schema (`src/db/schema.ts`) implements a multi-layered knowledge system:

**Document Layer:**
- `documents`: Source content metadata (articles, notes, PDFs, YouTube)
- `chunks`: Text segments with embeddings for retrieval
- `tags`: User-defined categorization via `document_tags` junction table

**Knowledge Graph Layer:**
- `entities`: Extracted concepts, people, technologies, organizations, etc.
- `relationships`: Typed edges between entities (e.g., "built_with", "related_to")
- `entity_mentions`: Links entities to specific chunks and documents

**Learning Layer:**
- `srs_items`: Spaced repetition flashcards with FSRS algorithm parameters

**Chat Layer:**
- `chat_threads`: Persistent chat sessions (categories: general, entity-specific, document-specific)
- `chat_messages`: Message history with metadata

**Caching Layer:**
- `embedding_cache`: Content-hash based embedding cache to avoid redundant API calls
  - Supports different models and purposes (graph vs retrieval)
  - Unique constraint on (contentHash, model, purpose)

**Key Architectural Decisions:**
- **No fixed vector dimensions**: Schema uses `vector` without dimension constraints to support switching embedding models (e.g., nomic-embed-text: 768 dims vs OpenAI: 1536 dims)
- **Content hashing**: SHA-256 hashes enable deduplication and change detection
- **Cascading deletes**: Foreign keys configured with `onDelete: "cascade"` to maintain referential integrity
- **Purpose-based embeddings**: Separate embeddings for graph construction vs document retrieval

### AI Provider Configuration

The system supports flexible AI provider configuration (see `src/lib/ai/config.ts`):

**Provider Types:**
- `local`: Ollama, LM Studio, or any OpenAI-compatible local server
- `openai`: OpenAI cloud API

**Configuration Sources (priority order):**
1. Database settings (via `settings` table) - user-configurable in UI
2. Environment variables
3. Hard-coded defaults

**Separate Chat and Embedding Providers:**
- Chat provider: Used for summaries, entity extraction, flashcards, conversational chat
- Embedding provider: Used for vector embeddings
- Can mix and match (e.g., local chat + OpenAI embeddings)

**Important Functions:**
- `getChatConfigFromDB()`: Returns current chat provider config
- `getEmbeddingConfigFromDB()`: Returns current embedding provider config
- `loadAISettingsFromDB()`: Loads both configs with 5-second cache
- `clearSettingsCache()`: Call after updating settings

**Environment Variables:**
```bash
# Shared defaults
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.2:8b
EMBEDDING_MODEL=nomic-embed-text

# Separate provider config (overrides shared defaults)
CHAT_PROVIDER=local|openai
CHAT_BASE_URL=...
CHAT_MODEL=...
CHAT_API_KEY=...

EMBEDDING_PROVIDER=local|openai
EMBEDDING_BASE_URL=...
EMBEDDING_MODEL=...
EMBEDDING_API_KEY=...
```

### Embedding System

**Three-layer architecture** (`src/lib/embedding/`):

1. **Cache Layer** (`cache.ts`):
   - Content-hash based deduplication using SHA-256
   - Stores embeddings in `embedding_cache` table
   - Supports batch lookups with `batchGetOrCreateEmbeddings()`

2. **Service Layer** (`service.ts`):
   - Main entry point: `generateEmbeddingsWithCache()`
   - Batched processing (16 texts per batch, 2 concurrent batches)
   - Integrates caching and metrics

3. **Client Layer** (`src/lib/ai/client.ts`):
   - `generateEmbeddings()`: Raw embedding generation via Vercel AI SDK
   - `getEmbeddingModel()`: Creates embedding model instance

**Usage Pattern:**
```typescript
import { generateEmbeddingsWithCache } from "@/lib/embedding";

const result = await generateEmbeddingsWithCache(texts, "retrieval");
// result: { embeddings, cacheHits, cacheMisses, timeMs }
```

### Server Actions

Server actions (`src/actions/`) handle database operations:
- `ingest.ts`: Content ingestion pipeline (URL and text)
- `documents.ts`: Document CRUD operations
- `graph.ts`: Entity and relationship queries
- `chat.ts`: Chat thread and message management
- `settings.ts`: User preferences (including AI provider configuration)
- `websearch.ts`: Web search integration

**Note**: All server actions are marked with `"use server"` directive.

### API Routes

API routes (`src/app/api/`) expose server functionality:
- `/api/ingest`: Content ingestion endpoint
- `/api/chat`: Streaming chat with RAG context
- `/api/chats/*`: Chat thread management
- `/api/chats/context`: Retrieve RAG context for queries

### Component Structure

- `src/components/ui/`: Shadcn UI primitives (do not modify, regenerate via CLI)
- `src/components/`: Application-specific components
- `src/app/`: Next.js App Router pages
  - `/library`: Document browser
  - `/graph`: Knowledge graph visualization
  - `/chat`: Chat interface
  - `/settings`: Configuration UI

## Key Patterns and Conventions

### Drizzle ORM Usage

**Schema modifications:**
1. Edit `src/db/schema.ts`
2. Run `npm run db:push` to apply changes (development)
3. For production, use `npm run db:generate` then `npm run db:migrate`

**Query patterns:**
```typescript
import { db } from "@/db";
import { documents, chunks } from "@/db/schema";
import { eq } from "drizzle-orm";

// Select with relations
const doc = await db.query.documents.findFirst({
  where: eq(documents.id, documentId),
  with: { chunks: true, entityMentions: true },
});

// Insert with returning
const [newDoc] = await db.insert(documents).values({...}).returning();

// Update
await db.update(documents).set({...}).where(eq(documents.id, id));
```

### Vector Search

Vector similarity search uses pgvector with custom SQL:
```typescript
const similarChunks = await db.execute(sql`
  SELECT id, content, 1 - (embedding <=> ${embedding}::vector) as similarity
  FROM chunks
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> ${embedding}::vector
  LIMIT 10
`);
```

### Embedding Model Migration

If switching embedding models (e.g., nomic-embed-text to OpenAI):
1. Update `EMBEDDING_MODEL` in settings or environment
2. **Clear existing embeddings** or re-process documents
3. Dimension mismatches will cause errors (nomic: 768 dims, OpenAI: 1536 dims)
4. Schema supports dynamic dimensions but existing data must be consistent

## Common Tasks

### Add a New Entity Type

1. Add to `ENTITY_TYPES` in `src/lib/ai/config.ts`
2. Update extraction prompt in `src/lib/ai/client.ts` (search for `extractEntities`)

### Add a New Relationship Type

1. Add to `RELATIONSHIP_TYPES` in `src/lib/ai/config.ts`
2. Update extraction logic in entity extraction function

### Debug Embedding Performance

Check metrics via `metricsCollector` in `src/lib/embedding/metrics.ts`:
- Records cache hit rates
- Tracks embedding generation time
- Available via `metricsCollector.getStats()`

### Modify AI Prompts

Key prompts are located in:
- `src/lib/ai/client.ts`: Entity extraction, summary generation, tag generation
- `src/app/api/chat/route.ts`: RAG chat system prompt

## Testing

There is currently no formal test suite. When adding features:
- Manually test via the UI
- Verify database state using `npm run db:studio`
- Check Docker logs for errors: `docker compose logs -f`

## Common Issues

### Port Conflicts
- Database exposed on port 6432 (not 5432) to avoid conflicts
- App runs on port 3000
- Ollama runs on port 11434

### Embedding Dimension Errors
- Error: "expected X dimensions, not Y"
- Cause: Embedding model changed but old embeddings still exist
- Solution: Clear library and re-ingest, or stick to one model

### Apache AGE Graph Not Initialized
- Symptom: Graph queries fail with "graph does not exist"
- Solution: Ensure `docker/init-db.sql` ran on first database start
- Manual fix: `SELECT create_graph('knowledge_graph');`

### Ollama Connection Errors
- Ensure Ollama is running: `ollama serve`
- Check base URL: `http://localhost:11434/v1` (note `/v1` suffix)
- Verify model is pulled: `ollama pull llama3.2:8b` and `ollama pull nomic-embed-text`

### Build Errors with Turbopack
- The project uses Turbopack (Next.js 15 experimental)
- If encountering build issues, check `next.config.ts` configuration
- Package imports are optimized for specific libraries (lucide-react, motion, etc.)

## Architecture Notes

### Why Separate Graph and Retrieval Embeddings?

The system generates two types of embeddings:
- **Graph embeddings**: For entity resolution and relationship detection
- **Retrieval embeddings**: For document chunk similarity search

This separation allows:
- Different embedding models optimized for different tasks
- Independent caching strategies
- Potential future support for specialized models per purpose

### Why Content Hashing?

Content hashing (SHA-256) enables:
- **Deduplication**: Identical chunks share embeddings
- **Change detection**: Re-embed only when content changes
- **Cache invalidation**: Automatic cache busting on content updates

### Database Choice: PostgreSQL + pgvector + Apache AGE

- **PostgreSQL**: Mature, reliable, excellent JSON support
- **pgvector**: Native vector similarity search (faster than external vector DBs for this scale)
- **Apache AGE**: Graph queries using Cypher syntax within PostgreSQL
- Single database simplifies deployment and transactions

## Recent Changes

- Turbopack enabled for faster dev builds (Next.js 16 default bundler)
- Auto-save settings with debounced updates
- OpenAI provider support added alongside local providers
- Starter prompts moved inline after welcome message in chat
- Web search debugging improvements
