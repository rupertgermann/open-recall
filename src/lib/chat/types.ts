import type { UIMessage } from "ai";

export type ChatSourceReference = {
  documentId: string;
  title: string;
  score: number;
};

export type ChatEntityReference = {
  id: string;
  name: string;
  type: string;
};

export type ChatMessageMetadata = {
  sources?: ChatSourceReference[];
  entities?: ChatEntityReference[];
  createdAt?: number;
};

export type ChatUIMessage = UIMessage<ChatMessageMetadata>;
