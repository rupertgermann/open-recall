export interface Chunk {
  content: string;
  index: number;
  tokenCount: number;
}

export interface ChunkerOptions {
  maxChunkSize?: number; // Maximum characters per chunk
  overlap?: number; // Character overlap between chunks
  separators?: string[]; // Preferred split points
}

const DEFAULT_OPTIONS: Required<ChunkerOptions> = {
  maxChunkSize: 1000,
  overlap: 100,
  separators: ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " "],
};

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks with semantic awareness
 */
export function chunkText(
  text: string,
  options: ChunkerOptions = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: Chunk[] = [];

  if (!text || text.length === 0) {
    return chunks;
  }

  // If text is smaller than max chunk size, return as single chunk
  if (text.length <= opts.maxChunkSize) {
    return [
      {
        content: text.trim(),
        index: 0,
        tokenCount: estimateTokens(text),
      },
    ];
  }

  let currentPosition = 0;
  let chunkIndex = 0;

  while (currentPosition < text.length) {
    // Determine the end position for this chunk
    let endPosition = Math.min(
      currentPosition + opts.maxChunkSize,
      text.length
    );

    // If we're not at the end, try to find a good break point
    if (endPosition < text.length) {
      let bestBreak = -1;

      // Look for separators in order of preference
      for (const separator of opts.separators) {
        // Search backwards from endPosition for the separator
        const searchStart = Math.max(
          currentPosition + opts.maxChunkSize / 2,
          currentPosition
        );
        const searchText = text.slice(searchStart, endPosition);
        const lastIndex = searchText.lastIndexOf(separator);

        if (lastIndex !== -1) {
          bestBreak = searchStart + lastIndex + separator.length;
          break;
        }
      }

      if (bestBreak > currentPosition) {
        endPosition = bestBreak;
      }
    }

    // Extract the chunk
    const chunkContent = text.slice(currentPosition, endPosition).trim();

    if (chunkContent.length > 0) {
      chunks.push({
        content: chunkContent,
        index: chunkIndex,
        tokenCount: estimateTokens(chunkContent),
      });
      chunkIndex++;
    }

    // Move position, accounting for overlap
    currentPosition = endPosition - opts.overlap;

    // Ensure we make progress
    if (currentPosition <= (chunks[chunks.length - 1]?.index ?? 0)) {
      currentPosition = endPosition;
    }
  }

  return chunks;
}

/**
 * Chunk by paragraphs, merging small ones
 */
export function chunkByParagraphs(
  text: string,
  options: ChunkerOptions = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const chunks: Chunk[] = [];

  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    // If adding this paragraph would exceed max size, save current and start new
    if (
      currentChunk.length > 0 &&
      currentChunk.length + trimmedParagraph.length + 2 > opts.maxChunkSize
    ) {
      chunks.push({
        content: currentChunk,
        index: chunkIndex,
        tokenCount: estimateTokens(currentChunk),
      });
      chunkIndex++;
      currentChunk = "";
    }

    // If single paragraph exceeds max size, split it
    if (trimmedParagraph.length > opts.maxChunkSize) {
      // Save any accumulated content first
      if (currentChunk.length > 0) {
        chunks.push({
          content: currentChunk,
          index: chunkIndex,
          tokenCount: estimateTokens(currentChunk),
        });
        chunkIndex++;
        currentChunk = "";
      }

      // Split the large paragraph
      const subChunks = chunkText(trimmedParagraph, opts);
      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          index: chunkIndex,
        });
        chunkIndex++;
      }
    } else {
      // Add paragraph to current chunk
      currentChunk =
        currentChunk.length > 0
          ? `${currentChunk}\n\n${trimmedParagraph}`
          : trimmedParagraph;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk,
      index: chunkIndex,
      tokenCount: estimateTokens(currentChunk),
    });
  }

  return chunks;
}
