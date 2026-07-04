export type EntityKeyParts = {
  name: string;
  type: string;
};

declare const entityKeyBrand: unique symbol;

export type EntityKey = string & {
  readonly [entityKeyBrand]: "EntityKey";
};

const ENTITY_KEY_ENCODING_VERSION = 1;

type EncodedEntityKey = readonly [typeof ENTITY_KEY_ENCODING_VERSION, string, string];

export function makeEntityKey({ name, type }: EntityKeyParts): EntityKey {
  const encoded: EncodedEntityKey = [ENTITY_KEY_ENCODING_VERSION, name, type];
  return JSON.stringify(encoded) as EntityKey;
}

export function parseEntityKey(key: EntityKey): EntityKeyParts {
  let parsed: unknown;

  try {
    parsed = JSON.parse(key);
  } catch {
    throw new Error("Invalid Entity Key");
  }

  if (!isEncodedEntityKey(parsed)) {
    throw new Error("Invalid Entity Key");
  }

  return { name: parsed[1], type: parsed[2] };
}

export function entityKeysEqual(left: EntityKey, right: EntityKey): boolean {
  const leftParts = parseEntityKey(left);
  const rightParts = parseEntityKey(right);

  return leftParts.name === rightParts.name && leftParts.type === rightParts.type;
}

function isEncodedEntityKey(value: unknown): value is EncodedEntityKey {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === ENTITY_KEY_ENCODING_VERSION &&
    typeof value[1] === "string" &&
    typeof value[2] === "string"
  );
}
