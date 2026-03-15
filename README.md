# open-recall

Privacy-focused, local-first Personal Knowledge Management powered by GraphRAG.

Save web articles, notes, and PDFs -- then chat with your knowledge base using a hybrid of vector search and knowledge graph traversal, all running on your own machine.

> **Note**: 100% of the code in this repository was written by AI -- specifically Claude Opus and OpenAI Codex.

## Features

- **GraphRAG Pipeline**: Automatically extract entities and relationships from ingested content to build a semantic knowledge graph
- **Local AI**: Run everything locally with Ollama or LM Studio -- your data never leaves your machine
- **Hybrid Search**: Combine vector similarity search with graph traversal for richer, more contextual retrieval
- **Multi-Source Ingestion**: Save web articles, paste text, or upload PDFs -- content is chunked, embedded, and graph-indexed automatically
- **Knowledge Graph Visualization**: Interactive force-directed graph with entity detail panels, web search integration, filtering by tags and collections, and contextual chat
- **Discover**: Surface hidden connections, bridge entities, and knowledge clusters across your knowledge base with AI-generated insights
- **Spaced Repetition**: AI-generated flashcards with FSRS scheduling for long-term retention
- **Collections & AI Auto-Organize**: Organize documents into collections manually, via bulk selection, or let AI automatically assign unassigned documents to matching collections
- **Projects**: Group related chat threads into projects for focused research workflows
- **Flexible AI Providers**: Use local models (Ollama/LM Studio) or cloud providers (OpenAI) -- or mix and match chat and embedding providers independently
- **Chat with Context**: RAG-powered chat with streaming responses, persistent threads, category filtering, search, and cited entity tags grounded in your personal knowledge base
- **Command Palette**: Global search across documents, entities, and chats with `Cmd+K` / `Ctrl+K`
- **Web Search**: Augment AI responses with live web search results (OpenAI provider)
- **Dark Mode**: Full dark/light theme support

## Screenshots

| | |
|---|---|
| ![Dashboard](docs/screens/dashboard.png) | ![Library](docs/screens/library.png) |
| **Dashboard** -- Overview of your knowledge base with stats, recent documents, chats, and quick actions. | **Library** -- Browse, search, and organize documents with AI-generated summaries and entity counts. |
| ![Graph](docs/screens/graph.png) | ![Chat](docs/screens/chat.png) |
| **Knowledge Graph** -- Interactive force-directed graph visualization of entities and their relationships. | **Chat** -- RAG-powered conversations grounded in your knowledge base with cited entity tags. |
| ![Add Content](docs/screens/add_doc.png) | ![Settings](docs/screens/settings.png) |
| **Ingestion** -- Add content via URL or text with a live processing pipeline showing each step. | **Settings** -- Configure AI providers, models, reasoning effort, and web search per provider. |

## Pages & Sections

### Dashboard (`/`)
The landing page provides an at-a-glance overview: total documents, entities, relationships, chunks, chats, and collections. It displays recent documents, recent chats, a document type breakdown, and a 30-day ingestion activity chart.

### Library (`/library`)
Browse, search, and filter documents by type (article, YouTube, PDF, note) or collection. Supports card and list view modes, paginated loading, bulk document selection with multi-assign to collections, and AI-powered auto-organize for unassigned documents. Each document links to a detail page with full content, entity tags, related chats, flashcards, and collection management.

### Knowledge Graph (`/graph`)
An interactive 2D force-directed graph powered by `react-force-graph-2d`. Nodes are color-coded by entity type and sized by connection count. Click any entity to see its details, connected entities, source documents, and related chats. Supports filtering by tags and collections, entity search, web search for entities, zoom controls, and contextual "Chat about" actions.

### Discover (`/discover`)
An analysis layer that surfaces non-obvious patterns in your knowledge graph:
- **Hidden Connections** -- Pairs of entities that are not directly connected but share a path through a bridge entity, prioritized by cross-document relevance.
- **Bridge Entities** -- High-connectivity entities that link many different parts of your knowledge graph.
- **Knowledge Clusters** -- Connected components detected via BFS, showing thematic groupings of related entities with their dominant types and inter-cluster bridges.
- **AI Insights** -- On-demand streaming AI analysis for any connection or entity group, explaining why the pattern matters.

Stats at the top summarize total entities, relationships, clusters found, and potential insights.

### Chat (`/chat`)
Persistent, threaded conversations with your knowledge base. Each message is grounded in retrieved context from both vector search and graph traversal, with source citations and entity tags displayed inline. Features include:
- Thread sidebar with category filtering (general, entity-specific, document-specific)
- Chat search with debounced suggestions
- Project grouping for organizing related research threads
- Streaming responses with markdown rendering

