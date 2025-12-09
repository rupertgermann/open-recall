# open-recall

Privacy-focused, local-first Personal Knowledge Management powered by GraphRAG.

## Features

- **GraphRAG**: Automatically extract entities and relationships to build a semantic knowledge graph
- **Local AI**: Run everything locally with Ollama — your data never leaves your machine
- **Hybrid Search**: Combine vector similarity search with graph traversal for better context
- **Spaced Repetition**: Generate flashcards and review with FSRS algorithm

## Tech Stack

- **Frontend**: Next.js 15, TypeScript, Shadcn UI, TailwindCSS
- **Database**: PostgreSQL with pgvector (vectors) + Apache AGE (graph)
- **AI**: Vercel AI SDK with Ollama/LM Studio support
- **ORM**: Drizzle

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [Ollama](https://ollama.ai/) (for local AI inference)
- Node.js 20+

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
git clone https://github.com/yourusername/open-recall.git
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

### 4. Run database migrations

```bash
npm run db:push
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Docker Deployment (Full Stack)

```bash
# Build and start everything
docker compose up --build

# Or run in detached mode
docker compose up -d --build
```

## Project Structure

```
open-recall/
├── src/
│   ├── app/                 # Next.js App Router pages
│   ├── components/          # React components
│   │   └── ui/              # Shadcn UI components
│   ├── db/                  # Database schema and client
│   ├── hooks/               # React hooks
│   └── lib/
│       ├── ai/              # AI service layer
│       └── content/         # Content extraction & chunking
├── docker/                  # Docker initialization scripts
├── docs/                    # Documentation
├── docker-compose.yml       # Container orchestration
└── drizzle.config.ts        # Drizzle ORM config
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/openrecall` |
| `AI_BASE_URL` | Local AI provider URL | `http://localhost:11434/v1` |
| `AI_MODEL` | Chat/extraction model | `llama3.2:8b` |
| `EMBEDDING_MODEL` | Embedding model | `nomic-embed-text` |
| `OPENAI_API_KEY` | Optional OpenAI key for cloud mode | — |

## Hardware Requirements

- **RAM**: 16GB recommended (8GB minimum)
- **GPU**: 6GB+ VRAM for accelerated inference (optional, CPU works)
- **Storage**: 10GB+ for models and database

## Development

```bash
# Run development server
npm run dev

# Generate database migrations
npm run db:generate

# Push schema changes
npm run db:push

# Open Drizzle Studio
npm run db:studio

# Lint
npm run lint
```

## License

MIT
