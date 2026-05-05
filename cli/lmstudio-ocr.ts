import { Command, Option } from "commander";
import fs from "fs/promises";
import { existsSync, readdirSync, statSync } from "fs";
import os from "os";
import path from "path";
import { LiteParse } from "../src/core/parser.js";
import {
  DEFAULT_GLM_OCR_MODEL,
  DEFAULT_LMSTUDIO_BASE_URL,
  DEFAULT_LMSTUDIO_OCR_PORT,
  LmStudioApiMode,
  LmStudioOcrMode,
  LmStudioOcrOptions,
  convertLmStudioArtifactToOcrResults,
  runLmStudioOcr,
} from "../src/engines/ocr/lmstudio.js";
import { startLmStudioOcrServer } from "../src/engines/ocr/lmstudio-server.js";

interface CommonLmStudioOptions {
  apiMode?: LmStudioApiMode;
  baseUrl?: string;
  config?: string;
  contextLength?: string;
  maxOutputTokens?: string;
  mode?: LmStudioOcrMode;
  model?: string;
  noAutoLoad?: boolean;
  rawOutput?: string;
  set?: string[];
  strictBbox?: boolean;
  temperature?: string;
  timeoutMs?: string;
}

interface LmStudioOcrCommandOptions extends CommonLmStudioOptions {
  json?: boolean;
  noSave?: boolean;
  output?: string;
}

interface LmStudioOcrServerCommandOptions extends CommonLmStudioOptions {
  concurrency?: string;
  host?: string;
  maxImageBytes?: string;
  port?: string;
}

interface LmStudioOcrPipelineOptions extends CommonLmStudioOptions {
  concurrency?: string;
  dpi?: string;
  json?: boolean;
  noSave?: boolean;
  output?: string;
  path?: string;
  quiet?: boolean;
  targetPages?: string;
}

interface PipelinePageArtifact {
  artifactPath?: string;
  liteparseOcrPath?: string;
  markdown: string;
  page: number;
  pageImagePath?: string;
  warnings: string[];
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".docm",
  ".odt",
  ".rtf",
  ".ppt",
  ".pptx",
  ".pptm",
  ".odp",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".ods",
  ".csv",
  ".tsv",
]);
const SUPPORTED_PIPELINE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);

