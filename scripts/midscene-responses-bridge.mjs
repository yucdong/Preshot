import "dotenv/config";
import http from "node:http";

const listenHost = process.env.MIDSCENE_BRIDGE_HOST ?? "127.0.0.1";
const listenPort = Number.parseInt(process.env.MIDSCENE_BRIDGE_PORT ?? "4142", 10);
const upstreamBaseUrl = (process.env.MIDSCENE_UPSTREAM_BASE_URL ?? "http://localhost:4141/v1").replace(/\/$/, "");

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status < 500 || attempt === attempts) return response;
      lastError = new Error(`Upstream returned ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw lastError;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function responseContentItem(item, role) {
  if (item?.type === "text" && typeof item.text === "string") {
    return { type: role === "assistant" ? "output_text" : "input_text", text: item.text };
  }
  if (item?.type === "image_url" && item.image_url?.url) {
    return {
      type: "input_image",
      image_url: item.image_url.url,
      detail: item.image_url.detail === "original" ? "high" : item.image_url.detail,
    };
  }
  return null;
}

function responseInput(messages) {
  const instructions = messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const input = messages
    .filter((message) => message.role !== "system" && message.role !== "developer")
    .map((message) => {
      const role = message.role === "assistant" ? "assistant" : "user";
      const content = typeof message.content === "string"
        ? [{ type: role === "assistant" ? "output_text" : "input_text", text: message.content }]
        : (message.content ?? []).map((item) => responseContentItem(item, role)).filter(Boolean);
      return { role, content };
    });
  return { instructions, input };
}

function responseText(responseBody) {
  if (typeof responseBody.output_text === "string" && responseBody.output_text) {
    return responseBody.output_text;
  }
  return (responseBody.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
}

function responsesTextFormat(responseFormat) {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json_object") return { type: "json_object" };
  if (responseFormat.type === "json_schema") {
    return {
      type: "json_schema",
      name: responseFormat.json_schema?.name ?? "midscene_response",
      schema: responseFormat.json_schema?.schema ?? {},
      strict: responseFormat.json_schema?.strict ?? true,
    };
  }
  return undefined;
}

function toResponsesRequest(chatBody) {
  const { instructions, input } = responseInput(chatBody.messages ?? []);
  const textFormat = responsesTextFormat(chatBody.response_format);
  const effectiveInput = textFormat
    ? [...input, { role: "user", content: [{ type: "input_text", text: "Return a valid JSON object." }] }]
    : input;
  return {
    model: chatBody.model,
    input: effectiveInput,
    ...(instructions ? { instructions } : {}),
    ...(chatBody.max_tokens ? { max_output_tokens: chatBody.max_tokens } : {}),
    ...(chatBody.reasoning_effort ? { reasoning: { effort: chatBody.reasoning_effort } } : {}),
    ...(textFormat ? { text: { format: textFormat } } : {}),
  };
}

function chatCompletionBody(responseBody, model) {
  const inputTokens = responseBody.usage?.input_tokens ?? 0;
  const outputTokens = responseBody.usage?.output_tokens ?? 0;
  return {
    id: responseBody.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: responseBody.model ?? model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: responseText(responseBody) },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

function sendChatStream(response, completion) {
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });
  const base = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
  };
  response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: completion.choices[0].message.content }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: completion.usage })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function forwardModels(request, response) {
  const upstream = await fetchWithRetry(`${upstreamBaseUrl}/models`, {
    headers: { Authorization: request.headers.authorization ?? "Bearer local-proxy" },
  });
  response.writeHead(upstream.status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function handleChatCompletion(request, response) {
  const chatBody = await readJson(request);
  const upstream = await fetchWithRetry(`${upstreamBaseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: request.headers.authorization ?? "Bearer local-proxy",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toResponsesRequest(chatBody)),
  });
  const responseBody = await upstream.json();
  if (!upstream.ok) {
    sendJson(response, upstream.status, responseBody);
    return;
  }
  const completion = chatCompletionBody(responseBody, chatBody.model);
  if (chatBody.stream) sendChatStream(response, completion);
  else sendJson(response, 200, completion);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${listenHost}:${listenPort}`}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, upstream: upstreamBaseUrl });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      await forwardModels(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleChatCompletion(request, response);
      return;
    }
    sendJson(response, 404, { error: { message: "Not found" } });
  } catch (error) {
    sendJson(response, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(listenPort, listenHost, () => {
  console.log(`Midscene Responses bridge listening on http://${listenHost}:${listenPort}/v1`);
  console.log(`Upstream: ${upstreamBaseUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
