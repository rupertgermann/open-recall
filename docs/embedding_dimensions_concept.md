# Concept: Handling Dynamic Embedding Dimensions

## The Challenge

Different embedding models produce vectors of different dimensions. For example:
- **nomic-embed-text** (Local): 768 dimensions
- **text-embedding-3-small** (OpenAI): 1536 dimensions
- **text-embedding-3-large** (OpenAI): 3072 dimensions

In a vector database using `pgvector`, calculating the distance (similarity) between two vectors requires them to have the exact same dimensionality. You cannot compare a 768d vector with a 1536d vector.

## Current Architecture

Open Recall currently uses a single `embedding` column in the `chunks` and `entities` tables.
- **Initially**: Defined as `vector(768)`.
- **Updated**: Defined as `vector` (generic length) to allow schema flexibility.

### The Issue
While the database schema now accepts vectors of any length, the application logic faces a semantic validity problem:
1. **Hybrid Data**: If a user switches from Local (768d) to OpenAI (1536d) without clearing data, the database will contain a mix of 768d and 1536d vectors.
2. **Search Failures**: When performing a search with an OpenAI model, the query vector will be 1536d. Attempting to calculate cosine similarity against older 768d chunks will result in database errors.

## Strategy Options

### 1. Single Model Policy (Current Approach)
Enforce that the entire knowledge base uses a single embedding model at any given time.
- **Pros**: Simple to implement. Guaranteed consistency.
- **Cons**: Switching providers requires a complete re-ingest/re-index of all content.
- **Implementation**: 
  - Warn users when switching providers.
  - Provide a "Re-index All" utility.

### 2. Versioned Embeddings (Recommended for Future)
Store metadata about which model was used to generate each embedding.

**Schema Change:**
```sql
ALTER TABLE chunks ADD COLUMN embedding_model text;
ALTER TABLE chunks ADD COLUMN embedding_version text;
```

**Query Logic:**
When retrieving context:
1. Identify the currently active embedding model.
2. Filter the DB query to only include chunks generated with that model.
   ```sql
   SELECT * FROM chunks 
   WHERE embedding_model = 'text-embedding-3-small'
   ORDER BY embedding <=> query_vector
   ```
3. (Optional) Background jobs could re-embed older chunks with the new model to make them searchable again.

### 3. Multi-Column / Multi-Table Storage
Create specific columns for common dimensions.
- `embedding_768`
- `embedding_1536`
- `embedding_3072`

**Pros**: Database constraints enforce correctness.
**Cons**: Schema migrations required for every new model dimension. Sparse data.

## Proposed Roadmap

### Phase 1: Flexible Schema (Implemented)
- Remove `vector(N)` constraint from Drizzle schema.
- Allow `db:push` to update the column to generic `vector` type.
- Document the need to clear/re-index data when switching providers.

### Phase 2: User Warnings
- In the Settings UI, detect if the selected model dimension differs from the majority of stored data.
- Display a warning: "Changing this model will make existing documents unsearchable until re-indexed."

### Phase 3: Smart Migration
- Add `embedding_model` column to `chunks`.
- When switching models, offer a background job: "Migrate Embeddings".
- This job iterates through all documents, generates new embeddings with the new model, and updates the records.

## Recommendation
For now, we rely on **Phase 1**. The README has been updated to instruct users to clear their database or stick to one provider if they encounter dimension errors. This balances flexibility with implementation complexity for the current stage of the project.