export function registerLmStudioOcrCommands(program: Command): void {
  program
    .command("lmstudio-ocr <image>")
    .description("Run GLM-OCR through LM Studio for a single image")
    .option("-o, --output <file>", "Write normalized OCR artifact JSON to a file")
    .option("--raw-output <file>", "Write raw LM Studio response JSON to a file")
    .addOption(modeOption())
    .addOption(apiModeOption())
    .option("--base-url <url>", "LM Studio base URL", DEFAULT_LMSTUDIO_BASE_URL)
    .option("--model <model>", "LM Studio model identifier", DEFAULT_GLM_OCR_MODEL)
    .option("--no-auto-load", "Do not run lms load automatically when the model is not loaded")
    .option("--json", "Print normalized artifact JSON to stdout")
    .option("--strict-bbox", "Drop OCR results without parseable bounding boxes")
    .option("--context-length <n>", "LM Studio context length", "16384")
    .option("--max-output-tokens <n>", "Maximum output tokens", "2048")
    .option("--temperature <n>", "Sampling temperature", "0")
    .option("--timeout-ms <n>", "Request timeout in milliseconds", "120000")
    .option("--config <file>", "JSON config file")
    .option("--set <key=value...>", "Override config values using key=value pairs")
    .action(async (image: string, options: LmStudioOcrCommandOptions) => {
      if (!existsSync(image)) {
        exitWithError(`File not found: ${image}`);
      }
      const ocrOptions = await resolveLmStudioOptions(options);
      const artifact = await runLmStudioOcr(image, ocrOptions);
      if (options.output) {
        await writeJsonFile(options.output, artifact);
      }
      if (options.json || !artifact.ok) {
        console.log(JSON.stringify(artifact, null, 2));
      } else {
        console.log(artifact.parsed.markdown_result || artifact.parsed.text || "");
      }
      if (!artifact.ok) process.exit(1);
    });

  program
    .command("lmstudio-ocr-server")
    .description("Start a LiteParse-compatible HTTP OCR server backed by LM Studio GLM-OCR")
    .option("--host <host>", "Server host", "127.0.0.1")
    .option("--port <port>", "Server port", String(DEFAULT_LMSTUDIO_OCR_PORT))
    .option("--base-url <url>", "LM Studio base URL", DEFAULT_LMSTUDIO_BASE_URL)
    .option("--model <model>", "LM Studio model identifier", DEFAULT_GLM_OCR_MODEL)
    .option("--no-auto-load", "Do not run lms load automatically when the model is not loaded")
    .addOption(modeOption())
    .addOption(apiModeOption())
    .option("--concurrency <n>", "Maximum concurrent OCR requests", "1")
    .option("--max-image-bytes <n>", "Maximum uploaded image size", String(25 * 1024 * 1024))
    .option("--strict-bbox", "Drop OCR results without parseable bounding boxes")
    .option("--context-length <n>", "LM Studio context length", "16384")
    .option("--max-output-tokens <n>", "Maximum output tokens", "2048")
    .option("--temperature <n>", "Sampling temperature", "0")
    .option("--timeout-ms <n>", "Request timeout in milliseconds", "120000")
    .option("--config <file>", "JSON config file")
    .option("--set <key=value...>", "Override config values using key=value pairs")
    .action(async (options: LmStudioOcrServerCommandOptions) => {
      const ocrOptions = await resolveLmStudioOptions(options);
      const host = options.host ?? "127.0.0.1";
      const port = parseInteger(options.port, DEFAULT_LMSTUDIO_OCR_PORT);
      const server = startLmStudioOcrServer({
        ...ocrOptions,
        concurrency: parseInteger(options.concurrency, 1),
        host,
        maxImageBytes: parseInteger(options.maxImageBytes, 25 * 1024 * 1024),
        port,
      });
      const url = `http://${host}:${port}/ocr`;
      console.error(`LiteParse LM Studio OCR server listening at ${url}`);
      console.error(`Use: lit parse document.pdf --ocr-server-url ${url} --format json`);
      server.on("error", (error) => {
        exitWithError(error.message);
      });
    });

  program
    .command("lmstudio-ocr-pipeline")
    .description("Render documents or images and run advanced GLM-OCR artifacts through LM Studio")
    .requiredOption("-p, --path <path>", "Input file or directory")
    .requiredOption("-o, --output <dir>", "Output artifact directory")
    .addOption(modeOption())
    .addOption(apiModeOption())
    .option("--base-url <url>", "LM Studio base URL", DEFAULT_LMSTUDIO_BASE_URL)
    .option("--model <model>", "LM Studio model identifier", DEFAULT_GLM_OCR_MODEL)
    .option("--no-auto-load", "Do not run lms load automatically when the model is not loaded")
    .option("--target-pages <pages>", 'Target pages for document rendering, e.g. "1-5,10"')
    .option("--dpi <dpi>", "DPI for rendered pages", "200")
    .option("--concurrency <n>", "Maximum concurrent OCR calls", "1")
    .option("--json", "Print summary JSON to stdout")
    .option("--no-save", "Do not save artifacts to the output directory")
    .option("--raw-output <dir>", "Directory for raw LM Studio responses")
    .option("--strict-bbox", "Drop OCR results without parseable bounding boxes")
    .option("--context-length <n>", "LM Studio context length", "16384")
    .option("--max-output-tokens <n>", "Maximum output tokens", "2048")
    .option("--temperature <n>", "Sampling temperature", "0")
    .option("--timeout-ms <n>", "Request timeout in milliseconds", "120000")
    .option("--config <file>", "JSON config file")
    .option("--set <key=value...>", "Override config values using key=value pairs")
    .option("-q, --quiet", "Suppress progress output")
    .action(async (options: LmStudioOcrPipelineOptions) => {
      await runPipelineCommand(options);
    });
}

async function runPipelineCommand(options: LmStudioOcrPipelineOptions): Promise<void> {
  const inputPath = options.path;
  if (!inputPath || !existsSync(inputPath)) {
    exitWithError(`Input path not found: ${inputPath ?? ""}`);
  }
  const save = options.noSave !== true;
  const outputDir = options.output;
  if (!outputDir) {
    exitWithError("Missing required output directory");
  }
  if (save) {
    await fs.mkdir(outputDir, { recursive: true });
  }

  const files = collectPipelineInputs(inputPath);
  if (files.length === 0) exitWithError("No supported input files found");

  const ocrOptions = await resolveLmStudioOptions(options);
  const targetPages = options.targetPages ? parsePageNumbers(options.targetPages) : undefined;
  const dpi = parseInteger(options.dpi, 200);
  const concurrency = parseInteger(options.concurrency, 1);
  const tempRoot = save
    ? undefined
    : await fs.mkdtemp(path.join(os.tmpdir(), "liteparse-lmstudio-"));
  const summaries: unknown[] = [];

  try {
    await runWithConcurrency(files, concurrency, async (file) => {
      if (!options.quiet) console.error(`Processing ${file}`);
      const summary = await processPipelineFile({
        file,
        inputRoot: statSync(inputPath).isDirectory() ? inputPath : undefined,
        ocrOptions,
        outputRoot: outputDir,
        save,
        tempRoot,
        targetPages,
        dpi,
      });
      summaries.push(summary);
    });
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }

  const finalSummary = {
    ok: summaries.every((item) => isRecord(item) && item.ok !== false),
    input_path: path.resolve(inputPath),
    output_dir: save ? path.resolve(outputDir) : undefined,
    files: summaries,
  };
  if (options.json || !save) {
    console.log(JSON.stringify(finalSummary, null, 2));
  }
}

