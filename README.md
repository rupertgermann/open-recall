# open-recall

Privacy-focused, local-first Personal Knowledge Management powered by GraphRAG.

Save web articles, notes, and PDFs — then chat with your knowledge base using a hybrid of vector search and knowledge graph traversal, all running on your own machine.

## Features

- **GraphRAG Pipeline**: Automatically extract entities and relationships from ingested content to build a semantic knowledge graph
- **Local AI**: Run everything locally with Ollama or LM Studio — your data never leaves your machine
- **Hybrid Search**: Combine vector similarity search with graph traversal for richer, more contextual retrieval
- **Multi-Source Ingestion**: Save web articles, paste text, or upload PDFs — content is chunked, embedded, and graph-indexed automatically
- **Knowledge Graph Visualization**: Interactive force-directed graph showing entities, relationships, and how your knowledge connects
- **Spaced Repetition**: AI-generated flashcards with FSRS scheduling for long-term retention
- **Collections & Projects**: Organize documents into collections and group related work into projects
- **Flexible AI Providers**: Use local models (Ollama/LM Studio) or cloud providers (OpenAI) — or mix and match chat and embedding providers
- **Chat with Context**: RAG-powered chat with streaming responses, grounded in your personal knowledge base
- **Web Search**: Augment AI responses with live web search results
- **Dark Mode**: Full dark/light theme support

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack)
- **Language**: TypeScript (strict mode)
- **UI**: [Shadcn UI](https://ui.shadcn.com/) + [TailwindCSS](https://tailwindcss.com/)
- **Database**: PostgreSQL with [pgvector](https://github.com/pgvector/pgvector) (vectors) + [Apache AGE](https://age.apache.org/) (graph)
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai/) with Ollama / LM Studio / OpenAI support
- **ORM**: [Drizzle](https://orm.drizzle.team/)

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

The app will be available at [http://localhost:3000](http://localhost:3000). When running via Docker Compose, the app connects to the database over the internal Docker network — no port mapping needed on the host for that connection.

> **Note**: The app container needs access to Ollama on your host machine. Docker Compose is configured with `host.docker.internal` to enable this.

## Project Structure

```
open-recall/
├── src/
│   ├── actions/             # Server actions (DB mutations)
│   ├── app/                 # Next.js App Router pages & API routes
│   │   ├── api/             # API route handlers (chat, ingest, etc.)
│   │   ├── chat/            # Chat interface
│   │   ├── library/         # Document library & detail views
│   │   ├── graph/           # Knowledge graph visualization
│   │   ├── settings/        # AI provider & app configuration
│   │   └── add/             # Content ingestion UI
│   ├── components/          # React components
│   │   ├── ai-elements/     # AI-specific UI (flashcards, entities, etc.)
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

You can also configure **separate chat and embedding providers** (e.g., local chat + OpenAI embeddings). See `.env.example` for details.

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
- **GPU**: 6 GB+ VRAM for accelerated inference (optional — CPU works)
- **Storage**: 10 GB+ for models and database

## Development

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint

npm run db:generate  # Generate migration files
npm run db:push      # Push schema changes (development)
npm run db:migrate   # Run migrations (production)
npm run db:studio    # Open Drizzle Studio
```

## Contributing

See [`AGENTS.md`](AGENTS.md) for code style, conventions, and architecture guidance.

## License

[MIT](LICENSE)
