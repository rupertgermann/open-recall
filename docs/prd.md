# Product Requirements Document (PRD): open-recall

## 1. Overview
**open-recall** is a privacy-focused, local-first Personal Knowledge Management (PKM) application. It automates the process of saving, summarizing, and linking digital content. Unlike standard note-taking apps, it utilizes **GraphRAG** (Graph Retrieval-Augmented Generation) to structure data into a semantic graph. This allows for deeper insights and connections between disparate pieces of information, all while running completely offline using local LLMs.

## 2. Problem Statement
Users desire the advanced capabilities of AI summarization and automatic knowledge connection found in cloud-based tools (like Recall.ai). However, many users have significant privacy concerns regarding their personal data, or they wish to avoid subscription costs and vendor lock-in. Existing open-source tools rarely offer a seamless "Local LLM" experience that successfully combines Vector Search with structured Knowledge Graphs.

## 3. Tech Stack Requirements

### 3.1 Frontend & Application
*   **Framework:** Next.js (App Router)
*   **Language:** TypeScript
*   **UI Component Library:** Shadcn UI (Radix Primitives + Tailwind CSS)
*   **State Management:** React Query (TanStack Query) for managing async data states.
*   **Graph Visualization:** A 2D/3D force-directed graph library capable of handling interactive node link visualizations (e.g., React Force Graph or CosmoGraph).

### 3.2 Backend & Data (Local First)
*   **Database:** PostgreSQL with extensions for hybrid data storage.
*   **Vector Store:** pgvector extension for high-dimensional vector embeddings and similarity search.
*   **Graph Store:** Apache AGE extension for native graph queries (Cypher-compatible) enabling proper graph traversal semantics.
*   **ORM:** Drizzle ORM for type-safe database operations compatible with server actions.
*   **Containerization:** Docker Compose orchestration for one-click local deployment of the full stack.

### 3.3 AI & Intelligence
*   **LLM Orchestration:** Vercel AI SDK for unified streaming and model interaction across providers.
*   **Local AI Provider:** Ollama (primary) or LM Studio providing OpenAI-compatible API endpoints.
*   **Recommended Models:**
    *   Chat/Extraction: llama3.2:8b, mistral:7b, qwen2.5:7b
    *   Embeddings: nomic-embed-text, mxbai-embed-large
*   **Structured Output:** Zod schemas with JSON mode for reliable entity extraction from local LLMs.
*   **Fallback Strategy:** Retry with simplified prompts if structured extraction fails; graceful degradation to basic chunking.

### 3.4 Content Extraction
*   **Web Articles:** Mozilla Readability for clean content extraction from web pages.
*   **YouTube:** yt-dlp or youtube-transcript-api for transcript retrieval.
*   **PDF:** pdfjs-dist for text extraction from PDF documents.

### 3.5 Minimum Hardware Requirements
*   **RAM:** 16GB recommended (8GB minimum for smaller models).
*   **GPU (optional):** 6GB+ VRAM for accelerated inference; CPU-only mode supported.
*   **Storage:** 10GB+ for models and database.
*   **Supported Models:** 7B parameter models (quantized Q4/Q5) run comfortably on consumer hardware.

## 4. Core Features & Functional Requirements

### 4.1 Local-First Configuration
*   **Settings Interface:** A dedicated settings panel allowing users to toggle between "Cloud" and "Local" AI providers.
*   **Connection Configuration:** Fields to input the Local Base URL and select specific models available on the user's machine.
*   **Deployment:** The application must utilize a container orchestration file to start both the application and the database simultaneously with a single command.

### 4.2 GraphRAG Ingestion Pipeline
The ingestion process goes beyond simple text storage. It must follow a specific pipeline:
1.  **Extraction:** Scrape text from the source (YouTube transcript, Web Article, PDF).
2.  **Chunking:** Split the text into logical segments for processing.
3.  **Entity & Relation Extraction (The Graph):** The system prompts the Local LLM to identify key entities (People, Concepts, Tools) and the relationships between them, outputting structured data.
4.  **Embedding (The RAG):** The system generates vector embeddings for the text chunks.
5.  **Storage:** All chunks, vectors, discovered entities, and relationships are stored in the relational database.

