export type IngestionChunkCandidate = {
  content: string;
  contentHash?: string | null;
  chunkIndex: number;
};

export type DedupeDocumentChunksResult<TChunk extends IngestionChunkCandidate> = {
  uniqueChunks: TChunk[];
  duplicates: TChunk[];
  duplicateCount: number;
};

export function dedupeDocumentChunks<TChunk extends IngestionChunkCandidate>(
  chunks: readonly TChunk[]
): DedupeDocumentChunksResult<TChunk> {
  const seenHashes = new Set<string>();
  const uniqueChunks: TChunk[] = [];
  const duplicates: TChunk[] = [];

  for (const chunk of chunks) {
    if (!chunk.contentHash) {
      uniqueChunks.push(chunk);
      continue;
    }

    if (seenHashes.has(chunk.contentHash)) {
      duplicates.push(chunk);
      continue;
    }

    seenHashes.add(chunk.contentHash);
    uniqueChunks.push(chunk);
  }

  return {
    uniqueChunks,
    duplicates,
    duplicateCount: duplicates.length,
  };
}
