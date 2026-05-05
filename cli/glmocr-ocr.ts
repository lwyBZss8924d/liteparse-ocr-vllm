import { Command, Option } from "commander";
import fs from "fs/promises";
import { existsSync, readdirSync, statSync } from "fs";
import os from "os";
import path from "path";
import { LiteParse } from "../src/core/parser.js";
import {
  DEFAULT_GLMOCR_OCR_PORT,
  GlmOcrOcrServerOptions,
  runGlmOcrPipelineOcr,
  startGlmOcrOcrServer,
} from "../src/engines/ocr/glmocr-server.js";
import {
  GlmOcrModelRuntime,
  GlmOcrRuntimeManager,
  LmStudioGlmOcrApiMode,
} from "../src/engines/ocr/glmocr-runtime.js";
import {
  DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT,
  startLmStudioOpenAiAdapter,
} from "../src/engines/ocr/lmstudio-openai-adapter.js";
import { DEFAULT_GLM_OCR_MODEL, DEFAULT_LMSTUDIO_BASE_URL } from "../src/engines/ocr/lmstudio.js";

interface CommonGlmOcrOptions {
  autoLoad?: boolean;
  baseUrl?: string;
  debugArtifacts?: string;
  glmocrConfig?: string;
  glmocrHost?: string;
  glmocrLogLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  glmocrPort?: string;
  glmocrPython?: string;
  glmocrRoot?: string;
  glmocrServerUrl?: string;
  layoutBatchSize?: string;
  layoutDevice?: string;
  layoutModelDir?: string;
  lmstudioAdapterHost?: string;
  lmstudioAdapterPort?: string;
  lmstudioApiMode?: LmStudioGlmOcrApiMode;
  maxWorkers?: string;
  model?: string;
  modelRuntime?: GlmOcrModelRuntime;
  noAutoLoad?: boolean;
  ocrApiUrl?: string;
  spawnGlmocrServer?: boolean;
  strictBbox?: boolean;
  timeoutMs?: string;
}

interface GlmOcrServerCommandOptions extends CommonGlmOcrOptions {
  concurrency?: string;
  host?: string;
  maxImageBytes?: string;
  port?: string;
}

interface GlmOcrPipelineCommandOptions extends CommonGlmOcrOptions {
  concurrency?: string;
  dpi?: string;
  json?: boolean;
  noSave?: boolean;
  output?: string;
  path?: string;
  quiet?: boolean;
  targetPages?: string;
}

interface LmStudioAdapterCommandOptions {
  baseUrl?: string;
  contextLength?: string;
  host?: string;
  maxBodyBytes?: string;
  model?: string;
  noAutoLoad?: boolean;
  port?: string;
  timeoutMs?: string;
}