### Add Content (`/add`)
Ingest content via URL or pasted text. A live processing pipeline displays each step: fetch content, chunk text, generate summary, extract entities, generate embeddings, and save to database. An adjustable entity detail slider controls the extraction budget (approximately 25 to 300 entities per document). Supports update mode for re-ingesting existing documents from their original source.

### Settings (`/settings`)
Configure independent AI providers for chat and embeddings:
- **Chat Provider**: Local (Ollama/LM Studio) or OpenAI, with model selection, connection testing, and model auto-discovery
- **Embedding Provider**: Local or OpenAI, configured separately
- **OpenAI Options**: Reasoning effort, verbosity, and web search toggles (chat provider only)
- **Database Status**: Live stats showing document, entity, and relationship counts
- Settings auto-save with debounced persistence

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack)
- **Language**: TypeScript (strict mode)
- **UI**: [Shadcn UI](https://ui.shadcn.com/) + [TailwindCSS](https://tailwindcss.com/)
- **Database**: PostgreSQL with [pgvector](https://github.com/pgvector/pgvector) (vectors) + [Apache AGE](https://age.apache.org/) (graph)
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai/) with Ollama / LM Studio / OpenAI support
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **Graph Visualization**: [react-force-graph-2d](https://github.com/vasturiano/react-force-graph)
- **Content Extraction**: [Mozilla Readability](https://github.com/mozilla/readability), [pdfjs-dist](https://github.com/nicolo-ribaudo/pdfjs-dist)
- **Markdown**: [react-markdown](https://github.com/remarkjs/react-markdown) with [remark-gfm](https://github.com/remarkjs/remark-gfm)
- **Syntax Highlighting**: [Shiki](https://shiki.style/)
- **Animations**: [Motion](https://motion.dev/) (Framer Motion)

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [Node.js](https://nodejs.org/) 20+
- [Ollama](https://ollama.ai/) (for local AI inference)

## Quick Start

### 1. Install Ollama and pull models

```bash
# Install Ollama (macOS)
brew install ollama

# Start Ollama
ollama serve

# Pull required models
ollama pull llama3.2:8b
ollama pull nomic-embed-text
```

### 2. Clone and setup

```bash
git clone https://github.com/rupertgermann/open-recall.git
cd open-recall

# Copy environment file
cp .env.example .env

# Install dependencies
npm install
```

### 3. Start the database

```bash
docker compose up db -d
```

This starts PostgreSQL with pgvector and Apache AGE extensions on port **6432**.

### 4. Push database schema

```bash
npm run db:push
```

### 5. Start the development server

```bash
npm run dev

# or with custom port
npm run dev -- --port 3003

```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Docker Deployment (Full Stack)

To run the entire stack (app + database) in Docker:

```bash
# Build and start everything
docker compose up --build

# Or run in detached mode
docker compose up -d --build
```

The app will be available at [http://localhost:3000](http://localhost:3000). When running via Docker Compose, the app connects to the database over the internal Docker network -- no port mapping needed on the host for that connection.

> **Note**: The app container needs access to Ollama on your host machine. Docker Compose is configured with `host.docker.internal` to enable this.

## Data Models

The database schema supports a hybrid approach, handling both standard document storage and graph structures:

| Model | Description |
|---|---|
| **Documents** | Source content metadata (URL, title, type, content hash, AI-generated summary, processing status) |
| **Chunks** | Text segments with vector embeddings, linked to documents and the embedding cache |
| **Entities** | Knowledge graph nodes (person, concept, technology, organization, location, event, product) with optional embeddings |
| **Entity Mentions** | Links chunks to entities with confidence scores, enabling traceability from concept to source text |
| **Relationships** | Knowledge graph edges with typed relations (e.g., "built_with", "parent_of"), weights, and source document provenance |
| **SRS Items** | Spaced repetition flashcards with full FSRS parameters (stability, difficulty, reps, lapses, state, scheduling) |
| **Collections** | Named document groupings with color labels |
| **Projects** | Chat thread groupings with goals and color labels |
| **Chat Threads** | Persistent chat sessions with category classification (general, entity, document, project) |
| **Chat Messages** | Individual messages with role, content, and metadata (sources, entities) |
| **Tags** | Document tags with many-to-many document linking |
| **Embedding Cache** | Central embedding cache keyed by content hash, model, and purpose for deduplication |
| **Settings** | Key-value store for user preferences and AI provider configuration |

## Project Structure

```
open-recall/
├── src/
│   ├── actions/             # Server actions (DB mutations, AI operations)
│   │   ├── collections.ts   # Collections CRUD + AI auto-organize
│   │   ├── dashboard.ts     # Dashboard stats & recent activity
│   │   ├── discover.ts      # Hidden connections, bridge entities, clusters
│   │   ├── documents.ts     # Document CRUD & search
│   │   ├── graph.ts         # Knowledge graph data & entity details
│   │   ├── projects.ts      # Project CRUD
│   │   ├── search.ts        # Global search across documents, entities, chats
│   │   ├── settings.ts      # AI provider settings
│   │   └── websearch.ts     # Web search for entities
│   ├── app/                 # Next.js App Router pages & API routes
│   │   ├── api/             # API route handlers (chat, ingest, discover, etc.)
│   │   ├── chat/            # Chat interface with threads & projects
│   │   ├── discover/        # Hidden connections & knowledge clusters
│   │   ├── library/         # Document library, detail views, & collections
│   │   ├── graph/           # Knowledge graph visualization
│   │   ├── settings/        # AI provider & app configuration
│   │   └── add/             # Content ingestion UI
│   ├── components/          # React components
│   │   ├── ai-elements/     # AI-specific UI (flashcards, conversation, etc.)
│   │   ├── chat/            # Chat-specific components (sources, messages)
│   │   ├── layout/          # Header, navigation
│   │   ├── command-palette.tsx  # Global search (Cmd+K)
│   │   └── ui/              # Shadcn UI primitives
│   ├── db/                  # Drizzle schema & database client
│   ├── hooks/               # React hooks
│   └── lib/
│       ├── ai/              # AI client, config, provider setup
│       ├── chat/            # Chat transport & utilities
│       ├── content/         # Content extraction & chunking
│       └── embedding/       # Embedding service, cache, metrics
├── docker/                  # Docker initialization scripts
├── docs/                    # Architecture & design documentation
├── docker-compose.yml       # Container orchestration
├── Dockerfile               # Multi-stage production build
└── drizzle.config.ts        # Drizzle ORM config
```

## Environment Variables

See [`.env.example`](.env.example) for the full configuration with examples.

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:6432/openrecall` |
| `AI_BASE_URL` | Local AI provider URL | `http://localhost:11434/v1` |
| `AI_MODEL` | Chat/extraction model | `llama3.2:8b` |
| `EMBEDDING_MODEL` | Embedding model | `nomic-embed-text` |

### Split Provider Configuration

You can configure **separate chat and embedding providers** (e.g., local chat + OpenAI embeddings):

| Variable | Description |
|----------|-------------|
| `CHAT_PROVIDER` | `local` or `openai` |
| `CHAT_BASE_URL` | Chat provider URL |
| `CHAT_MODEL` | Chat model name |
| `CHAT_API_KEY` | Chat API key (optional for local) |
| `EMBEDDING_PROVIDER` | `local` or `openai` |
| `EMBEDDING_BASE_URL` | Embedding provider URL |
| `EMBEDDING_API_KEY` | Embedding API key (optional for local) |

See `.env.example` for full examples of mixed configurations.

## Development

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint

npm run db:generate  # Generate migration files
npm run db:push      # Push schema changes (development)
npm run db:migrate   # Run migrations (production)
npm run db:studio    # Open Drizzle Studio
```

## Troubleshooting

### Embedding Dimensions Mismatch

If you switch embedding providers (e.g., from local `nomic-embed-text` with 768 dimensions to OpenAI `text-embedding-3-small` with 1536 dimensions), you may encounter database errors about vector dimension mismatch.

**Solution**: The schema uses unconstrained vector columns, but existing data retains old dimensions. You have two options:

1. **Clear and re-ingest**: Reset your library and re-ingest content with the new provider.
2. **Stick to one provider**: Choose either local or OpenAI for embeddings and stay consistent.

See [`docs/embedding_dimensions_concept.md`](docs/embedding_dimensions_concept.md) for a deeper explanation.

### Apache AGE Graph Not Initialized

If graph queries fail with "graph does not exist", ensure `docker/init-db.sql` ran on first database start. Manual fix:

```sql
SELECT create_graph('knowledge_graph');
```

### Ollama Connection Errors

- Ensure Ollama is running: `ollama serve`
- Verify the base URL includes `/v1`: `http://localhost:11434/v1`
- Check models are pulled: `ollama list`

## Hardware Requirements

- **RAM**: 16 GB recommended (8 GB minimum)
- **GPU**: 6 GB+ VRAM for accelerated inference (optional -- CPU works)
- **Storage**: 10 GB+ for models and database

## License

[MIT](LICENSE)
