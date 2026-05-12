import { Command, Option } from "commander";
import fs from "fs/promises";
import { existsSync, readdirSync, statSync } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { LiteParse } from "../src/core/parser.js";
import {
  CODEX_OCR_DEFAULTS,
  CodexOcrArtifact,
  CodexOcrBackend,
  CodexOcrOptions,
  CodexOcrParsed,
  runCodexOcr,
} from "../src/engines/ocr/codex.js";
import {
  DEFAULT_CODEX_OCR_PORT,
  coerceCodexOcrBackend,
  startCodexOcrServer,
} from "../src/engines/ocr/codex-server.js";

interface CommonCodexOcrOptions {
  backend?: CodexOcrBackend;
  codexHome?: string;
  codexPath?: string;
  includeRaw?: boolean;
  language?: string;
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  strictBbox?: boolean;
  timeoutMs?: string;
}

interface CodexOcrCommandOptions extends CommonCodexOcrOptions {
  json?: boolean;
  output?: string;
  pageNumber?: string;
  rawOutput?: string;
}

interface CodexOcrServerCommandOptions extends CommonCodexOcrOptions {
  concurrency?: string;
  host?: string;
  maxImageBytes?: string;
  port?: string;
}

interface CodexOcrPipelineOptions extends CommonCodexOcrOptions {
  batchMode?: "worker-pool" | "codex-subagents";
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
  annotationsPath?: string;
  assetPaths: string[];
  codexArtifactPath?: string;
  liteparseOcrPath?: string;
  markdown: string;
  page: number;
  pageImagePath?: string;
  parsed: CodexOcrParsed;
  warnings: string[];
}

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".webp",
  ".svg",
]);
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
  ".pages",
  ".key",
  ".numbers",
]);
const SUPPORTED_PIPELINE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);

export function registerCodexOcrCommands(program: Command): void {
  program
    .command("codex-ocr <image>")
    .description("Run OpenAI Codex multimodal OCR for a single image")
    .option("-o, --output <file>", "Write normalized Codex OCR artifact JSON to a file")
    .option("--raw-output <file>", "Write raw Codex SDK/app-server response JSON to a file")
    .addOption(backendOption())
    .addOption(reasoningEffortOption("medium"))
    .option("--codex-home <dir>", "Codex state directory override; default is $HOME/.codex")
    .option("--codex-path <path>", "Path to the codex CLI binary")
    .option("--model <model>", "Codex model", CODEX_OCR_DEFAULTS.model)
    .option("--language <lang>", "Language hint", "en")
    .option("--page-number <n>", "Page number metadata", "1")
    .option(
      "--timeout-ms <n>",
      "Request timeout in milliseconds",
      String(CODEX_OCR_DEFAULTS.timeoutMs)
    )
    .option("--json", "Print normalized artifact JSON to stdout")
    .option("--include-raw", "Include raw Codex response in saved/printed artifact")
    .option("--strict-bbox", "Drop OCR regions without usable bounding boxes")
    .action(async (image: string, options: CodexOcrCommandOptions) => {
      if (!existsSync(image)) exitWithError(`File not found: ${image}`);
      const ocrOptions = resolveCodexOcrOptions(options, "medium");
      const artifact = await runCodexOcr(image, {
        ...ocrOptions,
        pageNumber: parseInteger(options.pageNumber, 1),
        rawResponsePath: options.rawOutput,
      });
      if (options.output) await writeJsonFile(options.output, artifact);
      if (options.json || !artifact.ok) {
        console.log(JSON.stringify(artifact, null, 2));
      } else {
        console.log(artifact.parsed.markdown);
      }
      if (!artifact.ok) process.exit(1);
    });

  program
    .command("codex-ocr-server")
    .description("Start a LiteParse-compatible /ocr server backed by OpenAI Codex multimodal OCR")
    .option("--host <host>", "Server host", "127.0.0.1")
    .option("--port <port>", "Server port", String(DEFAULT_CODEX_OCR_PORT))
    .addOption(backendOption())
    .addOption(reasoningEffortOption("medium"))
    .option("--codex-home <dir>", "Codex state directory override; default is $HOME/.codex")
    .option("--codex-path <path>", "Path to the codex CLI binary")
    .option("--model <model>", "Codex model", CODEX_OCR_DEFAULTS.model)
    .option("--language <lang>", "Language hint", "en")
    .option("--concurrency <n>", "Maximum concurrent OCR requests", "1")
    .option("--max-image-bytes <n>", "Maximum uploaded image size", String(50 * 1024 * 1024))
    .option(
      "--timeout-ms <n>",
      "Request timeout in milliseconds",
      String(CODEX_OCR_DEFAULTS.timeoutMs)
    )
    .option("--include-raw", "Include raw Codex response in /ocr/analyze artifacts")
    .option("--strict-bbox", "Drop OCR regions without usable bounding boxes")
    .action((options: CodexOcrServerCommandOptions) => {
      const host = options.host ?? "127.0.0.1";
      const port = parseInteger(options.port, DEFAULT_CODEX_OCR_PORT);
      const server = startCodexOcrServer({
        ...resolveCodexOcrOptions(options, "medium"),
        concurrency: parseInteger(options.concurrency, 1),
        host,
        maxImageBytes: parseInteger(options.maxImageBytes, 50 * 1024 * 1024),
        port,
      });
      const url = `http://${host}:${port}/ocr`;
      console.error(`LiteParse Codex OCR server listening at ${url}`);
      console.error(`Use: lit parse document.pdf --ocr-server-url ${url} --format json`);
      server.on("error", (error) => {
        exitWithError(error.message);
      });
    });

  program
    .command("codex-ocr-pipeline")
    .description("Render documents/images and run Codex page OCR artifacts")
    .requiredOption("-p, --path <path>", "Input file or directory")
    .requiredOption("-o, --output <dir>", "Output artifact directory")
    .addOption(backendOption())
    .addOption(reasoningEffortOption("high"))
    .addOption(batchModeOption())
    .option("--codex-home <dir>", "Codex state directory override; default is $HOME/.codex")
    .option("--codex-path <path>", "Path to the codex CLI binary")
    .option("--model <model>", "Codex model", CODEX_OCR_DEFAULTS.model)
    .option("--language <lang>", "Language hint", "en")
    .option("--target-pages <pages>", 'Target pages for document rendering, e.g. "1-5,10"')
    .option("--dpi <dpi>", "DPI for rendered pages", "200")
    .option("--concurrency <n>", "Maximum concurrent page OCR jobs", "1")
    .option(
      "--timeout-ms <n>",
      "Request timeout in milliseconds",
      String(CODEX_OCR_DEFAULTS.timeoutMs)
    )
    .option("--json", "Print summary JSON to stdout")
    .option("--no-save", "Do not save artifacts to the output directory")
    .option("--include-raw", "Include raw Codex responses in page artifacts")
    .option("--strict-bbox", "Drop OCR regions without usable bounding boxes")
    .option("-q, --quiet", "Suppress progress output")
    .action(async (options: CodexOcrPipelineOptions) => {
      await runPipelineCommand(options);
    });
}

