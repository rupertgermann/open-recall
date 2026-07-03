# open-recall

Privacy-focused, local-first Personal Knowledge Management powered by GraphRAG.

open-recall saves article-like web pages and notes, extracts summaries, tags,
entities, relationships, and embeddings, then lets you search, review, discover,
and chat with the resulting knowledge graph. Local providers such as Ollama and
LM Studio are the default path, with OpenAI available for chat, embeddings, and
entity web research when configured.

> **Note**: 100% of the code in this repository was written by AI -- specifically Claude Opus and OpenAI Codex.

## Features

- **GraphRAG ingestion**: Fetch URL content or save text notes, extract readable text with Mozilla Readability, download lead images, create structure-aware chunks, generate summaries and tags, extract entities and relationships, and store retrieval embeddings.
- **Local-first AI**: Use Ollama or LM Studio through OpenAI-compatible endpoints. Chat and embedding providers are configured independently, so local and OpenAI providers can be mixed.
- **Hybrid retrieval**: Combine vector chunk search, literal entity-name matching, and graph-neighborhood expansion before building chat context.
- **Library management**: Browse documents in card or list view, search by title or summary, filter by type and collection, paginate with "Load more", refresh source-backed documents, and delete with confirmation dialogs.
- **Collections**: Create, rename, delete, filter, and bulk-assign collections. AI auto-organize suggests existing collections or concise additional collections for unassigned documents and lets you review suggestions before applying them.
- **Tags**: Ingestion generates reusable tags. Document detail pages support tag editing and AI tag generation, and the graph can be filtered by tags with autocomplete.
- **Knowledge graph**: Explore an interactive 2D force graph with entity search, multi-select type filters, tag filters, collection filters, URL focus states, persisted camera/selection state, zoom controls, hover highlighting, and entity detail panels.
- **Entity web research**: With OpenAI configured as the chat provider, graph entity panels can run AI web search, show deduplicated source previews, and hand selected URLs to the Add Content flow.
- **Discover**: Surface hidden connections, bridge entities, and knowledge clusters. AI-generated insights stream into the Discover view and are stored for reuse.
- **Spaced repetition**: Generate flashcards from document detail pages, review due cards at `/review`, and schedule cards with Again, Hard, Good, and Easy ratings.
- **Contextual chat**: Persist threaded conversations with streaming responses, auto-generated titles, source citations, entity tags, category filters, search suggestions, related chats, context-specific starter prompts, and tools for knowledge-base search, note creation, entity lookup, and related-document lookup.
- **Projects**: Manage lightweight project records and filter project-linked chat threads in the chat sidebar.
- **Quick Capture**: Use the floating capture button to save a quick note directly or route a URL into the Add Content screen. Notes support `Cmd+Enter` / `Ctrl+Enter` submission.
- **Settings**: Configure chat and embedding providers separately, validate OpenAI API keys, discover provider models with explicit Test buttons, and auto-save local settings.
- **Dark mode**: Full dark/light theme support with a persistent mode toggle.

## Screenshots

| | |
|---|---|
| ![Dashboard](docs/screens/dashboard.png) | ![Library](docs/screens/library.png) |
| **Dashboard** -- Knowledge-base stats, recent documents, recent chats, type breakdown, activity, and quick actions. | **Library** -- Search, type filters, collection filters, card/list views, lead images, bulk selection, and AI organization workflow. |
| ![Graph](docs/screens/graph.png) | ![Chat](docs/screens/chat.png) |
| **Knowledge Graph** -- Interactive force-directed graph with filters, focus controls, entity details, related chats, and entity web research. | **Chat** -- Persistent GraphRAG conversations grounded in retrieved sources and entity context. |
| ![Add Content](docs/screens/add_doc.png) | ![Settings](docs/screens/settings.png) |
| **Ingestion** -- URL and text ingestion with entity-detail budgeting and a streaming processing pipeline. | **Settings** -- Separate chat and embedding provider configuration with model discovery and OpenAI API-key validation. |

## Pages & Sections

### Dashboard (`/`)

The landing page shows total documents, entities, relationships, chunks, chats,
and collections. It also includes recent documents, recent chats, document type
breakdown, a 30-day ingestion activity chart, and quick actions for adding
content, starting chat, browsing the library, and exploring the graph.

### Library (`/library`)

