import http from "http";
import Busboy from "busboy";
import {
  DEFAULT_GLM_OCR_MODEL,
  DEFAULT_LMSTUDIO_BASE_URL,
  DEFAULT_LMSTUDIO_OCR_PORT,
  LmStudioApiMode,
  LmStudioOcrMode,
  convertLmStudioArtifactToOcrResults,
  ensureLmStudioModelLoaded,
  getLmStudioModelStatus,
  runLmStudioOcr,
} from "./lmstudio.js";
import pkg from "../../../package.json" with { type: "json" };

export interface LmStudioOcrServerOptions {
  apiKey?: string;
  apiMode?: LmStudioApiMode;
  autoLoadModel?: boolean;
  baseUrl?: string;
  concurrency?: number;
  contextLength?: number;
  host?: string;
  maxImageBytes?: number;
  maxOutputTokens?: number;
  mode?: LmStudioOcrMode;
  model?: string;
  port?: number;
  strictBbox?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

interface MultipartUpload {
  buffer: Buffer;
  fields: Record<string, string>;
  filename?: string;
  mimeType?: string;
}

export function startLmStudioOcrServer(options: LmStudioOcrServerOptions = {}): http.Server {
  const server = createLmStudioOcrServer(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? DEFAULT_LMSTUDIO_OCR_PORT;
  server.listen(port, host);
  return server;
}

export function createLmStudioOcrServer(options: LmStudioOcrServerOptions = {}): http.Server {
  const resolved = resolveServerOptions(options);
  let activeRequests = 0;
  const queue: (() => void)[] = [];

  async function withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
    if (activeRequests >= resolved.concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    activeRequests += 1;
    try {
      return await fn();
    } finally {
      activeRequests -= 1;
      queue.shift()?.();
    }
  }

  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url?.startsWith("/health")) {
        await handleHealth(response, resolved);
        return;
      }

      if (request.method === "POST" && (request.url === "/ocr" || request.url === "/ocr/analyze")) {
        const upload = await readMultipartUpload(request, resolved.maxImageBytes);
        const mode = coerceMode(upload.fields.mode) ?? resolved.mode;
        const artifact = await withConcurrency(() =>
          runLmStudioOcr(upload.buffer, {
            apiKey: resolved.apiKey,
            apiMode: resolved.apiMode,
            autoLoadModel: resolved.autoLoadModel,
            baseUrl: resolved.baseUrl,
            contextLength: resolved.contextLength,
            maxOutputTokens: resolved.maxOutputTokens,
            mode,
            model: resolved.model,
            strictBbox: resolved.strictBbox,
            temperature: resolved.temperature,
            timeoutMs: resolved.timeoutMs,
          })
        );

        if (request.url === "/ocr/analyze") {
          writeJson(response, artifact.ok ? 200 : 502, artifact);
          return;
        }

        if (!artifact.ok) {
          writeJson(response, 502, {
            error: artifact.error ?? "LM Studio OCR failed",
            model: artifact.model,
            mode: artifact.mode,
          });
          return;
        }

        const converted = convertLmStudioArtifactToOcrResults(artifact, {
          strictBbox: resolved.strictBbox,
        });
        writeJson(response, 200, {
          results: converted.results,
          engine: "lmstudio-glm-ocr",
          model: artifact.model,
          mode: artifact.mode,
          warnings: converted.warnings,
        });
        return;
      }

      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof MultipartError ? error.statusCode : 500;
      writeJson(response, status, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function handleHealth(
  response: http.ServerResponse,
  options: Required<LmStudioOcrServerOptions>
): Promise<void> {
  let load: { ok: boolean; loaded: boolean; attempted_load: boolean; error?: string } | undefined;
  if (options.autoLoadModel) {
    load = await ensureLmStudioModelLoaded({
      baseUrl: options.baseUrl,
      model: options.model,
      timeoutMs: options.timeoutMs,
    });
  }
  const modelStatus = await getLmStudioModelStatus(options.baseUrl, options.model);
  writeJson(response, load?.ok === false ? 503 : 200, {
    status: load?.ok === false ? "degraded" : "ok",
    liteparse_version: pkg.version,
    engine: "lmstudio-glm-ocr",
    base_url: options.baseUrl,
    model: options.model,
    model_available: modelStatus.available,
    model_loaded: modelStatus.loaded,
    auto_load_model: options.autoLoadModel,
    auto_load_attempted: load?.attempted_load ?? false,
    api_mode: options.apiMode,
    modes: ["auto", "text", "layout", "table", "formula", "diagram"],
    concurrency: options.concurrency,
    error: load?.error ?? modelStatus.error,
  });
}

function readMultipartUpload(
  request: http.IncomingMessage,
  maxImageBytes: number
): Promise<MultipartUpload> {
  return new Promise((resolve, reject) => {
    const contentType = request.headers["content-type"];
    if (!contentType?.includes("multipart/form-data")) {
      reject(new MultipartError(400, "Expected multipart/form-data"));
      return;
    }

    const busboy = Busboy({ headers: request.headers });
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let filename: string | undefined;
    let mimeType: string | undefined;
    let totalBytes = 0;

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "file") {
        file.resume();
        return;
      }
      filename = info.filename;
      mimeType = info.mimeType;
      file.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxImageBytes) {
          file.destroy(new MultipartError(413, `Uploaded image exceeds ${maxImageBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
    });
    busboy.on("field", (name, value) => {
      fields[name] = value;
    });
    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (chunks.length === 0) {
        reject(new MultipartError(400, "Missing file field"));
        return;
      }
      resolve({ buffer: Buffer.concat(chunks), fields, filename, mimeType });
    });
    request.pipe(busboy);
  });
}

function resolveServerOptions(
  options: LmStudioOcrServerOptions
): Required<LmStudioOcrServerOptions> {
  return {
    apiKey: options.apiKey ?? process.env.LITEPARSE_LMSTUDIO_API_KEY ?? "",
    apiMode: options.apiMode ?? "lmstudio-native",
    autoLoadModel: options.autoLoadModel ?? true,
    baseUrl:
      options.baseUrl ?? process.env.LITEPARSE_LMSTUDIO_BASE_URL ?? DEFAULT_LMSTUDIO_BASE_URL,
    concurrency: options.concurrency ?? 1,
    contextLength: options.contextLength ?? 16_384,
    host: options.host ?? "127.0.0.1",
    maxImageBytes: options.maxImageBytes ?? 25 * 1024 * 1024,
    maxOutputTokens: options.maxOutputTokens ?? 2_048,
    mode: options.mode ?? "auto",
    model: options.model ?? process.env.LITEPARSE_GLM_OCR_MODEL ?? DEFAULT_GLM_OCR_MODEL,
    port: options.port ?? DEFAULT_LMSTUDIO_OCR_PORT,
    strictBbox: options.strictBbox ?? false,
    temperature: options.temperature ?? 0,
    timeoutMs: options.timeoutMs ?? 120_000,
  };
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function coerceMode(value: string | undefined): LmStudioOcrMode | undefined {
  if (
    value === "auto" ||
    value === "text" ||
    value === "layout" ||
    value === "table" ||
    value === "formula" ||
    value === "diagram"
  ) {
    return value;
  }
  return undefined;
}

class MultipartError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