async function processPipelineFile(input: {
  dpi: number;
  file: string;
  inputRoot?: string;
  ocrOptions: LmStudioOcrOptions;
  outputRoot: string;
  save: boolean;
  targetPages?: number[];
  tempRoot?: string;
}): Promise<unknown> {
  const ext = path.extname(input.file).toLowerCase();
  const stem = path.basename(input.file, ext);
  const relativeDir = input.inputRoot
    ? path.dirname(path.relative(input.inputRoot, input.file))
    : "";
  const fileOutputRoot = input.save
    ? path.join(input.outputRoot, relativeDir === "." ? "" : relativeDir, stem)
    : path.join(input.tempRoot ?? input.outputRoot, stem);
  const pagesDir = path.join(fileOutputRoot, "pages");
  const rawDir = path.join(fileOutputRoot, "raw");
  const ocrDir = path.join(fileOutputRoot, "ocr");
  const liteparseDir = path.join(fileOutputRoot, "liteparse");
  const finalDir = path.join(fileOutputRoot, "final");
  if (input.save) {
    await Promise.all(
      [pagesDir, rawDir, ocrDir, liteparseDir, finalDir].map((dir) =>
        fs.mkdir(dir, { recursive: true })
      )
    );
  } else {
    await fs.mkdir(pagesDir, { recursive: true });
  }

  const pageImages = IMAGE_EXTENSIONS.has(ext)
    ? [{ page: 1, buffer: await fs.readFile(input.file), sourcePath: input.file }]
    : await renderDocumentPages(input.file, pagesDir, input.targetPages, input.dpi, input.save);

  const pageArtifacts: PipelinePageArtifact[] = [];
  for (const pageImage of pageImages) {
    const pageImagePath = input.save
      ? path.join(pagesDir, `page_${String(pageImage.page).padStart(3, "0")}.png`)
      : path.join(pagesDir, `page_${String(pageImage.page).padStart(3, "0")}.png`);
    if (!input.save || !existsSync(pageImagePath)) {
      await fs.writeFile(pageImagePath, pageImage.buffer);
    }
    const rawResponsePath = input.save
      ? path.join(rawDir, `page_${String(pageImage.page).padStart(3, "0")}.raw.json`)
      : undefined;
    const artifact = await runLmStudioOcr(pageImagePath, {
      ...input.ocrOptions,
      rawResponsePath,
    });
    const converted = convertLmStudioArtifactToOcrResults(artifact, {
      strictBbox: input.ocrOptions.strictBbox,
    });
    const artifactPath = input.save
      ? path.join(ocrDir, `page_${String(pageImage.page).padStart(3, "0")}.glm-ocr.json`)
      : undefined;
    const liteparseOcrPath = input.save
      ? path.join(liteparseDir, `page_${String(pageImage.page).padStart(3, "0")}.ocr-results.json`)
      : undefined;
    if (artifactPath) await writeJsonFile(artifactPath, artifact);
    if (liteparseOcrPath)
      await writeJsonFile(liteparseOcrPath, {
        results: converted.results,
        warnings: converted.warnings,
      });
    pageArtifacts.push({
      artifactPath,
      liteparseOcrPath,
      markdown: artifact.parsed.markdown_result || artifact.parsed.text,
      page: pageImage.page,
      pageImagePath: input.save ? pageImagePath : undefined,
      warnings: converted.warnings,
    });
  }

  const documentMarkdown = pageArtifacts
    .map((page) => page.markdown)
    .filter(Boolean)
    .join("\n\n---\n\n");
  const documentJson = {
    source_path: path.resolve(input.file),
    model: input.ocrOptions.model ?? DEFAULT_GLM_OCR_MODEL,
    mode: input.ocrOptions.mode ?? "auto",
    pages: pageArtifacts,
  };
  if (input.save) {
    await fs.writeFile(path.join(finalDir, "document.md"), documentMarkdown, "utf-8");
    await writeJsonFile(path.join(finalDir, "document.json"), documentJson);
    await writeJsonFile(path.join(fileOutputRoot, "manifest.json"), {
      source_path: path.resolve(input.file),
      output_root: path.resolve(fileOutputRoot),
      page_count: pageArtifacts.length,
      generated_by: "lit lmstudio-ocr-pipeline",
    });
  }
  return {
    ok: true,
    source_path: path.resolve(input.file),
    output_root: input.save ? path.resolve(fileOutputRoot) : undefined,
    page_count: pageArtifacts.length,
    warnings: [...new Set(pageArtifacts.flatMap((page) => page.warnings))],
  };
}

