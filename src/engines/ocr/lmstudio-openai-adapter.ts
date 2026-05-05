import http from "http";
import axios from "axios";
import {
  DEFAULT_GLM_OCR_MODEL,
  DEFAULT_LMSTUDIO_BASE_URL,
  ensureLmStudioModelLoaded,
  getLmStudioModelStatus,
} from "./lmstudio.js";

export const DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT = 8832;

export interface LmStudioOpenAiAdapterOptions {
  autoLoadModel?: boolean;
  baseUrl?: string;
  contextLength?: number;
  host?: string;
  maxBodyBytes?: number;
  model?: string;
  port?: number;
  timeoutMs?: number;
}

export interface OpenAiChatPayload {
  max_tokens?: unknown;
  messages?: unknown;
  model?: unknown;
  temperature?: unknown;
  top_p?: unknown;
}

export function startLmStudioOpenAiAdapter(
  options: LmStudioOpenAiAdapterOptions = {}
): http.Server {
  const server = createLmStudioOpenAiAdapter(options);
  server.listen(options.port ?? DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT, options.host ?? "127.0.0.1");
  return server;
}

export function createLmStudioOpenAiAdapter(
  options: LmStudioOpenAiAdapterOptions = {}
): http.Server {
  const resolved = resolveOptions(options);

  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url?.startsWith("/health")) {
        const modelStatus = await getLmStudioModelStatus(resolved.baseUrl, resolved.model);
        writeJson(response, modelStatus.available ? 200 : 503, {
          status: modelStatus.available ? "ok" : "degraded",
          engine: "lmstudio-openai-adapter",
          base_url: resolved.baseUrl,
          model: resolved.model,
          model_available: modelStatus.available,
          model_loaded: modelStatus.loaded,
          error: modelStatus.error,
        });
        return;
      }

      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        writeJson(response, 404, { error: "Not found" });
        return;
      }

      if (resolved.autoLoadModel) {
        const loadResult = await ensureLmStudioModelLoaded({
          baseUrl: resolved.baseUrl,
          model: resolved.model,
          timeoutMs: resolved.timeoutMs,
        });
        if (!loadResult.ok) {
          writeJson(response, 503, {
            error: loadResult.error ?? "failed to auto-load LM Studio model",
            model: resolved.model,
          });
          return;
        }
      }

      const payload = (await readJsonBody(request, resolved.maxBodyBytes)) as OpenAiChatPayload;
      const nativePayload = openAiChatPayloadToLmStudioNative(payload, {
        contextLength: resolved.contextLength,
        fallbackModel: resolved.model,
      });
      const lmResponse = await axios.post(`${resolved.baseUrl}/api/v1/chat`, nativePayload, {
        headers: { "Content-Type": "application/json" },
        timeout: resolved.timeoutMs,
        validateStatus: () => true,
      });

      if (lmResponse.status < 200 || lmResponse.status >= 300) {
        writeJson(response, 502, {
          error: "LM Studio native chat failed",
          status_code: lmResponse.status,
          response: lmResponse.data,
        });
        return;
      }

      writeJson(response, 200, {
        id: `chatcmpl-liteparse-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: nativePayload.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: extractLmStudioNativeText(lmResponse.data).trim(),
            },
            finish_reason: "stop",
          },
        ],
      });
    } catch (error) {
      const status = error instanceof HttpBodyError ? error.statusCode : 500;
      writeJson(response, status, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export function openAiChatPayloadToLmStudioNative(
  payload: OpenAiChatPayload,
  options: { contextLength: number; fallbackModel: string }
): Record<string, unknown> {
  const input: Array<Record<string, string>> = [];
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const content = message.content;
    if (typeof content === "string") {
      input.push({ type: "text", content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part.type === "text" && typeof part.text === "string") {
        input.push({ type: "text", content: part.text });
      } else if (part.type === "image_url") {
        const imageUrl = part.image_url;
        const url =
          isRecord(imageUrl) && typeof imageUrl.url === "string" ? imageUrl.url : undefined;
        if (url) input.push({ type: "image", data_url: url });
      }
    }
  }

  const model =
    typeof payload.model === "string" && payload.model ? payload.model : options.fallbackModel;
  return {
    context_length: options.contextLength,
    input,
    max_output_tokens: numberValue(payload.max_tokens) ?? 8192,
    model,
    store: false,
    temperature: numberValue(payload.temperature) ?? 0,
    top_p: numberValue(payload.top_p) ?? 1,
  };
}

export function extractLmStudioNativeText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!isRecord(raw)) return "";
  if (typeof raw.output_text === "string") return raw.output_text;
  const output = raw.output;
  if (Array.isArray(output)) {
    return output
      .filter(isRecord)
      .map((item) => {
        if (typeof item.content === "string") return item.content;
        if (Array.isArray(item.content)) {
          return item.content
            .filter(isRecord)
            .map((part) => (typeof part.text === "string" ? part.text : ""))
            .filter(Boolean)
            .join("\n");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof raw.response === "string") return raw.response;
  if (typeof raw.content === "string") return raw.content;
  return "";
}

function resolveOptions(
  options: LmStudioOpenAiAdapterOptions
): Required<LmStudioOpenAiAdapterOptions> {
  return {
    autoLoadModel: options.autoLoadModel ?? true,
    baseUrl: normalizeBaseUrl(
      options.baseUrl ?? process.env.LITEPARSE_LMSTUDIO_BASE_URL ?? DEFAULT_LMSTUDIO_BASE_URL
    ),
    contextLength: options.contextLength ?? 16_384,
    host: options.host ?? "127.0.0.1",
    maxBodyBytes: options.maxBodyBytes ?? 25 * 1024 * 1024,
    model: options.model ?? process.env.LITEPARSE_GLM_OCR_MODEL ?? DEFAULT_GLM_OCR_MODEL,
    port: options.port ?? DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT,
    timeoutMs: options.timeoutMs ?? 120_000,
  };
}

function readJsonBody(request: http.IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        reject(new HttpBodyError(413, `Request body exceeds ${maxBodyBytes} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown);
      } catch {
        reject(new HttpBodyError(400, "Invalid JSON payload"));
      }
    });
  });
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

class HttpBodyError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
