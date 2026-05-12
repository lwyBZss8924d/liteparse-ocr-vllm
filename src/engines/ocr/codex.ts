import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import readline from "readline";
import sharp from "sharp";
import { Codex } from "@openai/codex-sdk";
import type { ModelReasoningEffort, ThreadOptions, Usage } from "@openai/codex-sdk";
import { OcrResult } from "./interface.js";

export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };
export type CodexConfigObject = { [key: string]: CodexConfigValue };

export type CodexOcrBackend = "sdk" | "app-server";
export type CodexOcrAssetType =
  | "table"
  | "formula"
  | "chart"
  | "code_block"
  | "illustration"
  | "form"
  | "image"
  | "other";
export type CodexOcrRegionType =
  | "title"
  | "heading"
  | "text"
  | "table"
  | "formula"
  | "chart"
  | "code_block"
  | "illustration"
  | "form"
  | "caption"
  | "header"
  | "footer"
  | "page_number"
  | "list"
  | "unknown";
export type CodexOcrCoordinateSpace = "normalized_1000" | "pixel";

export interface CodexBbox {
  coordinate_space: CodexOcrCoordinateSpace;
  value: [number, number, number, number];
}

export interface CodexHeading {
  bbox?: CodexBbox;
  level: number;
  text: string;
}

export interface CodexPageMetadata {
  detected_language?: string;
  headings: CodexHeading[];
  page_number: number;
  title: string;
}

export interface CodexLayoutRegion {
  bbox?: CodexBbox;
  confidence: number;
  id: string;
  text: string;
  type: CodexOcrRegionType;
}

export interface CodexAsset {
  annotations: string[];
  bbox?: CodexBbox;
  caption: string;
  data: unknown;
  html: string;
  id: string;
  latex: string;
  markdown: string;
  title: string;
  type: CodexOcrAssetType;
}

export interface CodexAnnotation {
  target_id: string;
  text: string;
  type: string;
}

export interface CodexOcrParsed {
  annotations: CodexAnnotation[];
  assets: CodexAsset[];
  layout_regions: CodexLayoutRegion[];
  markdown: string;
  page_metadata: CodexPageMetadata;
  warnings: string[];
}

export interface CodexOcrConversionResult {
  bbox_backed_region_count: number;
  results: OcrResult[];
  region_count: number;
  warnings: string[];
}

export interface CodexOcrArtifact {
  backend: CodexOcrBackend;
  conversion: CodexOcrConversionResult;
  engine: "codex-ocr";
  error?: string;
  image: {
    height: number;
    mime_type: string;
    width: number;
  };
  input_image_path?: string;
  input_sha256: string;
  model: string;
  ok: boolean;
  parsed: CodexOcrParsed;
  provenance: {
    generated_by: "liteparse codex-ocr";
    output_contract: "LiteParse advanced OCR artifact v1";
    trust_boundary: string;
  };
  raw_response?: unknown;
  raw_response_path?: string;
  request: {
    model_reasoning_effort: ModelReasoningEffort;
    timeout_ms: number;
  };
  thread_id?: string | null;
  usage?: Usage | null;
  warnings: string[];
}

export interface CodexOcrOptions {
  backend?: CodexOcrBackend;
  codexConfig?: CodexConfigObject;
  codexHome?: string;
  codexPath?: string;
  includeRaw?: boolean;
  language?: string;
  model?: string;
  pageNumber?: number;
  rawResponsePath?: string;
  reasoningEffort?: ModelReasoningEffort;
  strictBbox?: boolean;
  timeoutMs?: number;
  workingDirectory?: string;
}

interface CodexImageInputInfo {
  cleanupPath?: string;
  codexPath: string;
  height: number;
  inputPath?: string;
  mimeType: string;
  sha256: string;
  width: number;
}

interface CodexRunResult {
  finalResponse: string;
  raw: unknown;
  threadId?: string | null;
  usage?: Usage | null;
}

interface JsonRpcMessage {
  error?: { message?: string };
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
}

const DEFAULT_CODEX_OCR_MODEL = "gpt-5.5";
const DEFAULT_CODEX_OCR_REASONING: ModelReasoningEffort = "medium";
const DEFAULT_CODEX_OCR_TIMEOUT_MS = 300_000;