The library supports document search, type filters, collection filters, card and
list views, persisted view-mode preference, paginated loading, source refresh,
collection management, and bulk assignment. Unassigned documents can be analyzed
by AI auto-organize, reviewed as suggestions, accepted one by one, accepted in
bulk, or dismissed.

Each document links to a detail page with the source URL, source image, summary,
editable tags, flashcards, chunk inspection, collection editing, related chats,
entity badges, relationship previews, source refresh, graph focus, document chat,
and deletion.

### Review (`/review`)

The review page lists due flashcards across documents. Each card can be answered
and rated Again, Hard, Good, or Easy, which updates due dates, repetition counts,
lapses, stability, difficulty, and learning state.

### Knowledge Graph (`/graph`)

The graph view uses `react-force-graph-2d` with responsive sizing and custom
canvas rendering. Nodes are color-coded by entity type, constrained in size,
highlighted on hover/selection, and labeled differently at cluster and detail
zoom levels. Controls include entity search, multi-select entity type filters,
tag autocomplete, collection filters, reset, refresh, zoom in/out, and "Zoom to
Node".

URL parameters support direct graph focus:

- `/graph?entity=<entity-id>` selects and zooms to an entity.
- `/graph?focus=<document-id>` shows the document-scoped graph.

The entity sidebar shows related chats, type, description, connected entities,
mentioned documents, contextual chat, and OpenAI-backed AI web search with
optional prompt guidance and "Add to library" handoff.

### Discover (`/discover`)

Discover analyzes the graph for:

- **Hidden Connections**: Entity pairs connected through a bridge entity without
  a direct edge.
- **Bridge Entities**: High-connectivity entities that join separate parts of the
  graph.
- **Knowledge Clusters**: Connected components with dominant entity types and
  internal connectors.
- **AI Insights**: Streaming explanations for selected connections or groups,
  stored in `discover_insights` and shown again on later visits.

### Chat (`/chat` and `/chat/[id]`)

Chat stores every thread and message in PostgreSQL. Threads can be filtered by
category, searched with debounced suggestions, opened in a full-page view,
deleted with confirmation, and filtered by project when linked. Entity and
document chats include contextual welcome messages and starter prompts.

The chat API retrieves context from vector search, exact/phrase entity matching,
and graph-neighborhood relationships. Assistant messages store source citations
and entity references. Tool calls can search the knowledge base, create notes,
look up entities, and find related documents.

### Add Content (`/add`)

The Add page supports URL and text ingestion. URL query parameters can prefill or
focus the form:

- `/add?url=<encoded-url>` pre-fills URL mode.
- `/add?update=<document-id>` opens update mode for a source-backed document.

The entity detail slider maps from roughly 25 to 300 extracted entities, with
relationship budget set to twice the entity budget. Processing streams progress
through fetch, chunk, summarize, tag, extract, embed, save, and complete events.
The request can be cancelled from the UI.

### Settings (`/settings`)

Settings are stored in the database under the `ai_config` key and fall back to
environment defaults when no saved settings exist. The page contains separate
provider panels for chat and embeddings:

- **Chat Provider**: Local or OpenAI provider, model selection, explicit
  connection test, and stored OpenAI chat preferences for reasoning effort,
  verbosity, and web search.
- **Embedding Provider**: Local or OpenAI provider, model selection, and explicit
  connection test.
- **OpenAI API Key**: Shared key field shown when OpenAI is selected, with
  server-side validation against the OpenAI models endpoint.
- **Database Status**: Current document, entity, and relationship counts.

