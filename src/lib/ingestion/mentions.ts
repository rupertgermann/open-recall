export type MentionEntity = {
  id: string;
  name: string;
};

export type MentionChunk = {
  id: string;
  content: string;
};

export type PlannedEntityMention = {
  entityId: string;
  chunkId: string;
  documentId: string;
  confidence: number;
};

export type EntityMentionFallback = {
  entityId: string;
  entityName: string;
  chunkId: string;
};

export type PlanEntityMentionsInput = {
  documentId: string;
  entities: readonly MentionEntity[];
  chunks: readonly MentionChunk[];
};

export type PlanEntityMentionsResult = {
  mentions: PlannedEntityMention[];
  fallbacks: EntityMentionFallback[];
};

export function planEntityMentions({
  documentId,
  entities,
  chunks,
}: PlanEntityMentionsInput): PlanEntityMentionsResult {
  const mentions: PlannedEntityMention[] = [];
  const fallbacks: EntityMentionFallback[] = [];
  const fallbackChunk = chunks[0];

  for (const entity of entities) {
    const matchingChunks = chunks.filter((chunk) => mentionsEntityName(chunk.content, entity.name));

    if (matchingChunks.length === 0) {
      if (fallbackChunk) {
        mentions.push({
          entityId: entity.id,
          chunkId: fallbackChunk.id,
          documentId,
          confidence: 0,
        });
        fallbacks.push({
          entityId: entity.id,
          entityName: entity.name,
          chunkId: fallbackChunk.id,
        });
      }
      continue;
    }

    for (const chunk of matchingChunks) {
      mentions.push({
        entityId: entity.id,
        chunkId: chunk.id,
        documentId,
        confidence: 1,
      });
    }
  }

  return { mentions, fallbacks };
}

function mentionsEntityName(content: string, entityName: string): boolean {
  const normalizedName = entityName.trim().toLocaleLowerCase();
  if (!normalizedName) return false;

  const normalizedContent = content.toLocaleLowerCase();
  let start = normalizedContent.indexOf(normalizedName);

  while (start !== -1) {
    const before = start > 0 ? normalizedContent[start - 1] : "";
    const after = normalizedContent[start + normalizedName.length] ?? "";

    if (hasNameBoundary(normalizedName, before, after)) {
      return true;
    }

    start = normalizedContent.indexOf(normalizedName, start + 1);
  }

  return false;
}

function hasNameBoundary(entityName: string, before: string, after: string): boolean {
  const first = entityName[0] ?? "";
  const last = entityName[entityName.length - 1] ?? "";
  const startsWithWord = isWordCharacter(first);
  const endsWithWord = isWordCharacter(last);

  return (
    (!startsWithWord || !isWordCharacter(before)) &&
    (!endsWithWord || !isWordCharacter(after))
  );
}

function isWordCharacter(character: string): boolean {
  return /^[\p{L}\p{N}_]$/u.test(character);
}
