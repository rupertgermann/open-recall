import assert from "node:assert/strict";
import test from "node:test";
import { readIngestionStream } from "../src/lib/ingestion/events.ts";

test("folder file errors do not hide subsequent files or the final summary", async () => {
  const events: string[] = [];
  const body = [
    { step: "error", error: true, recoverable: true, message: "File 1 failed" },
    { step: "complete", message: "File 2 complete" },
    { step: "done", summary: { ingested: 1, refreshed: 0, skippedUnchanged: 0, skippedUnsupported: 0, failed: 1, failures: [] } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
  const result = await readIngestionStream(new Response(body), event => { events.push(event.step); });
  assert.deepEqual(events, ["error", "complete", "done"]);
  assert.equal(result.summary?.failed, 1);
});

test("Quick Capture cannot mistake an HTTP 200 error stream or disconnect for success", async () => {
  await assert.rejects(readIngestionStream(new Response('data: {"step":"error","error":true,"message":"Save failed"}\n\n')), /Save failed/);
  await assert.rejects(readIngestionStream(new Response('data: {"step":"complete"}\n\n')), /before completion/);
});

test("HTTP failures preserve the server error message", async () => {
  await assert.rejects(readIngestionStream(Response.json({ error: "Database unavailable" }, { status: 503 })), /Database unavailable/);
  await assert.rejects(readIngestionStream(new Response("Unavailable", { status: 503, headers: { "Content-Type": "application/json" } })), /Unavailable/);
});

test("stream parsing preserves split UTF-8 and event boundaries", async () => {
  const bytes = new TextEncoder().encode('data: {"step":"complete","message":"Grüße"}\n\ndata: {"step":"done"}\n\n');
  const messages: string[] = [];
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  await readIngestionStream(new Response(body), event => { if (event.message) messages.push(event.message); });
  assert.deepEqual(messages, ["Grüße"]);
});
