import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import axios from "axios";
import sharp from "sharp";
import { OcrResult } from "./interface.js";

export type LmStudioOcrMode = "auto" | "text" | "layout" | "table" | "formula" | "diagram";
export type LmStudioApiMode = "lmstudio-native" | "openai";

export interface LmStudioOcrOptions {
  apiKey?: string;
  apiMode?: LmStudioApiMode;
  autoLoadModel?: boolean;
  baseUrl?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  mode?: LmStudioOcrMode;
  model?: string;
  rawResponsePath?: string;
  strictBbox?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

export interface LmStudioOcrRequestInfo {
  api_mode: LmStudioApiMode;
  context_length: number;
  max_output_tokens: number;
  temperature: number;
  timeout_ms: number;
}

export interface LmStudioOcrParsed {
  diagram: unknown | null;
  html_table: string;
  json_result: unknown[];
  layout_details: unknown[];
  latex: string;
  layout_blocks: unknown[];
  markdown: string;
  markdown_result: string;
  text: string;
  warnings: string[];
}

export interface LmStudioOcrArtifact {
  ok: boolean;
  api_key_set: boolean;
  base_url: string;
  endpoint: string;
  error?: string;
  input_image_path?: string;
  input_sha256?: string;
  image: {
    height: number;
    mime_type: string;
    width: number;
  };
  mode: LmStudioOcrMode;
  model: string;
  parsed: LmStudioOcrParsed;
  provenance: {
    generated_by: "liteparse lmstudio-ocr";
    trust_boundary: string;
  };
  raw_response_path?: string;
  request: LmStudioOcrRequestInfo;
  status_code?: number;
}

interface ImageInputInfo {
  buffer: Buffer;
  dataUrl: string;
  height: number;
  inputPath?: string;
  mimeType: string;
  sha256: string;
  width: number;
}

interface RegionLike {
  bbox?: unknown;
  bbox_2d?: unknown;
  box_2d?: unknown;
  confidence?: unknown;
  content?: unknown;
  label?: unknown;
  polygon?: unknown;
  poly?: unknown;
  score?: unknown;
  text?: unknown;
}

export const DEFAULT_LMSTUDIO_BASE_URL = "http://localhost:1234";
export const DEFAULT_GLM_OCR_MODEL = "glm-ocr-g32-mixed_4_8-mlx";
export const DEFAULT_LMSTUDIO_OCR_PORT = 8830;

const execFileAsync = promisify(execFile);

export function promptForLmStudioOcrMode(mode: LmStudioOcrMode): string {
  if (mode === "table") {
    return [
      "Table Recognition:",
      "OCR and reconstruct the table in this image.",
      "Return an HTML table first. Preserve row and column structure, merged cells, captions, footnotes, and empty cells.",
      "Also return compact JSON when possible with json_result regions using bbox_2d normalized to 0-1000.",
    ].join(" ");
  }
  if (mode === "formula") {
    return [
      "Formula Recognition:",
      "Recognize the formula or equation in this image.",
      "Return LaTeX first, then list uncertain symbols.",
      "Preserve operators, indices, fractions, sums, equation numbering, and bbox_2d normalized to 0-1000 when possible.",
    ].join(" ");
  }
  if (mode === "layout") {
    return [
      "Layout Detection:",
      "Analyze document layout in this image.",
      "Return compact JSON with json_result as a single-page array of regions: index, label, content, bbox_2d.",
      "Use normalized 0-1000 bbox_2d when you can infer it.",
      "Labels include title, text, table, figure, formula, header, footer, page_number, reference.",
    ].join(" ");
  }
  if (mode === "diagram") {
    return [
      "Layout Detection:",
      "Analyze this chart or diagram crop.",
      "Return compact JSON with diagram_type, caption_text, nodes, edges, labels, and the best reconstruction target.",
      "Include bbox_2d normalized to 0-1000 when possible.",
    ].join(" ");
  }
  if (mode === "auto") {
    return [
      "Text Recognition:",
      "Classify and OCR this document crop or page.",
      "Return compact JSON with mode: text|layout|table|formula|diagram, markdown_result, json_result, text_sample, html_table, latex, layout_blocks, diagram, and warnings.",
      "Use bbox_2d normalized to 0-1000 for layout regions when possible.",
    ].join(" ");
  }
  return [
    "Text Recognition:",
    "OCR this document image. Return faithful Markdown text.",
    "Preserve headings, captions, lists, visible formula text, and table-like line breaks.",
    "Do not summarize.",
  ].join(" ");
}

export async function runLmStudioOcr(
  image: string | Buffer,
  options: LmStudioOcrOptions = {}
): Promise<LmStudioOcrArtifact> {
  const mode = options.mode ?? "auto";
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? process.env.LITEPARSE_LMSTUDIO_BASE_URL ?? DEFAULT_LMSTUDIO_BASE_URL
  );
  const model = options.model ?? process.env.LITEPARSE_GLM_OCR_MODEL ?? DEFAULT_GLM_OCR_MODEL;
  const apiKey = options.apiKey ?? process.env.LITEPARSE_LMSTUDIO_API_KEY;
  const apiMode = options.apiMode ?? "lmstudio-native";
  const autoLoadModel = options.autoLoadModel ?? shouldAutoLoadModel(baseUrl);
  const contextLength = options.contextLength ?? 16_384;
  const maxOutputTokens = options.maxOutputTokens ?? 2_048;
  const temperature = options.temperature ?? 0;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const endpoint = `${baseUrl}${apiMode === "openai" ? "/v1/chat/completions" : "/api/v1/chat"}`;

