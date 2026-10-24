export function completion(content: string): Response {
  return Response.json({
    id: "test", model: "test", created: 0,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

export function chatStream(delta: Record<string, unknown>, finishReason: string): Response {
  const chunks = [
    { id: "test", model: "test", created: 0, choices: [{ index: 0, delta, finish_reason: null }] },
    { id: "test", model: "test", created: 0, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
}

export function ingestionCompletion(body: { messages: { content: string }[] }): Response {
  const system = body.messages[0].content;
  return completion(system.includes("reusable tags") ? JSON.stringify({ tags: ["database"] })
    : system.includes("extracting structured knowledge") ? JSON.stringify({
      entities: [{ name: "Postgres", type: "technology", description: "Database" }], relationships: [],
    }) : "A note about Postgres.");
}

export function embeddings(body: { input: string | string[] }): Response {
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  return Response.json({ data: inputs.map((_, index) => ({ index, embedding: [1, 0, 0] })), usage: { prompt_tokens: 1, total_tokens: 1 } });
}