interface PipelinePageArtifact {
  artifactPath?: string;
  bboxBackedRegionCount: number;
  liteparseOcrPath?: string;
  markdown: string;
  page: number;
  pageImagePath?: string;
  regionCount: number;
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

export function registerGlmOcrCommands(program: Command): void {
  program
    .command("glmocr-ocr-server")
    .description("Start a LiteParse-compatible /ocr server backed by the GLM-OCR SDK pipeline")
    .option("--host <host>", "Server host", "127.0.0.1")
    .option("--port <port>", "Server port", String(DEFAULT_GLMOCR_OCR_PORT))
    .option("--concurrency <n>", "Maximum concurrent LiteParse OCR requests", "1")
    .option("--max-image-bytes <n>", "Maximum uploaded image size", String(25 * 1024 * 1024))
    .addOption(modelRuntimeOption())
    .addOption(lmstudioApiModeOption())
    .addOption(glmocrLogLevelOption())
    .option("--base-url <url>", "LM Studio base URL", DEFAULT_LMSTUDIO_BASE_URL)
    .option("--model <model>", "GLM-OCR model identifier", DEFAULT_GLM_OCR_MODEL)
    .option("--no-auto-load", "Do not run lms load automatically for LM Studio runtimes")
    .option("--ocr-api-url <url>", "OpenAI-compatible/Ollama OCR model API URL")
    .option("--glmocr-server-url <url>", "Use an existing GLM-OCR SDK server")
    .option(
      "--spawn-glmocr-server",
      "Spawn python -m glmocr.server even when --glmocr-server-url is set"
    )
    .option("--glmocr-python <path>", "Python executable", "python3")
    .option("--glmocr-root <path>", "GLM-OCR source checkout root")
    .option("--glmocr-config <file>", "Use an existing GLM-OCR YAML config")
    .option("--glmocr-host <host>", "Spawned GLM-OCR SDK server host", "127.0.0.1")
    .option("--glmocr-port <port>", "Spawned GLM-OCR SDK server port", "5002")
    .option("--layout-device <device>", 'Layout model device: "cpu", "cuda", or "cuda:N"', "cpu")
    .option("--layout-model-dir <path>", "PP-DocLayout model directory or Hub identifier")
    .option("--layout-batch-size <n>", "PPDocLayout batch size", "1")
    .option("--glmocr-max-workers <n>", "GLM-OCR region recognition workers", "1")
    .option("--lmstudio-adapter-host <host>", "OpenAI adapter host", "127.0.0.1")
    .option(
      "--lmstudio-adapter-port <port>",
      "OpenAI adapter port",
      String(DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT)
    )
    .option("--timeout-ms <n>", "Runtime/request timeout in milliseconds", "300000")
    .option("--strict-bbox", "Drop regions without official GLM-OCR/PPDocLayout bbox", true)
    .option("--debug-artifacts <dir>", "Persist generated runtime config and debug artifacts")
    .action(async (options: GlmOcrServerCommandOptions) => {
      const resolved = resolveGlmOcrOptions(options);
      const host = options.host ?? "127.0.0.1";
      const port = parseInteger(options.port, DEFAULT_GLMOCR_OCR_PORT);
      const server = startGlmOcrOcrServer({
        ...resolved,
        concurrency: parseInteger(options.concurrency, 1),
        host,
        maxImageBytes: parseInteger(options.maxImageBytes, 25 * 1024 * 1024),
        port,
      });
      const url = `http://${host}:${port}/ocr`;
      console.error(`LiteParse GLM-OCR SDK OCR server listening at ${url}`);
      console.error(`Use: lit parse document.pdf --ocr-server-url ${url} --format json`);
      server.on("error", (error) => {
        exitWithError(error.message);
      });
    });

  program
    .command("glmocr-pipeline")
    .description("Render documents/images and run the official GLM-OCR SDK layout OCR pipeline")
    .requiredOption("-p, --path <path>", "Input file or directory")
    .requiredOption("-o, --output <dir>", "Output artifact directory")
    .addOption(modelRuntimeOption())
    .addOption(lmstudioApiModeOption())
    .addOption(glmocrLogLevelOption())
    .option("--base-url <url>", "LM Studio base URL", DEFAULT_LMSTUDIO_BASE_URL)
    .option("--model <model>", "GLM-OCR model identifier", DEFAULT_GLM_OCR_MODEL)
    .option("--no-auto-load", "Do not run lms load automatically for LM Studio runtimes")
    .option("--ocr-api-url <url>", "OpenAI-compatible/Ollama OCR model API URL")
    .option("--glmocr-server-url <url>", "Use an existing GLM-OCR SDK server")
    .option(
      "--spawn-glmocr-server",
      "Spawn python -m glmocr.server even when --glmocr-server-url is set"
    )
    .option("--glmocr-python <path>", "Python executable", "python3")
    .option("--glmocr-root <path>", "GLM-OCR source checkout root")
    .option("--glmocr-config <file>", "Use an existing GLM-OCR YAML config")
    .option("--glmocr-host <host>", "Spawned GLM-OCR SDK server host", "127.0.0.1")
    .option("--glmocr-port <port>", "Spawned GLM-OCR SDK server port", "5002")
    .option("--layout-device <device>", 'Layout model device: "cpu", "cuda", or "cuda:N"', "cpu")
    .option("--layout-model-dir <path>", "PP-DocLayout model directory or Hub identifier")
    .option("--layout-batch-size <n>", "PPDocLayout batch size", "1")
    .option("--glmocr-max-workers <n>", "GLM-OCR region recognition workers", "1")
    .option("--lmstudio-adapter-host <host>", "OpenAI adapter host", "127.0.0.1")
    .option(
      "--lmstudio-adapter-port <port>",
      "OpenAI adapter port",
      String(DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT)
    )
    .option("--target-pages <pages>", 'Target pages for document rendering, e.g. "1-5,10"')
    .option("--dpi <dpi>", "DPI for rendered pages", "200")
    .option("--concurrency <n>", "Maximum concurrent files", "1")
    .option("--json", "Print summary JSON to stdout")
    .option("--no-save", "Do not save artifacts to the output directory")
    .option("--strict-bbox", "Drop regions without official GLM-OCR/PPDocLayout bbox", true)
    .option("--timeout-ms <n>", "Runtime/request timeout in milliseconds", "300000")
    .option("--debug-artifacts <dir>", "Persist generated runtime config and debug artifacts")
    .option("-q, --quiet", "Suppress progress output")
    .action(async (options: GlmOcrPipelineCommandOptions) => {
      await runPipelineCommand(options);
    });

  program
    .command("lmstudio-openai-adapter")
    .description(
      "Expose LM Studio native /api/v1/chat as an OpenAI-compatible chat completions endpoint"
    )
    .option("--host <host>", "Adapter host", "127.0.0.1")
    .option("--port <port>", "Adapter port", String(DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT))
    .option("--base-url <url>", "LM Studio base URL", DEFAULT_LMSTUDIO_BASE_URL)
    .option("--model <model>", "LM Studio model identifier", DEFAULT_GLM_OCR_MODEL)
    .option("--no-auto-load", "Do not run lms load automatically")
    .option("--context-length <n>", "LM Studio context length", "16384")
    .option("--max-body-bytes <n>", "Maximum request JSON body size", String(25 * 1024 * 1024))
    .option("--timeout-ms <n>", "Request timeout in milliseconds", "120000")
    .action((options: LmStudioAdapterCommandOptions) => {
      const host = options.host ?? "127.0.0.1";
      const port = parseInteger(options.port, DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT);
      const server = startLmStudioOpenAiAdapter({
        autoLoadModel: !options.noAutoLoad,
        baseUrl: options.baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL,
        contextLength: parseInteger(options.contextLength, 16_384),
        host,
        maxBodyBytes: parseInteger(options.maxBodyBytes, 25 * 1024 * 1024),
        model: options.model ?? DEFAULT_GLM_OCR_MODEL,
        port,
        timeoutMs: parseInteger(options.timeoutMs, 120_000),
      });
      console.error(
        `LiteParse LM Studio OpenAI adapter listening at http://${host}:${port}/v1/chat/completions`
      );
      server.on("error", (error) => {
        exitWithError(error.message);
      });
    });
}

async function runPipelineCommand(options: GlmOcrPipelineCommandOptions): Promise<void> {
  const inputPath = options.path;
  if (!inputPath || !existsSync(inputPath))
    exitWithError(`Input path not found: ${inputPath ?? ""}`);
  const save = options.noSave !== true;
  const outputDir = options.output;
  if (!outputDir) exitWithError("Missing required output directory");
  if (save) await fs.mkdir(outputDir, { recursive: true });

  const files = collectPipelineInputs(inputPath);
  if (files.length === 0) exitWithError("No supported input files found");

  const ocrOptions = resolveGlmOcrOptions(options);
  const runtimeManager = new GlmOcrRuntimeManager(ocrOptions);
  const targetPages = options.targetPages ? parsePageNumbers(options.targetPages) : undefined;
  const dpi = parseInteger(options.dpi, 200);
  const concurrency = parseInteger(options.concurrency, 1);
  const tempRoot = save ? undefined : await fs.mkdtemp(path.join(os.tmpdir(), "liteparse-glmocr-"));
  const summaries: unknown[] = [];

  try {
    await runWithConcurrency(files, concurrency, async (file) => {
      if (!options.quiet) console.error(`Processing ${file}`);
      const summary = await processPipelineFile({
        dpi,
        file,
        inputRoot: statSync(inputPath).isDirectory() ? inputPath : undefined,
        ocrOptions,
        outputRoot: outputDir,
        runtimeManager,
        save,
        targetPages,
        tempRoot,
      });
      summaries.push(summary);
    });
  } finally {
    await runtimeManager.close();
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
  dpi: number;
  file: string;
  inputRoot?: string;
  ocrOptions: GlmOcrOcrServerOptions;
  outputRoot: string;
  runtimeManager: GlmOcrRuntimeManager;
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
  const glmocrDir = path.join(fileOutputRoot, "glmocr");
  const liteparseDir = path.join(fileOutputRoot, "liteparse");
  const finalDir = path.join(fileOutputRoot, "final");
  if (input.save) {
    await Promise.all(
      [pagesDir, glmocrDir, liteparseDir, finalDir].map((dir) => fs.mkdir(dir, { recursive: true }))
    );
  } else {
    await fs.mkdir(pagesDir, { recursive: true });
  }

  const pageImages = IMAGE_EXTENSIONS.has(ext)
    ? [{ page: 1, buffer: await fs.readFile(input.file), sourcePath: input.file }]
    : await renderDocumentPages(input.file, pagesDir, input.targetPages, input.dpi, input.save);

  const pageArtifacts: PipelinePageArtifact[] = [];
  for (const pageImage of pageImages) {
    const pageImagePath = path.join(
      pagesDir,
      `page_${String(pageImage.page).padStart(3, "0")}.png`
    );
    if (!input.save || !existsSync(pageImagePath))
      await fs.writeFile(pageImagePath, pageImage.buffer);

    const artifact = await runGlmOcrPipelineOcr(pageImage.buffer, {
      ...input.ocrOptions,
      runtimeManager: input.runtimeManager,
    });
    const artifactPath = input.save
      ? path.join(glmocrDir, `page_${String(pageImage.page).padStart(3, "0")}.glmocr.json`)
      : undefined;
    const liteparseOcrPath = input.save
      ? path.join(liteparseDir, `page_${String(pageImage.page).padStart(3, "0")}.ocr-results.json`)
      : undefined;
    if (artifactPath) await writeJsonFile(artifactPath, artifact);
    if (liteparseOcrPath) {
      await writeJsonFile(liteparseOcrPath, {
        results: artifact.conversion.results,
        warnings: artifact.warnings,
        region_count: artifact.conversion.region_count,
        bbox_backed_region_count: artifact.conversion.bbox_backed_region_count,
      });
    }
    pageArtifacts.push({
      artifactPath,
      bboxBackedRegionCount: artifact.conversion.bbox_backed_region_count,
      liteparseOcrPath,
      markdown: artifact.conversion.markdown,
      page: pageImage.page,
      pageImagePath: input.save ? pageImagePath : undefined,
      regionCount: artifact.conversion.region_count,
      warnings: artifact.warnings,
    });
  }

  const documentMarkdown = pageArtifacts
    .map((page) => page.markdown)
    .filter(Boolean)
    .join("\n\n---\n\n");
  const documentJson = {
    source_path: path.resolve(input.file),
    model: input.ocrOptions.model ?? DEFAULT_GLM_OCR_MODEL,
    pages: pageArtifacts,
  };
  if (input.save) {
    await fs.writeFile(path.join(finalDir, "document.md"), documentMarkdown, "utf-8");
    await writeJsonFile(path.join(finalDir, "document.json"), documentJson);
    await writeJsonFile(path.join(fileOutputRoot, "manifest.json"), {
      source_path: path.resolve(input.file),
      output_root: path.resolve(fileOutputRoot),
      page_count: pageArtifacts.length,
      generated_by: "lit glmocr-pipeline",
    });
  }
  return {
    ok: true,
    source_path: path.resolve(input.file),
    output_root: input.save ? path.resolve(fileOutputRoot) : undefined,
    page_count: pageArtifacts.length,
    region_count: pageArtifacts.reduce((sum, page) => sum + page.regionCount, 0),
    bbox_backed_region_count: pageArtifacts.reduce(
      (sum, page) => sum + page.bboxBackedRegionCount,
      0
    ),
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

function resolveGlmOcrOptions(options: CommonGlmOcrOptions): GlmOcrOcrServerOptions {
  return {
    autoLoadModel: !options.noAutoLoad,
    baseUrl: options.baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL,
    debugArtifactsDir: options.debugArtifacts,
    glmocrConfig: options.glmocrConfig,
    glmocrHost: options.glmocrHost ?? "127.0.0.1",
    glmocrLogLevel: options.glmocrLogLevel ?? "INFO",
    glmocrPort: parseInteger(options.glmocrPort, 5002),
    glmocrPython: options.glmocrPython ?? "python3",
    glmocrRoot: options.glmocrRoot,
    glmocrServerUrl: options.glmocrServerUrl,
    layoutBatchSize: parseInteger(options.layoutBatchSize, 1),
    layoutDevice: options.layoutDevice ?? "cpu",
    layoutModelDir: options.layoutModelDir,
    lmstudioAdapterHost: options.lmstudioAdapterHost ?? "127.0.0.1",
    lmstudioAdapterPort: parseInteger(
      options.lmstudioAdapterPort,
      DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT
    ),
    lmstudioApiMode: options.lmstudioApiMode ?? "auto",
    maxWorkers: parseInteger(options.maxWorkers, 1),
    model: options.model ?? DEFAULT_GLM_OCR_MODEL,
    modelRuntime: options.modelRuntime ?? "lmstudio",
    ocrApiUrl: options.ocrApiUrl,
    spawnGlmocrServer: options.spawnGlmocrServer,
    strictBbox: options.strictBbox ?? true,
    timeoutMs: parseInteger(options.timeoutMs, 300_000),
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

function modelRuntimeOption(): Option {
  return new Option("--model-runtime <runtime>", "Model runtime")
    .choices(["lmstudio", "openai-compatible", "ollama", "external"])
    .default("lmstudio");
}

function lmstudioApiModeOption(): Option {
  return new Option("--lmstudio-api-mode <mode>", "LM Studio API mode for GLM-OCR SDK")
    .choices(["auto", "openai", "native-adapter"])
    .default("auto");
}

function glmocrLogLevelOption(): Option {
  return new Option("--glmocr-log-level <level>", "GLM-OCR SDK log level")
    .choices(["DEBUG", "INFO", "WARNING", "ERROR"])
    .default("INFO");
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

function exitWithError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