async function runPipelineCommand(options: CodexOcrPipelineOptions): Promise<void> {
  const inputPath = options.path;
  if (!inputPath || !existsSync(inputPath))
    exitWithError(`Input path not found: ${inputPath ?? ""}`);
  const save = options.noSave !== true;
  const outputDir = options.output;
  if (!outputDir) exitWithError("Missing required output directory");
  if (save) await fs.mkdir(outputDir, { recursive: true });

  const files = collectPipelineInputs(inputPath);
  if (files.length === 0) exitWithError("No supported input files found");

  const ocrOptions = resolveCodexOcrOptions(options, "high");
  const targetPages = options.targetPages ? parsePageNumbers(options.targetPages) : undefined;
  const dpi = parseInteger(options.dpi, 200);
  const concurrency = parseInteger(options.concurrency, 1);
  const tempRoot = save ? undefined : await fs.mkdtemp(path.join(os.tmpdir(), "liteparse-codex-"));
  const summaries: unknown[] = [];

  try {
    for (const file of files) {
      if (!options.quiet) console.error(`Processing ${file}`);
      const summary = await processPipelineFile({
        batchMode: options.batchMode ?? "worker-pool",
        concurrency,
        dpi,
        file,
        inputRoot: statSync(inputPath).isDirectory() ? inputPath : undefined,
        ocrOptions,
        outputRoot: outputDir,
        save,
        targetPages,
        tempRoot,
      });
      summaries.push(summary);
    }
  } finally {
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  }

  const finalSummary = {
    ok: summaries.every((item) => isRecord(item) && item.ok !== false),
    input_path: path.resolve(inputPath),
    output_dir: save ? path.resolve(outputDir) : undefined,
    files: summaries,
  };
  if (options.json || !save) console.log(JSON.stringify(finalSummary, null, 2));
}

