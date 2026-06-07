import http from "node:http";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Busboy from "busboy";
import {
  CODEX_OCR_DEFAULTS,
  convertCodexArtifactToOcrResults,
  resolveCodexHome,
  runCodexOcr,
} from "./codex.js";
import type {
  CodexOcrOptions,
  CodexOcrRunner,
  CodexOcrArtifact,
} from "./types.js";

export const DEFAULT_CODEX_OCR_PORT = 8833;

export interface CodexOcrServerOptions extends CodexOcrOptions {
  concurrency?: number;
  host?: string;
  maxImageBytes?: number;
  port?: number;
  runOcr?: CodexOcrRunner;
}

interface ResolvedCodexOcrServerOptions extends Required<Omit<CodexOcrServerOptions, "runOcr">> {
  runOcr: CodexOcrRunner;
}

interface MultipartUpload {
  buffer: Buffer;
  fields: Record<string, string>;
  filename?: string;
  mimeType?: string;
}

let cachedPackageVersion: string | undefined;

export function startCodexOcrServer(options: CodexOcrServerOptions = {}): http.Server {
  const server = createCodexOcrServer(options);
  server.listen(options.port ?? DEFAULT_CODEX_OCR_PORT, options.host ?? "127.0.0.1");
  return server;
}

export function createCodexOcrServer(options: CodexOcrServerOptions = {}): http.Server {
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
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/health") {
        await handleHealth(response, resolved);
        return;
      }

      if (request.method === "POST" && (url.pathname === "/ocr" || url.pathname === "/ocr/analyze")) {
        const upload = await readMultipartUpload(request, resolved.maxImageBytes);
        const pageNumber = parseInteger(upload.fields.page_number, 1);
        const language = upload.fields.language || resolved.language;
        const strictBbox = upload.fields.strict_bboxes === "true" ? true : resolved.strictBbox;
        const includeRaw = url.pathname === "/ocr/analyze" ? resolved.includeRaw : false;
        const artifact = await withConcurrency(() =>
          resolved.runOcr(upload.buffer, {
            ...resolved,
            includeRaw,
            language,
            pageNumber,
            strictBbox,
          }),
        );

        if (url.pathname === "/ocr/analyze") {
          writeJson(response, artifact.ok ? 200 : 502, artifact);
          return;
        }

        writeJson(response, artifact.ok ? 200 : 502, ocrResponseFromArtifact(artifact, strictBbox));
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
  options: ResolvedCodexOcrServerOptions,
): Promise<void> {
  const codexHome = resolveCodexHome(options.codexHome);
  const authPath = `${codexHome}/auth.json`;
  const configPath = `${codexHome}/config.toml`;
  const [authReadable, configReadable] = await Promise.all([
    canAccess(authPath),
    canAccess(configPath),
  ]);
  writeJson(response, 200, {
    status: "ok",
    liteparse_version: await readPackageVersion(),
    engine: "codex-ocr",
    backend: "sdk",
    model: options.model,
    reasoning_effort: options.reasoningEffort,
    codex_home: codexHome,
    auth_configured: authReadable,
    config_configured: configReadable,
    concurrency: options.concurrency,
  });
}

function ocrResponseFromArtifact(artifact: CodexOcrArtifact, strictBbox: boolean): unknown {
  const conversion = convertCodexArtifactToOcrResults(artifact, { strictBbox });
  return {
    results: conversion.results,
    engine: artifact.engine,
    backend: artifact.backend,
    model: artifact.model,
    warnings: conversion.warnings,
    region_count: conversion.region_count,
    bbox_backed_region_count: conversion.bbox_backed_region_count,
  };
}

function readMultipartUpload(
  request: http.IncomingMessage,
  maxImageBytes: number,
): Promise<MultipartUpload> {
  return new Promise((resolve, reject) => {
    const contentType = request.headers["content-type"];
    if (!contentType?.includes("multipart/form-data")) {
      reject(new MultipartError(400, "Expected multipart/form-data"));
      return;
    }

    const busboy = Busboy({
      headers: request.headers,
      limits: { fileSize: maxImageBytes },
    });
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let filename: string | undefined;
    let mimeType: string | undefined;
    let uploadError: MultipartError | undefined;

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "file") {
        file.resume();
        return;
      }
      filename = info.filename;
      mimeType = info.mimeType;
      file.on("limit", () => {
        uploadError = new MultipartError(413, `Uploaded image exceeds ${maxImageBytes} bytes`);
      });
      file.on("data", (chunk: Buffer) => {
        if (!uploadError) chunks.push(chunk);
      });
    });
    busboy.on("field", (name, value) => {
      fields[name] = value;
    });
    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (uploadError) {
        reject(uploadError);
        return;
      }
      if (chunks.length === 0) {
        reject(new MultipartError(400, "Missing file field"));
        return;
      }
      resolve({ buffer: Buffer.concat(chunks), fields, filename, mimeType });
    });
    request.pipe(busboy);
  });
}

function resolveServerOptions(options: CodexOcrServerOptions): ResolvedCodexOcrServerOptions {
  return {
    codexConfig: options.codexConfig ?? {},
    codexHome: resolveCodexHome(options.codexHome),
    codexPath: options.codexPath ?? "",
    concurrency: options.concurrency ?? 1,
    host: options.host ?? "127.0.0.1",
    includeRaw: options.includeRaw ?? false,
    language: options.language ?? "en",
    maxImageBytes: options.maxImageBytes ?? 50 * 1024 * 1024,
    model: options.model ?? process.env.LITEPARSE_CODEX_OCR_MODEL ?? CODEX_OCR_DEFAULTS.model,
    pageNumber: options.pageNumber ?? 1,
    port: options.port ?? DEFAULT_CODEX_OCR_PORT,
    rawResponsePath: options.rawResponsePath ?? "",
    reasoningEffort: options.reasoningEffort ?? CODEX_OCR_DEFAULTS.reasoningEffort,
    runOcr: options.runOcr ?? runCodexOcr,
    strictBbox: options.strictBbox ?? false,
    timeoutMs: options.timeoutMs ?? CODEX_OCR_DEFAULTS.timeoutMs,
    workingDirectory: options.workingDirectory ?? process.cwd(),
  };
}

async function readPackageVersion(): Promise<string> {
  if (cachedPackageVersion) return cachedPackageVersion;
  try {
    const packageJsonUrl = new URL("../../package.json", import.meta.url);
    const packageJson = JSON.parse(await readFile(fileURLToPath(packageJsonUrl), "utf-8")) as {
      version?: unknown;
    };
    cachedPackageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    cachedPackageVersion = "unknown";
  }
  return cachedPackageVersion;
}

async function canAccess(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class MultipartError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
