# open-recall

Privacy-focused, local-first Personal Knowledge Management. Saved web pages and notes become a searchable GraphRAG knowledge base: content, summaries, tags, entities, relationships, chunks, embeddings, and review cards.

## Language

### Knowledge base

**Document**:
A saved web page (article, youtube, pdf), a pasted or imported note, or a file ingested from Google Drive. The root unit of the knowledge base; everything else derives from one. A Document's *type* describes its content kind (article, youtube, pdf, note); its *origin* (web, pasted, Drive) is a separate axis.
_Avoid_: page, item, source (source is the *origin* of a Document, not the Document itself)

**Chunk**:
A structure-aware text slice of a Document with a retrieval embedding. The unit of vector search.
_Avoid_: passage, segment

**Entity**:
A named node in the knowledge graph (person, concept, technology, organization, location, event, product, other). Identified by its name and type together — name alone is ambiguous.
_Avoid_: node, concept (concept is one Entity *type*, not the general term)

**Entity Key**:
The identity of an Entity: its name–type pair. Two Entities with the same name but different types are different Entities.
_Avoid_: entity id (the database id is storage, not identity), name

**Entity Mention**:
A link between an Entity and the Chunk/Document where it appears, with a confidence: 1 when the name was matched in the Chunk, 0 for a fallback placement.
_Avoid_: occurrence, reference

**Relationship**:
A directed edge between two Entities (source → target) with a relation type, weight, and the originating Document.
_Avoid_: edge, link, connection (Discover's "hidden connection" is a graph analysis result, not a Relationship)

### Ingestion

**Derived Document Data**:
Everything computed from a Document's content in one ingestion run: content hash, Chunks with embeddings, summary, tags, Entities, Relationships, and embeddings for Entities new to the graph. Built first, persisted afterwards.
_Avoid_: derived data (say the full term), ingestion result

**Document Persistence**:
Saving one Document's Derived Document Data as a single transaction — replacing prior derived rows on re-ingest. Owns the replacement order and the Entity upsert.
_Avoid_: save step, write phase

**Source Refresh**:
Re-ingesting a source-backed Document. Skips rebuilding Derived Document Data when both the content hash and the embedding model are unchanged.
_Avoid_: re-sync, update

**Drive File**:
A Google Drive file ingested as a Document. Identified by its Drive file ID, which is stable across renames and moves; ingesting the same Drive File twice refreshes the existing Document instead of creating a duplicate.
_Avoid_: drive document (collides with Google Docs), synced file (there is no sync)

**Folder Import**:
One-shot ingestion of all supported files in a Drive folder and its subfolders, after user confirmation of the file count. Idempotent: re-importing refreshes existing Documents and skips unchanged ones. Unsupported files are skipped and reported.
_Avoid_: sync, folder watch (both imply continuous behavior; Folder Import is a single run)

### Retrieval

**GraphRAG retrieval**:
Assembling chat context from vector Chunk search, Entity name matching, and graph-neighborhood expansion.
_Avoid_: RAG (underspecifies the graph part), search (that's the library feature)

**Embedding Cache**:
The content-hash → vector store keyed by (hash, model, purpose) that dedupes embedding generation across runs.

### Review

**SRS Item**:
A flashcard generated from a Document, carrying FSRS-like scheduling state (stability, difficulty, repetitions, lapses, learning state).
_Avoid_: card (in code; "flashcard" is fine in UI copy)

### Configuration

**Provider**:
A configured AI backend — local (Ollama, LM Studio) or OpenAI — selected separately for chat and for embeddings. Database settings override environment defaults.
_Avoid_: backend, vendor, client (a client is code that talks to a Provider)
