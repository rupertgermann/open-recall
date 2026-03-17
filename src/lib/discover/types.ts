export type DiscoverEntitySummary = {
  id: string;
  name: string;
  type: string;
  description: string | null;
};

export type DiscoverRelatedEntity = {
  id: string;
  name: string;
  type: string;
};

export type DiscoverDocumentReference = {
  id: string;
  title: string;
};

export type HiddenConnection = {
  key: string;
  entityA: DiscoverEntitySummary;
  entityB: DiscoverEntitySummary;
  bridge: DiscoverEntitySummary;
  relationABridge: string;
  relationBridgeB: string;
  sourceDocuments: DiscoverDocumentReference[];
};

export type BridgeEntity = DiscoverEntitySummary & {
  connectionCount: number;
  connectedEntities: DiscoverRelatedEntity[];
};

export type KnowledgeCluster = {
  id: string;
  name: string;
  dominantType: string;
  members: DiscoverRelatedEntity[];
  memberCount: number;
  bridgeEntities: DiscoverRelatedEntity[];
};

export type DiscoverStats = {
  totalEntities: number;
  totalRelationships: number;
  clustersFound: number;
  potentialInsights: number;
};

export type DiscoverData = {
  stats: DiscoverStats;
  connections: HiddenConnection[];
  bridges: BridgeEntity[];
  clusters: KnowledgeCluster[];
  savedInsights: Record<string, string>;
};