async function renderDocumentPages(
  file: string,
  pagesDir: string,
  targetPages: number[] | undefined,
  dpi: number,
  save: boolean
): Promise<Array<{ page: number; buffer: Buffer }>> {
  const parser = new LiteParse({ dpi, ocrEnabled: false });
  const screenshots = await parser.screenshot(file, targetPages, true);
  const pages: Array<{ page: number; buffer: Buffer }> = [];
  for (const screenshot of screenshots) {
    const buffer = Buffer.from(screenshot.imageBuffer);
    pages.push({ page: screenshot.pageNum, buffer });
    if (save) {
      await fs.writeFile(
        path.join(pagesDir, `page_${String(screenshot.pageNum).padStart(3, "0")}.png`),
        buffer
      );
    }
  }
  return pages;
}

async function resolveLmStudioOptions(options: CommonLmStudioOptions): Promise<LmStudioOcrOptions> {
  const fileConfig = options.config ? await readJsonConfig(options.config) : {};
  const overrides = parseSetOverrides(options.set);
  const merged = { ...fileConfig, ...overrides };
  return {
    apiMode: options.apiMode ?? asApiMode(merged.apiMode) ?? "lmstudio-native",
    autoLoadModel: options.noAutoLoad ? false : merged.autoLoadModel !== false,
    baseUrl: options.baseUrl ?? stringValue(merged.baseUrl) ?? DEFAULT_LMSTUDIO_BASE_URL,
    contextLength: parseInteger(options.contextLength, numberValue(merged.contextLength) ?? 16_384),
    maxOutputTokens: parseInteger(
      options.maxOutputTokens,
      numberValue(merged.maxOutputTokens) ?? 2_048
    ),
    mode: options.mode ?? asMode(merged.mode) ?? "auto",
    model: options.model ?? stringValue(merged.model) ?? DEFAULT_GLM_OCR_MODEL,
    rawResponsePath: options.rawOutput ?? stringValue(merged.rawResponsePath),
    strictBbox: options.strictBbox ?? booleanValue(merged.strictBbox) ?? false,
    temperature: parseFloatValue(options.temperature, numberValue(merged.temperature) ?? 0),
    timeoutMs: parseInteger(options.timeoutMs, numberValue(merged.timeoutMs) ?? 120_000),
  };
}

function collectPipelineInputs(inputPath: string): string[] {
  const stat = statSync(inputPath);
  if (stat.isFile()) {
    return SUPPORTED_PIPELINE_EXTENSIONS.has(path.extname(inputPath).toLowerCase())
      ? [inputPath]
      : [];
  }
  const files: string[] = [];
  function scan(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const entryStat = statSync(fullPath);
      if (entryStat.isDirectory()) {
        scan(fullPath);
      } else if (
        entryStat.isFile() &&
        SUPPORTED_PIPELINE_EXTENSIONS.has(path.extname(entry).toLowerCase())
      ) {
        files.push(fullPath);
      }
    }
  }
  scan(inputPath);
  return files.sort();
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function runNext(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runNext()));
}

function parsePageNumbers(pagesStr: string): number[] {
  const pages: number[] = [];
  for (const part of pagesStr.split(",")) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map((value) => parseInt(value.trim(), 10));
      for (let i = start; i <= end; i++) pages.push(i);
    } else {
      pages.push(parseInt(trimmed, 10));
    }
  }
  return [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (a, b) => a - b
  );
}

async function readJsonConfig(file: string): Promise<Record<string, unknown>> {
  if (!existsSync(file)) exitWithError(`Config file not found: ${file}`);
  const raw = await fs.readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function parseSetOverrides(entries: string[] | undefined): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const entry of entries ?? []) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) continue;
    setDotted(output, key, coerceValue(rest.join("=")));
  }
  return output;
}

function setDotted(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".").filter(Boolean);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const last = parts.at(-1);
  if (last) cursor[last] = value;
}

function coerceValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return Number.isFinite(number) && value.trim() !== "" ? number : value;
}

function modeOption(): Option {
  return new Option("--mode <mode>", "OCR mode")
    .choices(["auto", "text", "layout", "table", "formula", "diagram"])
    .default("auto");
}

function apiModeOption(): Option {
  return new Option("--api-mode <mode>", "LM Studio API mode")
    .choices(["lmstudio-native", "openai"])
    .default("lmstudio-native");
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asMode(value: unknown): LmStudioOcrMode | undefined {
  return value === "auto" ||
    value === "text" ||
    value === "layout" ||
    value === "table" ||
    value === "formula" ||
    value === "diagram"
    ? value
    : undefined;
}

function asApiMode(value: unknown): LmStudioApiMode | undefined {
  return value === "lmstudio-native" || value === "openai" ? value : undefined;
}

function exitWithError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
