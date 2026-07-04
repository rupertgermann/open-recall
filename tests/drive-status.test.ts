import assert from "node:assert/strict";
import test from "node:test";

import {
  GOGCLI_AUTH_COMMAND,
  GOGCLI_INSTALL_INSTRUCTIONS,
  type GogRunner,
} from "../src/lib/drive/index.ts";
import { resolveGogStatus } from "../src/lib/drive/status.ts";

test("resolveGogStatus reports install instructions when gogcli is missing", async () => {
  const runner: GogRunner = async () => {
    const error = new Error("spawn gog ENOENT") as Error & { code?: string };
    error.code = "ENOENT";
    throw error;
  };

  assert.deepEqual(await resolveGogStatus({ runner }), {
    state: "not_installed",
    installInstructions: GOGCLI_INSTALL_INSTRUCTIONS,
  });
});

test("resolveGogStatus reports the Drive auth command when gogcli has no account", async () => {
  const runner: GogRunner = async (args) => {
    if (args[0] === "version") {
      return { version: "gogcli 0.9.0" };
    }

    throw new Error("no authenticated account found");
  };

  assert.deepEqual(await resolveGogStatus({ runner }), {
    state: "not_authenticated",
    authCommand: GOGCLI_AUTH_COMMAND,
  });
});

test("resolveGogStatus reports the Drive auth command for an empty account list", async () => {
  const runner: GogRunner = async (args) => {
    if (args[0] === "version") {
      return { version: "gogcli 0.9.0" };
    }

    if (args[0] === "auth" && args[1] === "list") {
      return { accounts: [] };
    }

    throw new Error(`Unexpected gog args: ${args.join(" ")}`);
  };

  assert.deepEqual(await resolveGogStatus({ runner }), {
    state: "not_authenticated",
    authCommand: GOGCLI_AUTH_COMMAND,
  });
});

test("resolveGogStatus reports version and account email when gogcli is ready", async () => {
  const calls: string[][] = [];
  const runner: GogRunner = async (args) => {
    calls.push(args);

    if (args[0] === "version") {
      return { version: "gogcli 0.9.0" };
    }

    if (args[0] === "auth" && args[1] === "list") {
      return {
        accounts: [
          {
            email: "reader@example.com",
            services: ["drive"],
          },
        ],
      };
    }

    throw new Error(`Unexpected gog args: ${args.join(" ")}`);
  };

  assert.deepEqual(await resolveGogStatus({ runner }), {
    state: "ready",
    version: "gogcli 0.9.0",
    accountEmail: "reader@example.com",
  });
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [
    ["version", "--json"],
    ["auth", "list"],
  ]);
});