### 4.3 The "Graph-Augmented" Chat
*   **Hybrid Retrieval Logic:** When a user asks a question, the system must perform two distinct lookups:
    1.  **Vector Search:** Find text chunks that are mathematically similar to the query.
    2.  **Graph Traversal:** Identify entities in the query and "walk" the graph in the database to find related concepts that may not share similar keywords but are contextually linked.
*   **Context Assembly:** The system combines results from both the Vector Search and Graph Traversal before sending them to the LLM to generate an answer.

### 4.4 The Knowledge Card (UI)
*   **Split View:** A reading interface displaying the original content on one side and the AI analysis on the other.
*   **Graph Insight:** A specific visualization widget showing how the current card connects to other nodes in the existing database.
*   **Interactive Entities:** Recognized entities within the summary should be clickable. Clicking an entity (e.g., a specific technology) opens a view showing every other content piece that mentions it.

### 4.5 Spaced Repetition (SRS)
*   **Local Processing:** Quiz generation occurs locally on the user's machine.
*   **Algorithm:** Implementation of an algorithm like FSRS (Free Spaced Repetition Scheduler) to determine optimal review intervals.
*   **Review Interface:** A flashcard-style interface for reviewing generated questions.

### 4.6 Data Portability & Backup
*   **Export:** Full database export to JSON and Markdown formats for interoperability.
*   **Import:** Support for importing from common PKM formats (Obsidian vault, Notion exports, browser bookmarks).
*   **Backup:** One-click local backup functionality with timestamped archives.
*   **Data Ownership:** All data stored locally in user-accessible formats; no proprietary lock-in.

## 5. Data Model Description

The database schema must support a hybrid approach, handling both standard document storage and graph structures.

*   **Documents:** Stores metadata about the source content (URL, Title, Type, Creation Date).
*   **Chunks:** Represents the text segments derived from documents, containing the actual text content and its corresponding high-dimensional vector embedding.
*   **Entities:** Represents the nodes in the knowledge graph. These distinct items (e.g., "React", "Biology") must be unique and categorized by type.
*   **Entity Mentions:** A linking table that tracks which specific text chunks mention which Entities, allowing the system to trace back from a concept to the exact sentence where it was discussed.
*   **Relationships:** Represents the edges of the graph. This table stores the source entity, the target entity, and a description of the relationship (e.g., "Parent of", "Built with").
*   **SRS Items:** Stores flashcards, including the question, answer, and scheduling parameters (stability, difficulty, due date).

## 6. UI/UX Guidelines

### 6.1 Status Indicators
*   **Optimistic UI:** Given that local LLMs can be slower than cloud providers, the interface must provide immediate feedback.
*   **Processing Queue:** A visual component must display the status of the ingestion pipeline (e.g., "Parsing...", "Extracting Entities...", "Embedding...").
*   **Streaming Responses:** Chat answers must stream character-by-character to reduce perceived latency.

### 6.2 The Graph Visualization
*   **Visual Structure:** Nodes should be sized according to their centrality (how many connections they have) to highlight important concepts.
*   **Color Coding:** Nodes should be colored based on their Entity Type (e.g., People in one color, Concepts in another).
*   **Filtering:** Users should be able to filter the graph to show only direct connections to the content they are currently viewing.

## 7. Development Roadmap

### Phase 1: Local Infrastructure & Ingestion
*   Establish the containerized environment (Database + App).
*   Implement the database schema and ORM setup.
*   Build the AI Service Layer to abstract interactions with the local LLM.
*   Create the basic "Add Link" pipeline (Scrape -> Chunk -> Embed).

### Phase 2: Graph Extraction (The "Smart" Layer)
*   Design and test system prompts for accurate Entity and Relationship extraction.
*   Implement the logic to parse LLM outputs and save them as structured graph data.
*   Build the primary list view for saved content.

### Phase 3: RAG & Chat
*   Implement Vector Search functionality using the database's vector capabilities.
*   Implement Graph Lookup logic to query related entities.
*   Build the Chat UI and integrate the hybrid retrieval context.

### Phase 4: Visualization & Polish
*   Integrate the graph visualization library.
*   Implement the Spaced Repetition logic and Review UI.
*   Finalize the distribution strategy (Docker images).