async function processPipelineFile(input: {
  batchMode: "worker-pool" | "codex-subagents";
  concurrency: number;
  dpi: number;
  file: string;
  inputRoot?: string;
  ocrOptions: CodexOcrOptions;
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
  const codexDir = path.join(fileOutputRoot, "codex");
  const liteparseDir = path.join(fileOutputRoot, "liteparse");
  const assetsDir = path.join(fileOutputRoot, "assets");
  const annotationsDir = path.join(fileOutputRoot, "annotations");
  const finalDir = path.join(fileOutputRoot, "final");
  await fs.mkdir(pagesDir, { recursive: true });
  if (input.save) {
    await Promise.all(
      [codexDir, liteparseDir, assetsDir, annotationsDir, finalDir].map((dir) =>
        fs.mkdir(dir, { recursive: true })
      )
    );
  }

  const pageImages = IMAGE_EXTENSIONS.has(ext)
    ? await renderImagePage(input.file, pagesDir, input.save)
    : await renderDocumentPages(input.file, pagesDir, input.targetPages, input.dpi, input.save);

  if (input.batchMode === "codex-subagents" && input.save) {
    await writePageJobsCsv(pageImages, codexDir);
  }

  const pageArtifacts: PipelinePageArtifact[] = [];
  await runWithConcurrency(pageImages, input.concurrency, async (pageImage) => {
    const pageImagePath = path.join(
      pagesDir,
      `page_${String(pageImage.page).padStart(3, "0")}.png`
    );
    if (!input.save || !existsSync(pageImagePath))
      await fs.writeFile(pageImagePath, pageImage.buffer);
    const pageLabel = String(pageImage.page).padStart(3, "0");
    const rawResponsePath =
      input.save && input.ocrOptions.includeRaw
        ? path.join(codexDir, `page_${pageLabel}.raw.json`)
        : undefined;
    const artifact = await runCodexOcr(pageImagePath, {
      ...input.ocrOptions,
      pageNumber: pageImage.page,
      rawResponsePath,
    });
    const codexArtifactPath = input.save
      ? path.join(codexDir, `page_${pageLabel}.codex.json`)
      : undefined;
    const liteparseOcrPath = input.save
      ? path.join(liteparseDir, `page_${pageLabel}.ocr-results.json`)
      : undefined;
    const annotationsPath = input.save
      ? path.join(annotationsDir, `page_${pageLabel}.annotation.json`)
      : undefined;
    const assetPaths = input.save
      ? await writeAssetArtifacts(assetsDir, pageImage.page, artifact)
      : [];
    if (codexArtifactPath) await writeJsonFile(codexArtifactPath, artifact);
    if (liteparseOcrPath) {
      await writeJsonFile(liteparseOcrPath, {
        results: artifact.conversion.results,
        warnings: artifact.warnings,
        region_count: artifact.conversion.region_count,
        bbox_backed_region_count: artifact.conversion.bbox_backed_region_count,
      });
    }
    if (annotationsPath) {
      await writeJsonFile(annotationsPath, {
        page: pageImage.page,
        annotations: artifact.parsed.annotations,
        generated_captions: buildGeneratedCaptions(artifact),
      });
    }
    pageArtifacts.push({
      annotationsPath,
      assetPaths,
      codexArtifactPath,
      liteparseOcrPath,
      markdown: buildPipelinePageMarkdown(artifact, pageImage.page),
      page: pageImage.page,
      pageImagePath: input.save ? pageImagePath : undefined,
      parsed: artifact.parsed,
      warnings: artifact.warnings,
    });
  });

  pageArtifacts.sort((a, b) => a.page - b.page);
  const documentMarkdown = pageArtifacts
    .map((page) => page.markdown)
    .filter(Boolean)
    .join("\n\n---\n\n");
  const documentJson = {
    source_path: path.resolve(input.file),
    model: input.ocrOptions.model ?? CODEX_OCR_DEFAULTS.model,
    backend: input.ocrOptions.backend ?? "sdk",
    pages: pageArtifacts,
  };
  if (input.save) {
    await fs.writeFile(path.join(finalDir, "document.md"), documentMarkdown, "utf-8");
    await writeJsonFile(path.join(finalDir, "document.json"), documentJson);
    await writeJsonFile(path.join(fileOutputRoot, "manifest.json"), {
      source_path: path.resolve(input.file),
      output_root: path.resolve(fileOutputRoot),
      page_count: pageArtifacts.length,
      generated_by: "lit codex-ocr-pipeline",
      batch_mode: input.batchMode,
      model: input.ocrOptions.model ?? CODEX_OCR_DEFAULTS.model,
      backend: input.ocrOptions.backend ?? "sdk",
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

async function renderImagePage(
  file: string,
  pagesDir: string,
  save: boolean
): Promise<Array<{ page: number; buffer: Buffer }>> {
  const buffer = await sharp(file).png().toBuffer();
  if (save) await fs.writeFile(path.join(pagesDir, "page_001.png"), buffer);
  return [{ page: 1, buffer }];
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

async function writeAssetArtifacts(
  assetsDir: string,
  page: number,
  artifact: CodexOcrArtifact
): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < artifact.parsed.assets.length; i++) {
    const asset = artifact.parsed.assets[i];
    const typeDir = path.join(assetsDir, sanitizePathSegment(asset.type));
    const file = path.join(
      typeDir,
      `page_${String(page).padStart(3, "0")}_asset_${String(i + 1).padStart(3, "0")}.json`
    );
    await writeJsonFile(file, asset);
    paths.push(file);
  }
  return paths;
}

async function writePageJobsCsv(
  pageImages: Array<{ page: number; buffer: Buffer }>,
  codexDir: string
): Promise<void> {
  const lines = ["page,image_path,output_json_path"];
  for (const pageImage of pageImages) {
    const label = String(pageImage.page).padStart(3, "0");
    lines.push(
      [
        String(pageImage.page),
        csvCell(path.join(path.dirname(codexDir), "pages", `page_${label}.png`)),
        csvCell(path.join(codexDir, `page_${label}.codex.json`)),
      ].join(",")
    );
  }
  await fs.writeFile(path.join(codexDir, "page_jobs.csv"), `${lines.join("\n")}\n`, "utf-8");
}

function buildGeneratedCaptions(artifact: CodexOcrArtifact): string[] {
  return artifact.parsed.assets
    .filter((asset) => ["illustration", "chart", "image"].includes(asset.type))
    .map((asset, index) => `Image [${index + 1}]: ${asset.caption || asset.title}`.trim());
}

function buildPipelinePageMarkdown(artifact: CodexOcrArtifact, fallbackPage: number): string {
  const parsed = artifact.parsed;
  const sections = [parsed.markdown.trim()].filter(Boolean);
  const metadataLines = [
    `- Page number: ${parsed.page_metadata.page_number || fallbackPage}`,
    parsed.page_metadata.title ? `- Title: ${parsed.page_metadata.title}` : "",
    parsed.page_metadata.detected_language
      ? `- Detected language: ${parsed.page_metadata.detected_language}`
      : "",
  ].filter(Boolean);
  const regionLines = parsed.layout_regions
    .filter((region) => isDocumentContextRegion(region.type) && region.text.trim())
    .map(
      (region) => `- ${region.type}${region.id ? ` (${region.id})` : ""}: ${region.text.trim()}`
    );
  const assetSections = parsed.assets
    .map((asset, index) => {
      const lines = [
        `### Asset ${index + 1}: ${asset.title || asset.id || asset.type}`,
        `- Type: ${asset.type}`,
        asset.caption ? `- Caption: ${asset.caption}` : "",
        asset.markdown ? `\n${asset.markdown.trim()}` : "",
        asset.latex ? `\nLaTeX: ${asset.latex.trim()}` : "",
        stringifyContextValue(asset.data) ? `\nData: ${stringifyContextValue(asset.data)}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .filter(Boolean);

  const contextSections = [
    metadataLines.length ? `## LiteParse Page Metadata\n\n${metadataLines.join("\n")}` : "",
    regionLines.length
      ? `## LiteParse Structured Regions\n\n${dedupeStrings(regionLines).join("\n")}`
      : "",
    assetSections.length ? `## LiteParse Structured Assets\n\n${assetSections.join("\n\n")}` : "",
  ].filter(Boolean);

  if (contextSections.length > 0) {
    sections.push(
      [
        "<!-- liteparse-codex-ocr-structured-context -->",
        ...contextSections,
        "<!-- /liteparse-codex-ocr-structured-context -->",
      ].join("\n\n")
    );
  }

  return `${sections.join("\n\n")}\n`;
}

function isDocumentContextRegion(type: string): boolean {
  return [
    "title",
    "heading",
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
  ].includes(type);
}

function stringifyContextValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveCodexOcrOptions(
  options: CommonCodexOcrOptions,
  defaultReasoningEffort: "medium" | "high"
): CodexOcrOptions {
  return {
    backend: coerceCodexOcrBackend(options.backend),
    codexHome: options.codexHome ?? process.env.LITEPARSE_CODEX_HOME ?? process.env.CODEX_HOME,
    codexPath: options.codexPath,
    includeRaw: options.includeRaw ?? false,
    language: options.language ?? "en",
    model: options.model ?? CODEX_OCR_DEFAULTS.model,
    reasoningEffort: options.reasoningEffort ?? defaultReasoningEffort,
    strictBbox: options.strictBbox ?? false,
    timeoutMs: parseInteger(options.timeoutMs, CODEX_OCR_DEFAULTS.timeoutMs),
    workingDirectory: process.cwd(),
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

function backendOption(): Option {
  return new Option("--backend <backend>", "Codex integration backend")
    .choices(["sdk", "app-server"])
    .default("sdk");
}

function reasoningEffortOption(defaultValue: "medium" | "high"): Option {
  return new Option("--reasoning-effort <effort>", "Codex model reasoning effort")
    .choices(["minimal", "low", "medium", "high", "xhigh"])
    .default(defaultValue);
}

function batchModeOption(): Option {
  return new Option("--batch-mode <mode>", "Page job scheduling mode")
    .choices(["worker-pool", "codex-subagents"])
    .default("worker-pool");
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

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "other";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function exitWithError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
