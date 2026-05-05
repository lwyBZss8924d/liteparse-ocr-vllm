import http from "http";
import Busboy from "busboy";
import axios from "axios";
import pkg from "../../../package.json" with { type: "json" };
import {
  GlmOcrConversionResult,
  convertGlmOcrResponseToOcrResults,
  normalizeGlmOcrResponse,
  prepareGlmOcrImageInput,
} from "./glmocr.js";
import {
  GlmOcrRuntimeManager,
  GlmOcrRuntimeOptions,
  ManagedGlmOcrRuntime,
} from "./glmocr-runtime.js";
import { DEFAULT_GLM_OCR_MODEL } from "./lmstudio.js";

export const DEFAULT_GLMOCR_OCR_PORT = 8831;

export interface GlmOcrOcrServerOptions extends GlmOcrRuntimeOptions {
  concurrency?: number;
  host?: string;
  maxImageBytes?: number;
  port?: number;
  strictBbox?: boolean;
}

export interface GlmOcrOcrArtifact {
  conversion: GlmOcrConversionResult;
  engine: "glmocr-pipeline";
  image: {
    height: number;
    mime_type: string;
    width: number;
  };
  input_sha256: string;
  model: string;
  ok: boolean;
  parsed: ReturnType<typeof normalizeGlmOcrResponse>;
  raw_response: unknown;
  runtime: {
    glmocr_server_url: string;
    model_runtime: string;
    ocr_api_url?: string;
    spawned: boolean;
  };
  status_code?: number;
  warnings: string[];
}

interface MultipartUpload {
  buffer: Buffer;
  fields: Record<string, string>;
  filename?: string;
  mimeType?: string;
}

export function startGlmOcrOcrServer(options: GlmOcrOcrServerOptions = {}): http.Server {
  const server = createGlmOcrOcrServer(options);
  server.listen(options.port ?? DEFAULT_GLMOCR_OCR_PORT, options.host ?? "127.0.0.1");
  return server;
}

