import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TestDatabase } from "./db.ts";

export let database: TestDatabase["db"];

export function useDatabase(db: TestDatabase["db"]) {
  database = db;
}

const databaseModule = `data:text/javascript,${encodeURIComponent(`export { database as db } from ${JSON.stringify(import.meta.url)}`)}`;
const cacheModule = "data:text/javascript,export function revalidatePath() {}";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/db") return { url: databaseModule, shortCircuit: true };
    if (specifier === "next/cache" || specifier === "next/cache.js") {
      return { url: cacheModule, shortCircuit: true };
    }
    const url = specifier.startsWith("@/")
      ? new URL(`../../src/${specifier.slice(2)}`, import.meta.url)
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
        ? new URL(specifier, context.parentURL)
        : null;
    if (url) {
      const path = fileURLToPath(url);
      for (const suffix of [".ts", "/index.ts"]) {
        if (existsSync(path + suffix)) {
          return { url: pathToFileURL(path + suffix).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
