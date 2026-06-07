import type { ModelReasoningEffort, Usage } from "@openai/codex-sdk";

export type OcrBbox = [number, number, number, number];

export interface OcrResult {
  text: string;
  bbox: OcrBbox;
  confidence: number;
}

export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };
export type CodexConfigObject = { [key: string]: CodexConfigValue };

export type CodexOcrBackend = "sdk";
export type CodexOcrCoordinateSpace = "normalized_1000" | "pixel";

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

export interface CodexBbox {
  coordinate_space: CodexOcrCoordinateSpace;
  value: OcrBbox;
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
  region_count: number;
  results: OcrResult[];
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

export type CodexOcrRunner = (
  image: string | Buffer,
  options: CodexOcrOptions,
) => Promise<CodexOcrArtifact>;
