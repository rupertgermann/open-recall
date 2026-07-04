import {
  GOGCLI_AUTH_COMMAND,
  GOGCLI_INSTALL_INSTRUCTIONS,
  createGogRunner,
  isMissingGogError,
  isUnauthenticatedGogError,
  type GogRunner,
} from "./index.ts";

export type GogStatus =
  | {
      state: "not_installed";
      installInstructions: string;
    }
  | {
      state: "not_authenticated";
      authCommand: string;
    }
  | {
      state: "ready";
      version: string;
      accountEmail: string;
    };

export async function resolveGogStatus(
  options: { runner?: GogRunner } = {}
): Promise<GogStatus> {
  const runner = options.runner ?? createGogRunner();

  let version: string;
  try {
    version = parseGogVersion(await runner(["version", "--json"]));
  } catch (error) {
    if (isMissingGogError(error)) {
      return {
        state: "not_installed",
        installInstructions: GOGCLI_INSTALL_INSTRUCTIONS,
      };
    }

    throw error;
  }

  try {
    const accountEmail = parseGogAccountEmail(await runner([
      "auth",
      "list",
      "--json",
      "--results-only",
      "--no-input",
    ]));
    if (accountEmail) {
      return {
        state: "ready",
        version,
        accountEmail,
      };
    }
  } catch (error) {
    if (isMissingGogError(error)) {
      return {
        state: "not_installed",
        installInstructions: GOGCLI_INSTALL_INSTRUCTIONS,
      };
    }

    if (isUnauthenticatedGogError(error)) {
      return {
        state: "not_authenticated",
        authCommand: GOGCLI_AUTH_COMMAND,
      };
    }

    throw error;
  }

  return {
    state: "not_authenticated",
    authCommand: GOGCLI_AUTH_COMMAND,
  };
}

function parseGogVersion(response: unknown): string {
  const version = findStringField(response, ["version", "gogVersion", "gogcliVersion"]);
  if (!version) throw new Error("gogcli did not return a version");
  return version;
}

function parseGogAccountEmail(response: unknown): string | null {
  const records = collectRecords(response);
  const driveAccount = records.find((record) => hasDriveService(record) && stringField(record, "email"));
  return (
    (driveAccount ? stringField(driveAccount, "email") : undefined) ??
    findStringField(response, ["email", "accountEmail"]) ??
    null
  );
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRecords(item));
  }

  if (!isRecord(value)) return [];

  return [
    value,
    ...Object.values(value).flatMap((child) => collectRecords(child)),
  ];
}

function findStringField(value: unknown, fields: string[]): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  const records = collectRecords(value);

  for (const record of records) {
    for (const field of fields) {
      const value = stringField(record, field);
      if (value) return value;
    }
  }

  return undefined;
}

function hasDriveService(record: Record<string, unknown>): boolean {
  const services = record.services ?? record.service;
  if (typeof services === "string") return services === "drive";
  return Array.isArray(services) && services.includes("drive");
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
