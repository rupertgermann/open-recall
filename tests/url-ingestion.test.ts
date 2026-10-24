import assert from "node:assert/strict";
import test from "node:test";
import { chunks, documents } from "../src/db/schema.ts";
import { createDocumentIngestionService } from "../src/lib/ingestion/service.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { embeddings, ingestionCompletion } from "./helpers/provider.ts";

test("URL ingestion detects PDF responses and URL suffixes while preserving HTML and YouTube", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { saveAISettings } = await import("../src/actions/settings.ts");
  const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
  await saveAISettings({ chat: config, embedding: config });
  const pdf = buildSimplePdf("The actual PDF paragraph.");
  const cases = [
    { url: "https://source.invalid/download?id=123", mime: "application/pdf", type: "pdf" },
    { url: "https://source.invalid/REPORT.PDF", mime: "application/octet-stream", type: "pdf" },
    { url: "https://source.invalid/report.pdf", mime: "", type: "pdf" },
    { url: "https://source.invalid/redirect", finalUrl: "https://cdn.invalid/download", mime: "Application/PDF; charset=binary", type: "pdf" },
    { url: "https://source.invalid/redirect-suffix", finalUrl: "https://cdn.invalid/REPORT.PDF", mime: "application/octet-stream", type: "pdf" },
    { url: "https://source.invalid/article", mime: "text/html", type: "article" },
    { url: "https://youtube.com/watch?v=abc", mime: "text/html", type: "youtube" },
  ];
  const sourceRequests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const source = cases.find(item => item.url === String(url));
    if (source) {
      sourceRequests.push(source.url);
      const response = new Response(source.type === "pdf" ? new Uint8Array(pdf)
        : "<html><title>Postgres</title><article><p>Postgres is a useful database.</p></article></html>",
      { headers: { "content-type": source.mime } });
      if (source.finalUrl) Object.defineProperty(response, "url", { value: source.finalUrl });
      return response;
    }
    const body = JSON.parse(String(init?.body));
    return String(url).endsWith("/embeddings") ? embeddings(body) : ingestionCompletion(body);
  });
  const service = createDocumentIngestionService({ database: db, revalidatePath: () => {} });
  for (const source of cases) {
    const result = await service.ingestUrlDocument(source.url);
    const document = (await db.select().from(documents)).find(row => row.id === result.documentId);
    assert.equal(document?.processingStatus, "completed", source.url);
    assert.equal(document?.type, source.type, source.url);
    const expected = source.type === "pdf" ? "The actual PDF paragraph." : "Postgres is a useful database.";
    assert.equal(document?.content, expected, source.url);
    assert.deepEqual((await db.select().from(chunks)).filter(row => row.documentId === result.documentId).map(row => row.content), [expected]);
  }
  assert.deepEqual(sourceRequests, cases.map(source => source.url), "each source is fetched only once");
});

function buildSimplePdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const offsets: number[] = [];
  let pdf = "%PDF-1.4\n";
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}