export function createGlmOcrOcrServer(options: GlmOcrOcrServerOptions = {}): http.Server {
  const resolved = resolveServerOptions(options);
  const runtimeManager = new GlmOcrRuntimeManager(resolved);
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

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url?.startsWith("/health")) {
        await handleHealth(response, resolved, runtimeManager);
        return;
      }

      if (request.method === "POST" && (request.url === "/ocr" || request.url === "/ocr/analyze")) {
        const upload = await readMultipartUpload(request, resolved.maxImageBytes);
        const artifact = await withConcurrency(() =>
          runGlmOcrPipelineOcr(upload.buffer, {
            ...resolved,
            runtimeManager,
            strictBbox: upload.fields.strict_bboxes === "true" ? true : resolved.strictBbox,
          })
        );

        if (request.url === "/ocr/analyze") {
          writeJson(response, artifact.ok ? 200 : 502, artifact);
          return;
        }

        writeJson(response, artifact.ok ? 200 : 502, {
          results: artifact.conversion.results,
          engine: artifact.engine,
          model: artifact.model,
          warnings: artifact.warnings,
          region_count: artifact.conversion.region_count,
          bbox_backed_region_count: artifact.conversion.bbox_backed_region_count,
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

  server.on("close", () => {
    void runtimeManager.close();
  });

  return server;
}

export async function runGlmOcrPipelineOcr(
  image: string | Buffer,
  options: GlmOcrOcrServerOptions & { runtimeManager?: GlmOcrRuntimeManager } = {}
): Promise<GlmOcrOcrArtifact> {
  const imageInfo = await prepareGlmOcrImageInput(image);
  const ownsRuntimeManager = !options.runtimeManager;
  const runtimeManager = options.runtimeManager ?? new GlmOcrRuntimeManager(options);
  try {
    const runtime = await runtimeManager.getRuntime();
    const endpoint = `${runtime.serverUrl.replace(/\/+$/, "")}/glmocr/parse`;
    const response = await axios.post(
      endpoint,
      { images: [imageInfo.dataUrl] },
      {
        headers: { "Content-Type": "application/json" },
        timeout: options.timeoutMs ?? 300_000,
        validateStatus: () => true,
      }
    );
    const rawResponse = response.data;
    const parsed = normalizeGlmOcrResponse(rawResponse);
    const conversion = convertGlmOcrResponseToOcrResults(rawResponse, imageInfo, {
      strictBbox: options.strictBbox ?? true,
    });
    const ok = response.status >= 200 && response.status < 300;
    const warnings = [...new Set([...runtime.warnings, ...conversion.warnings])];
    return {
      conversion,
      engine: "glmocr-pipeline",
      image: {
        height: imageInfo.height,
        mime_type: imageInfo.mimeType,
        width: imageInfo.width,
      },
      input_sha256: imageInfo.sha256,
      model: parsed.model ?? options.model ?? DEFAULT_GLM_OCR_MODEL,
      ok,
      parsed,
      raw_response: rawResponse,
      runtime: runtimeInfo(runtime),
      status_code: response.status,
      warnings,
    };
  } finally {
    if (ownsRuntimeManager) await runtimeManager.close();
  }
}

async function handleHealth(
  response: http.ServerResponse,
  options: Required<GlmOcrOcrServerOptions>,
  runtimeManager: GlmOcrRuntimeManager
): Promise<void> {
  let runtime: ManagedGlmOcrRuntime | undefined;
  let error: string | undefined;
  try {
    if (options.spawnGlmocrServer || options.glmocrServerUrl) {
      runtime = await runtimeManager.getRuntime();
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  writeJson(response, error ? 503 : 200, {
    status: error ? "degraded" : "ok",
    liteparse_version: pkg.version,
    engine: "glmocr-pipeline",
    model: options.model,
    glmocr_server_url: runtime?.serverUrl ?? options.glmocrServerUrl,
    model_runtime: runtime?.modelRuntime ?? options.modelRuntime,
    ocr_api_url: runtime?.ocrApiUrl ?? options.ocrApiUrl,
    spawned: runtime?.spawned ?? false,
    concurrency: options.concurrency,
    warnings: runtime?.warnings ?? [],
    error,
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

function resolveServerOptions(options: GlmOcrOcrServerOptions): Required<GlmOcrOcrServerOptions> {
  return {
    autoLoadModel: options.autoLoadModel ?? true,
    baseUrl: options.baseUrl ?? "http://localhost:1234",
    concurrency: options.concurrency ?? 1,
    debugArtifactsDir: options.debugArtifactsDir ?? "",
    glmocrConfig: options.glmocrConfig ?? "",
    glmocrHost: options.glmocrHost ?? "127.0.0.1",
    glmocrLogLevel: options.glmocrLogLevel ?? "INFO",
    glmocrPort: options.glmocrPort ?? 5002,
    glmocrPython: options.glmocrPython ?? "python3",
    glmocrRoot: options.glmocrRoot ?? "",
    glmocrServerUrl: options.glmocrServerUrl ?? "",
    host: options.host ?? "127.0.0.1",
    layoutBatchSize: options.layoutBatchSize ?? 1,
    layoutDevice: options.layoutDevice ?? "cpu",
    layoutModelDir:
      options.layoutModelDir ?? process.env.LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR ?? "",
    lmstudioAdapterHost: options.lmstudioAdapterHost ?? "127.0.0.1",
    lmstudioAdapterPort: options.lmstudioAdapterPort ?? 8832,
    lmstudioApiMode: options.lmstudioApiMode ?? "auto",
    maxImageBytes: options.maxImageBytes ?? 25 * 1024 * 1024,
    maxWorkers: options.maxWorkers ?? 1,
    model: options.model ?? DEFAULT_GLM_OCR_MODEL,
    modelRuntime: options.modelRuntime ?? "lmstudio",
    ocrApiUrl: options.ocrApiUrl ?? "",
    port: options.port ?? DEFAULT_GLMOCR_OCR_PORT,
    spawnGlmocrServer: options.spawnGlmocrServer ?? !options.glmocrServerUrl,
    strictBbox: options.strictBbox ?? true,
    timeoutMs: options.timeoutMs ?? 300_000,
  };
}

function runtimeInfo(runtime: ManagedGlmOcrRuntime): GlmOcrOcrArtifact["runtime"] {
  return {
    glmocr_server_url: runtime.serverUrl,
    model_runtime: runtime.modelRuntime,
    ocr_api_url: runtime.ocrApiUrl,
    spawned: runtime.spawned,
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

class MultipartError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