export const CODEX_OCR_DEFAULTS = {
  model: DEFAULT_CODEX_OCR_MODEL,
  reasoningEffort: DEFAULT_CODEX_OCR_REASONING,
  timeoutMs: DEFAULT_CODEX_OCR_TIMEOUT_MS,
} as const;

export const CODEX_OCR_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["page_metadata", "markdown", "layout_regions", "assets", "annotations", "warnings"],
  properties: {
    page_metadata: {
      type: "object",
      additionalProperties: false,
      required: ["page_number", "title", "detected_language", "headings"],
      properties: {
        page_number: { type: "integer" },
        title: { type: "string" },
        detected_language: { type: "string" },
        headings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["level", "text", "bbox"],
            properties: {
              level: { type: "integer", minimum: 1, maximum: 6 },
              text: { type: "string" },
              bbox: bboxSchema(),
            },
          },
        },
      },
    },
    markdown: { type: "string" },
    layout_regions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "text", "bbox", "confidence"],
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: [
              "title",
              "heading",
              "text",
              "table",
              "formula",
              "chart",
              "code_block",
              "illustration",
              "form",
              "caption",
              "header",
              "footer",
              "page_number",
              "list",
              "unknown",
            ],
          },
          text: { type: "string" },
          bbox: bboxSchema(),
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "title",
          "bbox",
          "caption",
          "markdown",
          "html",
          "latex",
          "data",
          "annotations",
        ],
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: [
              "table",
              "formula",
              "chart",
              "code_block",
              "illustration",
              "form",
              "image",
              "other",
            ],
          },
          title: { type: "string" },
          bbox: bboxSchema(),
          caption: { type: "string" },
          markdown: { type: "string" },
          html: { type: "string" },
          latex: { type: "string" },
          data: { type: "string" },
          annotations: { type: "array", items: { type: "string" } },
        },
      },
    },
    annotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "target_id", "text"],
        properties: {
          type: { type: "string" },
          target_id: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export function buildCodexOcrPrompt(input: {
  imageHeight: number;
  imageWidth: number;
  language?: string;
  pageNumber?: number;
}): string {
  const language = input.language ? `Preferred OCR language hint: ${input.language}.` : "";
  const pageNumber = input.pageNumber ?? 1;
  return [
    "Analyze the attached document page image for OCR and document understanding.",
    "Return only the structured JSON object requested by the output schema.",
    "Do not edit files, inspect the repository, run shell commands, or summarize the page.",
    "Extract faithful page text as Markdown. Preserve headings, lists, tables, formulas, captions, code blocks, labels, and visible reading order.",
    "Use page_metadata.title for the best visible page title, and page_metadata.headings for L1/L2/L3-style headings with numeric levels.",
    "Segment layout_regions for every meaningful text or semantic block.",
    "Segment assets for tables, formulas, charts, code blocks, forms, illustrations, or embedded images. Put reconstructed table Markdown or HTML, formula LaTeX, chart semantics, code text, and captions into the asset fields when visible. Put compact JSON semantics into assets[].data as a string when useful.",
    "Use annotations for human-readable asset captions in the form Image [idx]: [caption] when the asset is an illustration, chart, or image.",
    "All bbox fields must be axis-aligned top-left coordinate boxes. Prefer coordinate_space normalized_1000 with value [x1,y1,x2,y2] on a 0..1000 page grid. Use coordinate_space pixel only when you are confident in exact pixel coordinates.",
    `The image dimensions are ${input.imageWidth}x${input.imageHeight} pixels, and this is page ${pageNumber}. ${language}`,
    "Treat uncertain visual localization as model-inferred evidence; keep the best bbox and add concise warnings rather than omitting important text.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runCodexOcr(
  image: string | Buffer,
  options: CodexOcrOptions = {}
): Promise<CodexOcrArtifact> {
  const backend = options.backend ?? "sdk";
  const model = options.model ?? process.env.LITEPARSE_CODEX_OCR_MODEL ?? DEFAULT_CODEX_OCR_MODEL;
  const reasoningEffort =
    options.reasoningEffort ??
    (process.env.LITEPARSE_CODEX_OCR_REASONING as ModelReasoningEffort | undefined) ??
    DEFAULT_CODEX_OCR_REASONING;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_OCR_TIMEOUT_MS;
  const imageInfo = await prepareCodexImageInput(image);
  const prompt = buildCodexOcrPrompt({
    imageHeight: imageInfo.height,
    imageWidth: imageInfo.width,
    language: options.language,
    pageNumber: options.pageNumber,
  });

  let runResult: CodexRunResult;
  try {
    runResult =
      backend === "app-server"
        ? await runCodexOcrWithAppServer(prompt, imageInfo.codexPath, {
            ...options,
            model,
            reasoningEffort,
            timeoutMs,
          })
        : await runCodexOcrWithSdk(prompt, imageInfo.codexPath, {
            ...options,
            model,
            reasoningEffort,
            timeoutMs,
          });
  } catch (error) {
    await cleanupCodexImageInput(imageInfo);
    return makeFailureArtifact({
      backend,
      error: error instanceof Error ? error.message : String(error),
      imageInfo,
      model,
      reasoningEffort,
      timeoutMs,
    });
  }

  await cleanupCodexImageInput(imageInfo);

  if (options.rawResponsePath) {
    await fs.mkdir(path.dirname(options.rawResponsePath), { recursive: true });
    await fs.writeFile(
      options.rawResponsePath,
      `${JSON.stringify(runResult.raw, null, 2)}\n`,
      "utf-8"
    );
  }

  const parsedJson = parseJsonFromText(runResult.finalResponse);
  if (!parsedJson.ok) {
    return makeFailureArtifact({
      backend,
      error: parsedJson.error,
      imageInfo,
      model,
      raw: options.includeRaw ? runResult.raw : undefined,
      rawResponsePath: options.rawResponsePath,
      reasoningEffort,
      threadId: runResult.threadId,
      timeoutMs,
      usage: runResult.usage,
    });
  }

  const parsed = normalizeCodexParsed(parsedJson.value, options.pageNumber ?? 1);
  const conversion = convertCodexParsedToOcrResults(parsed, imageInfo, {
    strictBbox: options.strictBbox,
  });
  const warnings = uniqueStrings([
    ...parsed.warnings,
    ...conversion.warnings,
    "codex_bboxes_are_model_inferred",
  ]);

  return {
    backend,
    conversion: {
      ...conversion,
      warnings,
    },
    engine: "codex-ocr",
    image: {
      height: imageInfo.height,
      mime_type: imageInfo.mimeType,
      width: imageInfo.width,
    },
    input_image_path: imageInfo.inputPath,
    input_sha256: imageInfo.sha256,
    model,
    ok: true,
    parsed: {
      ...parsed,
      warnings,
    },
    provenance: {
      generated_by: "liteparse codex-ocr",
      output_contract: "LiteParse advanced OCR artifact v1",
      trust_boundary: "Codex model output is untrusted OCR and layout evidence",
    },
    raw_response: options.includeRaw ? runResult.raw : undefined,
    raw_response_path: options.rawResponsePath,
    request: {
      model_reasoning_effort: reasoningEffort,
      timeout_ms: timeoutMs,
    },
    thread_id: runResult.threadId,
    usage: runResult.usage,
    warnings,
  };
}

export function convertCodexArtifactToOcrResults(
  artifact: CodexOcrArtifact,
  options: { strictBbox?: boolean } = {}
): CodexOcrConversionResult {
  return convertCodexParsedToOcrResults(
    artifact.parsed,
    {
      height: artifact.image.height,
      width: artifact.image.width,
    },
    options
  );
}

async function runCodexOcrWithSdk(
  prompt: string,
  imagePath: string,
  options: Required<Pick<CodexOcrOptions, "model" | "reasoningEffort" | "timeoutMs">> &
    CodexOcrOptions
): Promise<CodexRunResult> {
  const codex = new Codex({
    codexPathOverride: options.codexPath || undefined,
    config: options.codexConfig,
    env: buildCodexEnv(options.codexHome),
  });
  const threadOptions: ThreadOptions = {
    approvalPolicy: "never",
    model: options.model,
    modelReasoningEffort: options.reasoningEffort,
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
    webSearchEnabled: false,
    workingDirectory: options.workingDirectory ?? process.cwd(),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const thread = codex.startThread(threadOptions);
    const turn = await thread.run(
      [
        { type: "text", text: prompt },
        { type: "local_image", path: imagePath },
      ],
      {
        outputSchema: CODEX_OCR_OUTPUT_SCHEMA,
        signal: controller.signal,
      }
    );
    return {
      finalResponse: turn.finalResponse,
      raw: {
        final_response: turn.finalResponse,
        items: turn.items,
        thread_id: thread.id,
        usage: turn.usage,
      },
      threadId: thread.id,
      usage: turn.usage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runCodexOcrWithAppServer(
  prompt: string,
  imagePath: string,
  options: Required<Pick<CodexOcrOptions, "model" | "reasoningEffort" | "timeoutMs">> &
    CodexOcrOptions
): Promise<CodexRunResult> {
  const codexPath = options.codexPath || "codex";
  const proc = spawn(codexPath, ["app-server"], {
    cwd: options.workingDirectory ?? process.cwd(),
    env: buildCodexEnv(options.codexHome),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rawMessages: JsonRpcMessage[] = [];
  let stderr = "";

  return await new Promise<CodexRunResult>((resolve, reject) => {
    let completed = false;
    let threadId: string | null = null;
    let finalResponse = "";
    let deltaText = "";

    const timeout = setTimeout(() => {
      finish(new Error(`Codex app-server OCR timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const rl = readline.createInterface({ input: proc.stdout });

    const send = (message: unknown) => {
      proc.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const finish = (error?: Error, result?: CodexRunResult) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      rl.close();
      proc.stdin.destroy();
      proc.kill();
      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error("Codex app-server completed without a result"));
      }
    };

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => finish(error));
    proc.on("close", (code) => {
      if (!completed && code !== 0) {
        finish(new Error(`codex app-server exited with code ${code}: ${stderr.trim()}`));
      }
    });

    rl.on("line", (line) => {
      const parsed = parseJsonLine(line);
      if (!parsed) return;
      rawMessages.push(parsed);
      if (parsed.error) {
        finish(new Error(parsed.error.message ?? "Codex app-server JSON-RPC error"));
        return;
      }
      if (parsed.id === 1) {
        const result = isRecord(parsed.result) ? parsed.result : {};
        const thread = isRecord(result.thread) ? result.thread : {};
        threadId = typeof thread.id === "string" ? thread.id : null;
        if (!threadId) {
          finish(new Error("Codex app-server did not return a thread id"));
          return;
        }
        send({
          id: 2,
          method: "turn/start",
          params: {
            approvalPolicy: "never",
            cwd: options.workingDirectory ?? process.cwd(),
            effort: options.reasoningEffort,
            input: [
              { type: "text", text: prompt, text_elements: [] },
              { type: "localImage", path: imagePath },
            ],
            model: options.model,
            outputSchema: CODEX_OCR_OUTPUT_SCHEMA,
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            threadId,
          },
        });
        return;
      }

      if (parsed.method === "item/agentMessage/delta") {
        const params = isRecord(parsed.params) ? parsed.params : {};
        const delta = params.delta ?? params.text;
        if (typeof delta === "string") deltaText += delta;
      }

      if (parsed.method === "item/completed") {
        const params = isRecord(parsed.params) ? parsed.params : {};
        const item = isRecord(params.item) ? params.item : {};
        const type = item.type;
        const text = item.text;
        if (
          (type === "agentMessage" || type === "agent_message") &&
          typeof text === "string" &&
          text
        ) {
          finalResponse = text;
        }
      }

      if (parsed.method === "turn/completed") {
        finish(undefined, {
          finalResponse: finalResponse || deltaText,
          raw: { messages: rawMessages },
          threadId,
          usage: null,
        });
      }
    });

    send({
      id: 0,
      method: "initialize",
      params: {
        capabilities: { experimentalApi: true },
        clientInfo: {
          name: "liteparse_codex_ocr",
          title: "LiteParse Codex OCR",
          version: "0.1.0",
        },
      },
    });
    send({ method: "initialized", params: {} });
    send({
      id: 1,
      method: "thread/start",
      params: {
        approvalPolicy: "never",
        cwd: options.workingDirectory ?? process.cwd(),
        model: options.model,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        serviceName: "liteparse_codex_ocr",
      },
    });
  });
}

function convertCodexParsedToOcrResults(
  parsed: CodexOcrParsed,
  image: { height: number; width: number },
  options: { strictBbox?: boolean } = {}
): CodexOcrConversionResult {
  const results: OcrResult[] = [];
  const warnings = [...parsed.warnings];
  let bboxBackedRegionCount = 0;

  for (const region of parsed.layout_regions) {
    const text = region.text.trim();
    if (!text) continue;
    const bbox = region.bbox ? bboxToPixelBbox(region.bbox, image.width, image.height) : null;
    if (!bbox) {
      warnings.push("region_bbox_missing");
      continue;
    }
    bboxBackedRegionCount += 1;
    results.push({
      text,
      bbox,
      confidence: normalizeConfidence(region.confidence),
    });
  }

  if (results.length > 0 || options.strictBbox) {
    return {
      bbox_backed_region_count: bboxBackedRegionCount,
      region_count: parsed.layout_regions.length,
      results,
      warnings: uniqueStrings(warnings),
    };
  }

  const fallbackResults = makeFallbackLineResults(parsed.markdown, image.width, image.height);
  if (fallbackResults.length > 0) warnings.push("fallback_line_bboxes");
  return {
    bbox_backed_region_count: bboxBackedRegionCount,
    region_count: parsed.layout_regions.length,
    results: fallbackResults,
    warnings: uniqueStrings(warnings),
  };
}

function normalizeCodexParsed(value: unknown, fallbackPageNumber: number): CodexOcrParsed {
  const record = isRecord(value) ? value : {};
  const pageMetadata = normalizePageMetadata(record.page_metadata, fallbackPageNumber);
  const layoutRegions = normalizeLayoutRegions(record.layout_regions);
  const assets = normalizeAssets(record.assets);
  const annotations = normalizeAnnotations(record.annotations);
  const warnings = Array.isArray(record.warnings) ? record.warnings.map(String) : [];
  return {
    annotations,
    assets,
    layout_regions: layoutRegions,
    markdown: stringValue(record.markdown),
    page_metadata: pageMetadata,
    warnings: uniqueStrings(warnings),
  };
}

function normalizePageMetadata(value: unknown, fallbackPageNumber: number): CodexPageMetadata {
  const record = isRecord(value) ? value : {};
  const rawHeadings = Array.isArray(record.headings) ? record.headings : [];
  return {
    detected_language: stringValue(record.detected_language),
    headings: rawHeadings.filter(isRecord).map((heading, index) => ({
      bbox: normalizeBbox(heading.bbox),
      level: clampInteger(numberValue(heading.level), 1, 6, index === 0 ? 1 : 2),
      text: stringValue(heading.text),
    })),
    page_number: clampInteger(
      numberValue(record.page_number),
      1,
      Number.MAX_SAFE_INTEGER,
      fallbackPageNumber
    ),
    title: stringValue(record.title),
  };
}

function normalizeLayoutRegions(value: unknown): CodexLayoutRegion[] {
  const items = Array.isArray(value) ? value : [];
  return items.filter(isRecord).map((item, index) => ({
    bbox: normalizeBbox(item.bbox),
    confidence: normalizeConfidence(item.confidence),
    id: stringValue(item.id) || `region_${String(index + 1).padStart(3, "0")}`,
    text: stringValue(item.text),
    type: normalizeRegionType(item.type),
  }));
}

function normalizeAssets(value: unknown): CodexAsset[] {
  const items = Array.isArray(value) ? value : [];
  return items.filter(isRecord).map((item, index) => ({
    annotations: Array.isArray(item.annotations) ? item.annotations.map(String) : [],
    bbox: normalizeBbox(item.bbox),
    caption: stringValue(item.caption),
    data: item.data,
    html: stringValue(item.html),
    id: stringValue(item.id) || `asset_${String(index + 1).padStart(3, "0")}`,
    latex: stringValue(item.latex),
    markdown: stringValue(item.markdown),
    title: stringValue(item.title),
    type: normalizeAssetType(item.type),
  }));
}

function normalizeAnnotations(value: unknown): CodexAnnotation[] {
  const items = Array.isArray(value) ? value : [];
  return items.filter(isRecord).map((item) => ({
    target_id: stringValue(item.target_id),
    text: stringValue(item.text),
    type: stringValue(item.type) || "note",
  }));
}

async function prepareCodexImageInput(image: string | Buffer): Promise<CodexImageInputInfo> {
  const originalBuffer = typeof image === "string" ? await fs.readFile(image) : image;
  const metadata = await sharp(originalBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to determine image dimensions");
  }
  const originalMimeType =
    typeof image === "string"
      ? mimeTypeFromPath(path.extname(image))
      : mimeTypeFromBuffer(originalBuffer);
  const sha256 = crypto.createHash("sha256").update(originalBuffer).digest("hex");

  if (typeof image === "string" && isCodexSupportedMime(originalMimeType)) {
    return {
      codexPath: path.resolve(image),
      height: metadata.height,
      inputPath: path.resolve(image),
      mimeType: originalMimeType,
      sha256,
      width: metadata.width,
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "liteparse-codex-ocr-"));
  const pngPath = path.join(tmpDir, "input.png");
  await sharp(originalBuffer).png().toFile(pngPath);
  return {
    cleanupPath: tmpDir,
    codexPath: pngPath,
    height: metadata.height,
    inputPath: typeof image === "string" ? path.resolve(image) : undefined,
    mimeType: "image/png",
    sha256,
    width: metadata.width,
  };
}

async function cleanupCodexImageInput(imageInfo: CodexImageInputInfo): Promise<void> {
  if (imageInfo.cleanupPath) {
    await fs.rm(imageInfo.cleanupPath, { recursive: true, force: true });
  }
}

function makeFailureArtifact(input: {
  backend: CodexOcrBackend;
  error: string;
  imageInfo: CodexImageInputInfo;
  model: string;
  raw?: unknown;
  rawResponsePath?: string;
  reasoningEffort: ModelReasoningEffort;
  threadId?: string | null;
  timeoutMs: number;
  usage?: Usage | null;
}): CodexOcrArtifact {
  const parsed: CodexOcrParsed = {
    annotations: [],
    assets: [],
    layout_regions: [],
    markdown: "",
    page_metadata: {
      headings: [],
      page_number: 1,
      title: "",
    },
    warnings: ["codex_ocr_failed"],
  };
  return {
    backend: input.backend,
    conversion: {
      bbox_backed_region_count: 0,
      region_count: 0,
      results: [],
      warnings: ["codex_ocr_failed"],
    },
    engine: "codex-ocr",
    error: input.error,
    image: {
      height: input.imageInfo.height,
      mime_type: input.imageInfo.mimeType,
      width: input.imageInfo.width,
    },
    input_image_path: input.imageInfo.inputPath,
    input_sha256: input.imageInfo.sha256,
    model: input.model,
    ok: false,
    parsed,
    provenance: {
      generated_by: "liteparse codex-ocr",
      output_contract: "LiteParse advanced OCR artifact v1",
      trust_boundary: "Codex model output is untrusted OCR and layout evidence",
    },
    raw_response: input.raw,
    raw_response_path: input.rawResponsePath,
    request: {
      model_reasoning_effort: input.reasoningEffort,
      timeout_ms: input.timeoutMs,
    },
    thread_id: input.threadId,
    usage: input.usage,
    warnings: ["codex_ocr_failed"],
  };
}

function bboxSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    required: ["coordinate_space", "value"],
    properties: {
      coordinate_space: { type: "string", enum: ["normalized_1000", "pixel"] },
      value: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: { type: "number" },
      },
    },
  };
}

function normalizeBbox(value: unknown): CodexBbox | undefined {
  if (Array.isArray(value)) {
    const numbers = toNumberArray(value);
    return numbers ? { coordinate_space: "normalized_1000", value: numbers } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const numbers = toNumberArray(value.value);
  if (!numbers) return undefined;
  const coordinateSpace =
    value.coordinate_space === "pixel" || value.coordinate_space === "normalized_1000"
      ? value.coordinate_space
      : "normalized_1000";
  return {
    coordinate_space: coordinateSpace,
    value: numbers,
  };
}

function bboxToPixelBbox(
  bbox: CodexBbox,
  imageWidth: number,
  imageHeight: number
): [number, number, number, number] | null {
  const [x1, y1, x2, y2] = bbox.value;
  if (bbox.coordinate_space === "pixel") {
    return clampBbox([x1, y1, x2, y2], imageWidth, imageHeight);
  }
  return clampBbox(
    [
      (x1 * imageWidth) / 1000,
      (y1 * imageHeight) / 1000,
      (x2 * imageWidth) / 1000,
      (y2 * imageHeight) / 1000,
    ],
    imageWidth,
    imageHeight
  );
}

function clampBbox(
  raw: number[],
  imageWidth: number,
  imageHeight: number
): [number, number, number, number] | null {
  let [x1, y1, x2, y2] = raw.map((value) => Math.round(value));
  x1 = Math.max(0, Math.min(imageWidth, x1));
  x2 = Math.max(0, Math.min(imageWidth, x2));
  y1 = Math.max(0, Math.min(imageHeight, y1));
  y2 = Math.max(0, Math.min(imageHeight, y2));
  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2, y2];
}

function makeFallbackLineResults(
  text: string,
  imageWidth: number,
  imageHeight: number
): OcrResult[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || imageWidth <= 0 || imageHeight <= 0) return [];
  const lineHeight = imageHeight / lines.length;
  return lines.map((line, index) => {
    const y1 = Math.max(0, Math.floor(index * lineHeight));
    const y2 = Math.min(imageHeight, Math.ceil((index + 1) * lineHeight));
    return {
      bbox: [0, y1, imageWidth, Math.max(y2, y1 + 1)] as [number, number, number, number],
      confidence: 1,
      text: line,
    };
  });
}

function parseJsonFromText(
  text: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [trimmed, fenced?.[1]].filter((value): value is string =>
    Boolean(value?.trim())
  );
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      // Try the next candidate.
    }
  }
  return {
    ok: false,
    error: `Codex OCR response was not valid JSON: ${trimmed.slice(0, 500)}`,
  };
}

function parseJsonLine(line: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? (parsed as JsonRpcMessage) : null;
  } catch {
    return null;
  }
}

function buildCodexEnv(codexHome?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.CODEX_HOME = resolveCodexHome(codexHome);
  return env;
}

export function resolveCodexHome(codexHome?: string): string {
  return path.resolve(
    codexHome ||
      process.env.LITEPARSE_CODEX_HOME ||
      process.env.CODEX_HOME ||
      path.join(process.env.HOME || "~", ".codex")
  );
}

function normalizeRegionType(value: unknown): CodexOcrRegionType {
  const allowed: CodexOcrRegionType[] = [
    "title",
    "heading",
    "text",
    "table",
    "formula",
    "chart",
    "code_block",
    "illustration",
    "form",
    "caption",
    "header",
    "footer",
    "page_number",
    "list",
    "unknown",
  ];
  return allowed.includes(value as CodexOcrRegionType) ? (value as CodexOcrRegionType) : "unknown";
}

function normalizeAssetType(value: unknown): CodexOcrAssetType {
  const allowed: CodexOcrAssetType[] = [
    "table",
    "formula",
    "chart",
    "code_block",
    "illustration",
    "form",
    "image",
    "other",
  ];
  return allowed.includes(value as CodexOcrAssetType) ? (value as CodexOcrAssetType) : "other";
}

function normalizeConfidence(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 1;
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (!Number.isInteger(value)) return fallback;
  const parsed = value as number;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function toNumberArray(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const numbers = value.slice(0, 4).map(Number);
  return numbers.every((item) => Number.isFinite(item))
    ? ([numbers[0], numbers[1], numbers[2], numbers[3]] as [number, number, number, number])
    : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mimeTypeFromPath(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === ".png") return "image/png";
  if (lower === ".jpg" || lower === ".jpeg") return "image/jpeg";
  if (lower === ".webp") return "image/webp";
  if (lower === ".gif") return "image/gif";
  if (lower === ".tif" || lower === ".tiff") return "image/tiff";
  if (lower === ".bmp") return "image/bmp";
  if (lower === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function mimeTypeFromBuffer(buffer: Buffer): string {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return "application/octet-stream";
}

function isCodexSupportedMime(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