  if (autoLoadModel) {
    const loadResult = await ensureLmStudioModelLoaded({ baseUrl, model, timeoutMs: 120_000 });
    if (!loadResult.ok) {
      return makeFailureArtifact({
        apiKey,
        apiMode,
        baseUrl,
        contextLength,
        endpoint,
        error: loadResult.error ?? "failed to auto-load LM Studio model",
        maxOutputTokens,
        mode,
        model,
        temperature,
        timeoutMs,
      });
    }
  }

  let imageInfo: ImageInputInfo;
  try {
    imageInfo = await prepareImageInput(image);
  } catch (error) {
    return makeFailureArtifact({
      apiKey,
      apiMode,
      baseUrl,
      contextLength,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      maxOutputTokens,
      mode,
      model,
      temperature,
      timeoutMs,
    });
  }

  const payload = buildLmStudioPayload({
    apiMode,
    contextLength,
    dataUrl: imageInfo.dataUrl,
    maxOutputTokens,
    mode,
    model,
    temperature,
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: { status: number; data: unknown };
  try {
    response = await axios.post(endpoint, payload, {
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    });
  } catch (error) {
    return makeFailureArtifact({
      apiKey,
      apiMode,
      baseUrl,
      contextLength,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      imageInfo,
      maxOutputTokens,
      mode,
      model,
      temperature,
      timeoutMs,
    });
  }

  const statusCode = response.status;
  const rawJson = response.data;
  const rawBody = typeof response.data === "string" ? response.data : JSON.stringify(response.data);

  if (options.rawResponsePath) {
    await fs.mkdir(path.dirname(options.rawResponsePath), { recursive: true });
    await fs.writeFile(options.rawResponsePath, `${JSON.stringify(rawJson, null, 2)}\n`, "utf-8");
  }

  const outputText = extractOutputText(rawJson);
  const parsed = normalizeLmStudioOcrParsed(mode, outputText, rawJson);
  const artifact: LmStudioOcrArtifact = {
    ok: statusCode >= 200 && statusCode < 300,
    api_key_set: Boolean(apiKey),
    base_url: baseUrl,
    endpoint,
    image: {
      height: imageInfo.height,
      mime_type: imageInfo.mimeType,
      width: imageInfo.width,
    },
    input_image_path: imageInfo.inputPath,
    input_sha256: imageInfo.sha256,
    mode,
    model,
    parsed,
    provenance: {
      generated_by: "liteparse lmstudio-ocr",
      trust_boundary: "model output is untrusted OCR evidence",
    },
    raw_response_path: options.rawResponsePath,
    request: {
      api_mode: apiMode,
      context_length: contextLength,
      max_output_tokens: maxOutputTokens,
      temperature,
      timeout_ms: timeoutMs,
    },
    status_code: statusCode,
  };
  if (!artifact.ok) {
    artifact.error = outputText || rawBody.slice(0, 500) || `LM Studio returned ${statusCode}`;
  }
  return artifact;
}

export function convertLmStudioArtifactToOcrResults(
  artifact: LmStudioOcrArtifact,
  options: { strictBbox?: boolean } = {}
): { results: OcrResult[]; warnings: string[] } {
  const warnings = [...artifact.parsed.warnings];
  const regions = collectRegions(artifact.parsed.layout_details, artifact.parsed.json_result);
  const results: OcrResult[] = [];

  for (const region of regions) {
    const text = stringifyRegionText(region);
    if (!text) continue;
    const bbox = regionToPixelBbox(region, artifact.image.width, artifact.image.height);
    if (!bbox) {
      warnings.push("region_bbox_missing");
      continue;
    }
    results.push({
      text,
      bbox,
      confidence: normalizeConfidence(region.confidence ?? region.score),
    });
  }

  if (results.length > 0 || options.strictBbox) {
    return { results, warnings: uniqueStrings(warnings) };
  }

  const fallbackText =
    artifact.parsed.markdown_result || artifact.parsed.text || artifact.parsed.markdown;
  const fallbackResults = makeFallbackLineResults(
    fallbackText,
    artifact.image.width,
    artifact.image.height
  );
  if (fallbackResults.length > 0) {
    warnings.push("fallback_line_bboxes");
  }
  return { results: fallbackResults, warnings: uniqueStrings(warnings) };
}

export function normalizeLmStudioOcrParsed(
  mode: LmStudioOcrMode,
  text: string,
  rawJson?: unknown
): LmStudioOcrParsed {
  const rawRecord = isRecord(rawJson) ? rawJson : undefined;
  const parsedJson = extractFencedJson(text);
  const sourceRecord = isRecord(parsedJson) ? parsedJson : rawRecord;
  const warnings: string[] = [];
  let diagram: unknown | null = null;
  let layoutBlocks: unknown[] = [];
  let htmlTable = extractHtmlTable(text);
  let latex = extractLatex(text);
  let markdown = text.trim();
  let normalizedText = text.trim();
  let jsonResult: unknown[] = [];
  let markdownResult = markdown;

  if (Array.isArray(parsedJson)) {
    jsonResult = wrapRegionArray(parsedJson);
  }

  if (sourceRecord) {
    if (!htmlTable && typeof sourceRecord.html_table === "string")
      htmlTable = sourceRecord.html_table;
    if (!htmlTable && typeof sourceRecord.html === "string") htmlTable = sourceRecord.html;
    if (!latex && typeof sourceRecord.latex === "string") latex = sourceRecord.latex;
    if (typeof sourceRecord.markdown === "string") markdown = sourceRecord.markdown;
    if (typeof sourceRecord.markdown_result === "string")
      markdownResult = sourceRecord.markdown_result;
    if (typeof sourceRecord.md_results === "string") markdownResult = sourceRecord.md_results;
    if (typeof sourceRecord.text === "string") normalizedText = sourceRecord.text;
    if (typeof sourceRecord.text_sample === "string" && !normalizedText) {
      normalizedText = sourceRecord.text_sample;
    }
    if (Array.isArray(sourceRecord.layout_blocks)) layoutBlocks = sourceRecord.layout_blocks;
    if (Array.isArray(sourceRecord.blocks)) layoutBlocks = sourceRecord.blocks;
    if (Array.isArray(sourceRecord.json_result)) jsonResult = sourceRecord.json_result;
    if (Array.isArray(sourceRecord.layout_details)) jsonResult = sourceRecord.layout_details;
    if (isRecord(sourceRecord.diagram)) diagram = sourceRecord.diagram;
    if (Array.isArray(sourceRecord.warnings)) warnings.push(...sourceRecord.warnings.map(String));
  }

  if (jsonResult.length === 0 && layoutBlocks.length > 0)
    jsonResult = wrapRegionArray(layoutBlocks);
  if (markdownResult === "" && markdown) markdownResult = markdown;
  if (mode === "table" && !htmlTable) warnings.push("html_table_not_found");
  if (mode === "formula" && !latex) warnings.push("latex_not_found");
  if (mode === "layout" && collectRegions(jsonResult).length === 0)
    warnings.push("layout_regions_not_found");
  if (mode === "diagram" && diagram === null) warnings.push("diagram_json_not_found");

  return {
    diagram,
    html_table: htmlTable,
    json_result: jsonResult,
    layout_details: jsonResult,
    latex,
    layout_blocks: layoutBlocks,
    markdown,
    markdown_result: markdownResult,
    text: normalizedText || markdownResult,
    warnings: uniqueStrings(warnings),
  };
}

export function extractOutputText(raw: unknown): string {
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
  const choices = raw.choices;
  if (Array.isArray(choices)) {
    return choices
      .filter(isRecord)
      .map((choice) => {
        const message = choice.message;
        return isRecord(message) && typeof message.content === "string" ? message.content : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof raw.markdown_result === "string") return raw.markdown_result;
  if (typeof raw.md_results === "string") return raw.md_results;
  return "";
}

export async function getLmStudioModelStatus(
  baseUrl = DEFAULT_LMSTUDIO_BASE_URL,
  model = DEFAULT_GLM_OCR_MODEL,
  timeoutMs = 5_000
): Promise<{ available: boolean; loaded: boolean | null; models: string[]; error?: string }> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  try {
    const response = await axios.get(`${normalizedBaseUrl}/api/v1/models`, {
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      return { available: false, loaded: null, models: [], error: `status ${response.status}` };
    }
    const modelsPayload = isRecord(response.data) ? response.data.models : undefined;
    const models = Array.isArray(modelsPayload)
      ? modelsPayload
          .filter(isRecord)
          .map((item) => (typeof item.key === "string" ? item.key : undefined))
          .filter((item): item is string => Boolean(item))
      : [];
    const selected = Array.isArray(modelsPayload)
      ? modelsPayload.filter(isRecord).find((item) => item.key === model)
      : undefined;
    const loadedInstances =
      selected && Array.isArray(selected.loaded_instances) ? selected.loaded_instances : undefined;
    return {
      available: models.includes(model),
      loaded: loadedInstances ? loadedInstances.length > 0 : null,
      models,
    };
  } catch (error) {
    return {
      available: false,
      loaded: null,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureLmStudioModelLoaded(input: {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; loaded: boolean; attempted_load: boolean; error?: string }> {
  const baseUrl = input.baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL;
  const model = input.model ?? DEFAULT_GLM_OCR_MODEL;
  const initial = await getLmStudioModelStatus(baseUrl, model, 5_000);
  if (initial.loaded === true) {
    return { ok: true, loaded: true, attempted_load: false };
  }
  if (!initial.available) {
    return {
      ok: false,
      loaded: false,
      attempted_load: false,
      error: initial.error
        ? `LM Studio model lookup failed: ${initial.error}`
        : `LM Studio model not installed: ${model}`,
    };
  }
  try {
    await execFileAsync("lms", ["load", model, "--identifier", model, "-y"], {
      timeout: input.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    return {
      ok: false,
      loaded: false,
      attempted_load: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const afterLoad = await getLmStudioModelStatus(baseUrl, model, 5_000);
  return {
    ok: afterLoad.loaded !== false,
    loaded: afterLoad.loaded === true,
    attempted_load: true,
    error:
      afterLoad.loaded === false
        ? `LM Studio model did not report loaded after lms load: ${model}`
        : afterLoad.error,
  };
}

function buildLmStudioPayload(input: {
  apiMode: LmStudioApiMode;
  contextLength: number;
  dataUrl: string;
  maxOutputTokens: number;
  mode: LmStudioOcrMode;
  model: string;
  temperature: number;
}): unknown {
  const prompt = promptForLmStudioOcrMode(input.mode);
  if (input.apiMode === "openai") {
    return {
      model: input.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: input.dataUrl } },
          ],
        },
      ],
      max_tokens: input.maxOutputTokens,
      temperature: input.temperature,
      top_p: 1,
    };
  }
  return {
    context_length: input.contextLength,
    input: [
      { type: "text", content: prompt },
      { type: "image", data_url: input.dataUrl },
    ],
    max_output_tokens: input.maxOutputTokens,
    model: input.model,
    store: false,
    temperature: input.temperature,
  };
}

async function prepareImageInput(image: string | Buffer): Promise<ImageInputInfo> {
  const buffer = typeof image === "string" ? await fs.readFile(image) : image;
  const mimeType =
    typeof image === "string"
      ? mimeTypeFromPathOrBuffer(image, buffer)
      : mimeTypeFromBuffer(buffer);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to determine image dimensions");
  }
  return {
    buffer,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    height: metadata.height,
    inputPath: typeof image === "string" ? path.resolve(image) : undefined,
    mimeType,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    width: metadata.width,
  };
}

function mimeTypeFromPathOrBuffer(inputPath: string, buffer: Buffer): string {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return mimeTypeFromBuffer(buffer);
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
  return "application/octet-stream";
}

function makeFailureArtifact(input: {
  apiKey?: string;
  apiMode: LmStudioApiMode;
  baseUrl: string;
  contextLength: number;
  endpoint: string;
  error: string;
  imageInfo?: ImageInputInfo;
  maxOutputTokens: number;
  mode: LmStudioOcrMode;
  model: string;
  temperature: number;
  timeoutMs: number;
}): LmStudioOcrArtifact {
  return {
    ok: false,
    api_key_set: Boolean(input.apiKey),
    base_url: input.baseUrl,
    endpoint: input.endpoint,
    error: input.error,
    image: {
      height: input.imageInfo?.height ?? 0,
      mime_type: input.imageInfo?.mimeType ?? "application/octet-stream",
      width: input.imageInfo?.width ?? 0,
    },
    input_image_path: input.imageInfo?.inputPath,
    input_sha256: input.imageInfo?.sha256,
    mode: input.mode,
    model: input.model,
    parsed: {
      diagram: null,
      html_table: "",
      json_result: [],
      layout_details: [],
      latex: "",
      layout_blocks: [],
      markdown: "",
      markdown_result: "",
      text: "",
      warnings: [],
    },
    provenance: {
      generated_by: "liteparse lmstudio-ocr",
      trust_boundary: "model output is untrusted OCR evidence",
    },
    request: {
      api_mode: input.apiMode,
      context_length: input.contextLength,
      max_output_tokens: input.maxOutputTokens,
      temperature: input.temperature,
      timeout_ms: input.timeoutMs,
    },
  };
}

function collectRegions(...values: unknown[]): RegionLike[] {
  const regions: RegionLike[] = [];
  for (const value of values) {
    collectRegionsInto(value, regions);
  }
  const seen = new Set<string>();
  return regions.filter((region) => {
    const key = JSON.stringify([
      stringifyRegionText(region),
      region.bbox_2d ?? region.box_2d ?? region.bbox ?? region.poly ?? region.polygon ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectRegionsInto(value: unknown, regions: RegionLike[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRegionsInto(item, regions);
    return;
  }
  if (!isRecord(value)) return;
  if (
    "content" in value ||
    "text" in value ||
    "bbox_2d" in value ||
    "bbox" in value ||
    "box_2d" in value
  ) {
    regions.push(value as RegionLike);
    return;
  }
  for (const key of ["json_result", "layout_details", "layout_blocks", "blocks"]) {
    collectRegionsInto(value[key], regions);
  }
}

function stringifyRegionText(region: RegionLike): string {
  const value = region.content ?? region.text;
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function regionToPixelBbox(
  region: RegionLike,
  imageWidth: number,
  imageHeight: number
): [number, number, number, number] | null {
  const normalizedBox = toNumberArray(region.bbox_2d ?? region.box_2d);
  if (normalizedBox && normalizedBox.length >= 4) {
    return clampBbox(
      [
        Math.round((normalizedBox[0] * imageWidth) / 1000),
        Math.round((normalizedBox[1] * imageHeight) / 1000),
        Math.round((normalizedBox[2] * imageWidth) / 1000),
        Math.round((normalizedBox[3] * imageHeight) / 1000),
      ],
      imageWidth,
      imageHeight
    );
  }

  const pixelBox = toNumberArray(region.bbox);
  if (pixelBox && pixelBox.length >= 4) {
    return clampBbox(pixelBox.slice(0, 4), imageWidth, imageHeight);
  }

  const polygon = toNumberArray(region.poly ?? region.polygon);
  if (polygon && polygon.length >= 8) {
    const xs = polygon.filter((_, index) => index % 2 === 0);
    const ys = polygon.filter((_, index) => index % 2 === 1);
    return clampBbox(
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      imageWidth,
      imageHeight
    );
  }

  return null;
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
      text: line,
      bbox: [0, y1, imageWidth, Math.max(y2, y1 + 1)] as [number, number, number, number],
      confidence: 1,
    };
  });
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  if (value > 1) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
}

function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.map((item) => Number(item));
  return numbers.every((item) => Number.isFinite(item)) ? numbers : null;
}

function extractFencedJson(text: string): unknown | null {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [match?.[1], text].filter((value): value is string =>
    Boolean(value && value.trim())
  );
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim()) as unknown;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function extractHtmlTable(text: string): string {
  const match = /<table[\s\S]*?<\/table>/i.exec(text);
  return match?.[0]?.trim() ?? "";
}

function extractLatex(text: string): string {
  const block = /\\\[[\s\S]*?\\\]/.exec(text) ?? /\$\$[\s\S]*?\$\$/.exec(text);
  if (block) return block[0].trim();
  const inline = /\$[^$\n]+\$/.exec(text);
  if (inline) return inline[0].trim();
  if (/\\(?:frac|sum|sqrt|begin|alpha|beta|omega|xi|lambda)\b/.test(text)) return text.trim();
  return "";
}

function wrapRegionArray(value: unknown[]): unknown[] {
  if (
    value.every(isRecord) &&
    value.some((item) => "bbox_2d" in item || "bbox" in item || "content" in item)
  ) {
    return [value];
  }
  return value;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function shouldAutoLoadModel(baseUrl: string): boolean {
  if (process.env.LITEPARSE_LMSTUDIO_AUTO_LOAD === "0") return false;
  if (process.env.LITEPARSE_LMSTUDIO_AUTO_LOAD === "false") return false;
  try {
    const parsed = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
