import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { OcrResult } from "./interface.js";

export interface GlmOcrImageInfo {
  buffer: Buffer;
  dataUrl: string;
  height: number;
  inputPath?: string;
  mimeType: string;
  sha256: string;
  width: number;
}

export interface GlmOcrParsed {
  json_result: unknown[];
  layout_details: unknown[];
  markdown_result: string;
  md_results: string;
  model?: string;
  raw: unknown;
}

export interface GlmOcrConversionResult {
  bbox_backed_region_count: number;
  dropped_region_count: number;
  markdown: string;
  region_count: number;
  results: OcrResult[];
  warnings: string[];
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
  task_type?: unknown;
  text?: unknown;
}

export async function prepareGlmOcrImageInput(image: string | Buffer): Promise<GlmOcrImageInfo> {
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

export function normalizeGlmOcrResponse(raw: unknown): GlmOcrParsed {
  const record = isRecord(raw) ? raw : {};
  const jsonResult = normalizePageArray(record.json_result);
  const layoutDetails = normalizePageArray(record.layout_details);
  const markdownResult = stringValue(record.markdown_result);
  const mdResults = stringValue(record.md_results);
  const model = stringValue(record.model);
  return {
    json_result: jsonResult,
    layout_details: layoutDetails,
    markdown_result: markdownResult,
    md_results: mdResults,
    model,
    raw,
  };
}

export function convertGlmOcrResponseToOcrResults(
  raw: unknown,
  image: { width: number; height: number },
  options: { strictBbox?: boolean } = {}
): GlmOcrConversionResult {
  const parsed = normalizeGlmOcrResponse(raw);
  const warnings: string[] = [];
  const sourceRegions = collectRegions(
    parsed.json_result.length > 0 ? parsed.json_result : parsed.layout_details
  );
  const results: OcrResult[] = [];
  let droppedRegionCount = 0;
  let bboxBackedRegionCount = 0;

  if (sourceRegions.length === 0) {
    warnings.push("glmocr_layout_missing");
  }

  for (const region of sourceRegions) {
    const text = stringifyRegionText(region);
    if (!text) {
      droppedRegionCount += 1;
      continue;
    }
    const bbox = regionToPixelBbox(region, image.width, image.height);
    if (!bbox) {
      droppedRegionCount += 1;
      warnings.push("region_bbox_missing");
      continue;
    }
    bboxBackedRegionCount += 1;
    results.push({
      text,
      bbox,
      confidence: normalizeConfidence(region.confidence ?? region.score),
    });
  }

  if (sourceRegions.length > 0 && results.length === 0) {
    warnings.push("empty_ocr_content");
  }
  if (options.strictBbox !== false && droppedRegionCount > 0) {
    warnings.push("degraded_no_layout_bbox");
  }

  return {
    bbox_backed_region_count: bboxBackedRegionCount,
    dropped_region_count: droppedRegionCount,
    markdown: parsed.markdown_result || parsed.md_results,
    region_count: sourceRegions.length,
    results,
    warnings: uniqueStrings(warnings),
  };
}

export function collectGlmOcrRegions(raw: unknown): RegionLike[] {
  return collectRegions(raw);
}

function normalizePageArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  if (
    value.every(isRecord) &&
    value.some((item) => "bbox_2d" in item || "content" in item || "bbox" in item)
  ) {
    return [value];
  }
  return value;
}

function collectRegions(value: unknown): RegionLike[] {
  const regions: RegionLike[] = [];
  collectRegionsInto(value, regions);
  return dedupeRegions(regions);
}

function collectRegionsInto(value: unknown, regions: RegionLike[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRegionsInto(item, regions);
    return;
  }
  if (!isRecord(value)) return;
  if (
    "bbox_2d" in value ||
    "box_2d" in value ||
    "bbox" in value ||
    "content" in value ||
    "text" in value
  ) {
    regions.push(value as RegionLike);
    return;
  }
  for (const key of ["json_result", "layout_details", "layout_blocks", "blocks"]) {
    collectRegionsInto(value[key], regions);
  }
}

function dedupeRegions(regions: RegionLike[]): RegionLike[] {
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
        (normalizedBox[0] * imageWidth) / 1000,
        (normalizedBox[1] * imageHeight) / 1000,
        (normalizedBox[2] * imageWidth) / 1000,
        (normalizedBox[3] * imageHeight) / 1000,
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