Settings auto-save after a short debounce and clear the in-process settings
cache immediately after saving.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) App Router
- **Language**: TypeScript with strict mode
- **UI**: [Shadcn UI](https://ui.shadcn.com/), Radix primitives, TailwindCSS, lucide-react
- **Database**: PostgreSQL with [pgvector](https://github.com/pgvector/pgvector) and Apache AGE initialization
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **AI**: Vercel AI SDK-compatible `ai` package with OpenAI-compatible local and OpenAI providers
- **Graph Visualization**: [react-force-graph-2d](https://github.com/vasturiano/react-force-graph)
- **Content Extraction**: [Mozilla Readability](https://github.com/mozilla/readability), JSDOM, and lead-image download into `public/document-images`
- **Markdown**: `react-markdown`, `remark-gfm`, and Streamdown for chat rendering
- **Syntax Highlighting**: [Shiki](https://shiki.style/)
- **Animations**: Motion
- **Testing**: Node's built-in test runner with TypeScript strip-types
- **CI**: GitHub Actions runs install, lint, and tests on pushes and pull requests to `main`

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [Node.js](https://nodejs.org/) 20+
- [Ollama](https://ollama.ai/) or another OpenAI-compatible local provider for local AI inference

## Quick Start

### 1. Install Ollama and pull models

```bash
# Install Ollama on macOS
brew install ollama

# Start Ollama
ollama serve

# Pull default local models
ollama pull llama3.2:8b
ollama pull nomic-embed-text
```

### 2. Clone and set up

```bash
git clone https://github.com/rupertgermann/open-recall.git
cd open-recall

cp .env.example .env
npm install
```

### 3. Start PostgreSQL

```bash
docker compose up db -d
```

The database is exposed on host port `6432` and uses the database name
`openrecall`.

### 4. Apply the schema

```bash
npm run db:push
```

### 5. Start the development server

```bash
npm run dev

# or with a custom port
npm run dev -- --port 3003
```

Open [http://localhost:3000](http://localhost:3000).

## Docker Deployment

Run the app and database together:

```bash
docker compose up --build

# detached mode
docker compose up -d --build
```

The app is available at [http://localhost:3000](http://localhost:3000). In
Compose mode, the app uses `DATABASE_URL=postgres://postgres:postgres@db:5432/openrecall`
inside the Docker network and `AI_BASE_URL=http://host.docker.internal:11434/v1`
to reach Ollama on the host.

## Data Models

| Model | Description |
|---|---|
| **Documents** | Source metadata, original content, content hash, summary, processing status, embedding model/version, and flexible metadata such as lead-image paths |
| **Chunks** | Structure-aware retrieval chunks with content hashes, token counts, embeddings, cache references, embedding status, and purpose |
| **Embedding Cache** | Deduplicated embeddings keyed by content hash, model, and purpose (`retrieval` or `graph`) |
| **Entities** | Knowledge graph nodes with type, description, and optional graph embeddings |
| **Entity Mentions** | Traceability from entities to documents and chunks, including fallback mention confidence |
| **Relationships** | Typed graph edges with optional descriptions, weights, and source-document provenance |
| **Tags** | Reusable document tags with many-to-many document linking |
| **SRS Items** | Flashcards with FSRS-style scheduling fields, due dates, review counts, lapses, stability, difficulty, and state |
| **Collections** | Named document groupings with color labels and document links |
| **Projects** | Chat/project groupings with goals, colors, document links, and chat-thread links |
| **Chat Threads** | Persistent chat sessions categorized as general, entity, document, or project |
| **Chat Messages** | User and assistant messages with source/entity metadata |
| **Discover Insights** | Persisted AI explanations for discovered entity groups |
| **Settings** | Database-backed user preferences and provider configuration |

## Project Structure

```text
open-recall/
├── src/
│   ├── actions/               # Server actions for documents, graph, chat, SRS, collections, settings, discover
│   ├── app/                   # Next.js App Router pages and API routes
│   │   ├── add/               # URL/text ingestion and source-update UI
│   │   ├── api/               # Chat, ingest, update, discover, related-chat, and thread APIs
│   │   ├── chat/              # Threaded chat UI
│   │   ├── discover/          # Hidden connections, bridge entities, clusters, and insights
│   │   ├── graph/             # Knowledge graph visualization
│   │   ├── library/           # Library, document details, collections, tags, chunks, flashcards
│   │   ├── review/            # Due flashcard review queue
│   │   └── settings/          # AI provider and database status settings
│   ├── components/
│   │   ├── ai-elements/       # Reusable AI/chat UI primitives
│   │   ├── chat/              # Chat sources and metadata rendering
│   │   ├── discover/          # Discover client UI
│   │   ├── layout/            # Header/navigation
│   │   ├── quick-capture.tsx  # Floating note/URL capture
│   │   └── ui/                # Shadcn UI primitives
│   ├── db/                    # Drizzle schema and database client
│   └── lib/
│       ├── ai/                # Provider config, model lists, generation helpers, error messages
│       ├── chat/              # Chat helper logic, tool result formatting, starter prompts
│       ├── content/           # Readability extraction and image download
│       ├── discover/          # Graph algorithms and insight helpers
│       ├── embedding/         # Chunking, cache, metrics, batching, benchmark utilities
│       ├── ingestion/         # Ingestion orchestration and persistence planning
│       ├── retrieval/         # Hybrid retrieval scoring and entity matching helpers
│       └── srs/               # Flashcard shaping, due counts, and scheduler
├── tests/                     # Node test-runner unit tests
├── docs/                      # Product and architecture documentation
├── docker/                    # Database initialization and SQL migration helpers
├── drizzle/                   # Drizzle migrations and snapshots
├── docker-compose.yml         # App/database orchestration
├── Dockerfile                 # Production image
└── drizzle.config.ts          # Drizzle ORM config
```

## Environment Variables

See [`.env.example`](.env.example) for the full template.

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for local development | `postgres://postgres:postgres@localhost:6432/openrecall` |
| `AI_BASE_URL` | Shared local OpenAI-compatible base URL used when specific provider URLs are not set | `http://localhost:11434/v1` |
| `AI_MODEL` | Shared default chat/extraction model | `llama3.2:8b` |
| `EMBEDDING_MODEL` | Default embedding model | `nomic-embed-text` |
| `CHAT_PROVIDER` | Chat provider, `local` or `openai` | `local` |
| `CHAT_BASE_URL` | Chat provider base URL | `AI_BASE_URL` |
| `CHAT_MODEL` | Chat, summary, tag, extraction, flashcard, and insight model | `AI_MODEL` |
| `CHAT_API_KEY` | Chat provider API key, optional for local providers | unset |
| `EMBEDDING_PROVIDER` | Embedding provider, `local` or `openai` | `local` |
| `EMBEDDING_BASE_URL` | Embedding provider base URL | `AI_BASE_URL` |
| `EMBEDDING_API_KEY` | Embedding provider API key, optional for local providers | unset |
| `OPENAI_API_KEY` | Legacy/shared OpenAI API key fallback | unset |

Database-saved settings from `/settings` override these defaults for runtime AI
requests after the first save.

## Development

```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm test             # Node test runner with TypeScript strip-types

npm run db:generate  # Generate Drizzle migration files
npm run db:push      # Push schema changes in development
npm run db:migrate   # Run Drizzle migrations
npm run db:studio    # Open Drizzle Studio
```

## Troubleshooting

### Embedding Dimensions Mismatch

Different embedding models produce vectors with different dimensions, such as
`nomic-embed-text` at 768 dimensions, `text-embedding-3-small` at 1536
dimensions, and `text-embedding-3-large` at 3072 dimensions. PostgreSQL can
store these vectors in generic `vector` columns, but pgvector distance
operations still require matching dimensions when comparing vectors.

The app tracks document-level `embedding_model` and `embedding_version`, and the
embedding cache is keyed by content hash, model, and purpose. When a
source-backed document is refreshed and the configured embedding model differs,
the ingestion pipeline rebuilds derived data for that document. Existing mixed
dimension data can still make retrieval fail until affected documents are
re-ingested with one embedding model.

Recommended recovery:

1. Pick one embedding provider/model for the current library.
2. Refresh source-backed documents from the library or document detail page.
3. Recreate pasted notes that were embedded with a different dimension.
4. For a clean reset, clear local data and re-ingest with the selected model.

See [`docs/embedding_dimensions_concept.md`](docs/embedding_dimensions_concept.md).

### Apache AGE Graph Initialization

`docker/init-db.sql` enables `vector` and `age`, loads AGE, and creates
`knowledge_graph` on first database initialization. If graph initialization fails
on a fresh database, inspect the database image and extension availability, then
run the initialization SQL again.

### Ollama Connection Errors

- Ensure Ollama is running: `ollama serve`
- Verify local base URLs include `/v1`, for example `http://localhost:11434/v1`
- Check models are pulled: `ollama list`
- Use the explicit Test buttons in Settings after changing provider URLs or models

### OpenAI Key or Model Errors

- Select OpenAI as the relevant provider in Settings.
- Enter and validate the shared OpenAI API key.
- Use the discovered model list after validation or connection testing.
- Select a model from the current in-app model list if a previously saved model is unavailable.

## Hardware Requirements

- **RAM**: 16 GB recommended, 8 GB minimum for smaller local models
- **GPU**: 6 GB+ VRAM for accelerated local inference, optional for CPU mode
- **Storage**: 10 GB+ for models, images, and database data

## License

[MIT](LICENSE)
