export type SearchResult = {
  id: string;
  title: string;
  type: "document" | "entity" | "chat";
  subtype?: string;
  description?: string;
  href: string;
};

export type DocumentSearchRow = {
  id: string;
  title: string;
  type: string;
  summary?: string | null;
};

export type EntitySearchRow = {
  id: string;
  name: string;
  type: string;
  description?: string | null;
};

export type ChatSearchRow = {
  id: string;
  title: string;
  category?: string | null;
};

function truncateDescription(value: string | null | undefined): string | undefined {
  return value?.slice(0, 100) || undefined;
}

export function mapDocumentSearchResult(doc: DocumentSearchRow): SearchResult {
  const description = truncateDescription(doc.summary);

  return {
    id: doc.id,
    title: doc.title,
    type: "document",
    subtype: doc.type,
    ...(description ? { description } : {}),
    href: `/library/${doc.id}`,
  };
}

export function mapEntitySearchResult(entity: EntitySearchRow): SearchResult {
  const description = truncateDescription(entity.description);

  return {
    id: entity.id,
    title: entity.name,
    type: "entity",
    subtype: entity.type,
    ...(description ? { description } : {}),
    href: `/graph?entity=${entity.id}`,
  };
}

export function mapChatSearchResult(chat: ChatSearchRow): SearchResult {
  return {
    id: chat.id,
    title: chat.title,
    type: "chat",
    subtype: chat.category || undefined,
    href: `/chat/${chat.id}`,
  };
}

export function buildGlobalSearchResults(input: {
  documents: DocumentSearchRow[];
  entities: EntitySearchRow[];
  chats: ChatSearchRow[];
}): SearchResult[] {
  return [
    ...input.documents.map(mapDocumentSearchResult),
    ...input.entities.map(mapEntitySearchResult),
    ...input.chats.map(mapChatSearchResult),
  ];
}
