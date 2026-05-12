import { ChildProcessByStdio, execFile, spawn } from "child_process";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { promisify } from "util";
import axios from "axios";
import {
  DEFAULT_GLM_OCR_MODEL,
  DEFAULT_LMSTUDIO_BASE_URL,
  ensureLmStudioModelLoaded,
} from "./lmstudio.js";
import {
  DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT,
  startLmStudioOpenAiAdapter,
} from "./lmstudio-openai-adapter.js";

export type GlmOcrModelRuntime = "lmstudio" | "openai-compatible" | "ollama" | "external";
export type LmStudioGlmOcrApiMode = "auto" | "openai" | "native-adapter";

export interface GlmOcrRuntimeOptions {
  autoLoadModel?: boolean;
  baseUrl?: string;
  debugArtifactsDir?: string;
  glmocrConfig?: string;
  glmocrHost?: string;
  glmocrLogLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  glmocrPort?: number;
  glmocrPython?: string;
  glmocrRoot?: string;
  glmocrServerUrl?: string;
  layoutBatchSize?: number;
  layoutDevice?: string;
  layoutModelDir?: string;
  lmstudioAdapterHost?: string;
  lmstudioAdapterPort?: number;
  lmstudioApiMode?: LmStudioGlmOcrApiMode;
  maxWorkers?: number;
  model?: string;
  modelRuntime?: GlmOcrModelRuntime;
  ocrApiUrl?: string;
  spawnGlmocrServer?: boolean;
  timeoutMs?: number;
}

export interface GlmOcrRuntimeConfigPlan {
  apiMode: "openai" | "ollama_generate";
  configPath?: string;
  generatedConfigYaml: string;
  glmocrRoot?: string;
  layoutModelDir: string;
  model: string;
  ocrApiUrl: string;
  python: string;
  serverUrl: string;
}

export interface ManagedGlmOcrRuntime {
  close(): Promise<void>;
  configPath?: string;
  glmocrRoot?: string;
  modelRuntime: GlmOcrModelRuntime;
  ocrApiUrl?: string;
  serverUrl: string;
  spawned: boolean;
  warnings: string[];
}

const execFileAsync = promisify(execFile);
type GlmOcrChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export class GlmOcrRuntimeManager {
  private options: GlmOcrRuntimeOptions;
  private runtime?: ManagedGlmOcrRuntime;
  private runtimePromise?: Promise<ManagedGlmOcrRuntime>;

  constructor(options: GlmOcrRuntimeOptions = {}) {
    this.options = options;
  }

  async getRuntime(): Promise<ManagedGlmOcrRuntime> {
    if (this.runtime) return this.runtime;
    if (!this.runtimePromise) {
      this.runtimePromise = startManagedGlmOcrRuntime(this.options).then((runtime) => {
        this.runtime = runtime;
        return runtime;
      });
    }
    return this.runtimePromise;
  }

  async getServerUrl(): Promise<string> {
    return (await this.getRuntime()).serverUrl;
  }

  async close(): Promise<void> {
    const runtime =
      this.runtime ??
      (this.runtimePromise ? await this.runtimePromise.catch(() => undefined) : undefined);
    if (runtime) await runtime.close();
  }
}

export async function startManagedGlmOcrRuntime(
  options: GlmOcrRuntimeOptions = {}
): Promise<ManagedGlmOcrRuntime> {
  if (options.glmocrServerUrl && options.spawnGlmocrServer !== true) {
    return {
      close: async () => undefined,
      modelRuntime: options.modelRuntime ?? "external",
      serverUrl: normalizeBaseUrl(options.glmocrServerUrl),
      spawned: false,
      warnings: [],
    };
  }

  const resolvedModelRuntime = options.modelRuntime ?? "lmstudio";
  const warnings: string[] = [];
  const modelEndpoint = await resolveModelEndpoint(options, warnings);
  const plan = buildGlmOcrRuntimeConfigPlan({
    ...options,
    modelRuntime: resolvedModelRuntime,
    ocrApiUrl: modelEndpoint.ocrApiUrl,
  });

  await assertGlmOcrImportable(plan.python, plan.glmocrRoot);

  let tempDir: string | undefined;
  let configPath = options.glmocrConfig;
  if (!configPath) {
    tempDir = options.debugArtifactsDir
      ? path.join(options.debugArtifactsDir, "runtime")
      : await fs.mkdtemp(path.join(os.tmpdir(), "liteparse-glmocr-"));
    await fs.mkdir(tempDir, { recursive: true });
    configPath = path.join(tempDir, "glmocr.runtime.yaml");
    await fs.writeFile(configPath, plan.generatedConfigYaml, "utf-8");
  }

  const child = spawnGlmOcrServer({
    configPath,
    env: buildPythonEnv(plan.glmocrRoot),
    logLevel: options.glmocrLogLevel ?? "INFO",
    python: plan.python,
    root: plan.glmocrRoot,
  });
  const logTail: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => pushTail(logTail, chunk.toString("utf-8")));
  child.stderr.on("data", (chunk: Buffer) => pushTail(logTail, chunk.toString("utf-8")));

  try {
    await waitForHttpHealth(
      `${plan.serverUrl}/health`,
      options.timeoutMs ?? 120_000,
      child,
      logTail
    );
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  return {
    close: async () => {
      modelEndpoint.close();
      if (!child.killed) child.kill("SIGTERM");
      if (tempDir && !options.debugArtifactsDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
    configPath,
    glmocrRoot: plan.glmocrRoot,
    modelRuntime: resolvedModelRuntime,
    ocrApiUrl: modelEndpoint.ocrApiUrl,
    serverUrl: plan.serverUrl,
    spawned: true,
    warnings,
  };
}

export function buildGlmOcrRuntimeConfigPlan(
  options: GlmOcrRuntimeOptions = {}
): GlmOcrRuntimeConfigPlan {
  const host = options.glmocrHost ?? "127.0.0.1";
  const port = options.glmocrPort ?? 5002;
  const model = options.model ?? process.env.LITEPARSE_GLM_OCR_MODEL ?? DEFAULT_GLM_OCR_MODEL;
  const ocrApiUrl =
    options.ocrApiUrl ??
    `${normalizeBaseUrl(options.baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL)}/v1/chat/completions`;
  const modelRuntime = options.modelRuntime ?? "lmstudio";
  const apiMode = modelRuntime === "ollama" ? "ollama_generate" : "openai";
  const python = options.glmocrPython ?? process.env.LITEPARSE_GLMOCR_PYTHON ?? "python3";
  const glmocrRoot = resolveGlmOcrRoot(options.glmocrRoot);
  const layoutModelDir =
    options.layoutModelDir ??
    process.env.LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR ??
    "PaddlePaddle/PP-DocLayoutV3_safetensors";
  const generatedConfigYaml = buildGlmOcrRuntimeConfigYaml({
    apiMode,
    host,
    layoutBatchSize: options.layoutBatchSize ?? 1,
    layoutDevice: options.layoutDevice,
    layoutModelDir,
    maxWorkers: options.maxWorkers ?? 1,
    model,
    ocrApiUrl,
    port,
    timeoutSeconds: Math.ceil((options.timeoutMs ?? 120_000) / 1000),
  });

  return {
    apiMode,
    generatedConfigYaml,
    glmocrRoot,
    layoutModelDir,
    model,
    ocrApiUrl,
    python,
    serverUrl: `http://${host}:${port}`,
  };
}

export function buildGlmOcrRuntimeConfigYaml(input: {
  apiMode: "openai" | "ollama_generate";
  host: string;
  layoutBatchSize: number;
  layoutDevice?: string;
  layoutModelDir: string;
  maxWorkers: number;
  model: string;
  ocrApiUrl: string;
  port: number;
  timeoutSeconds: number;
}): string {
  const layoutDeviceLine = input.layoutDevice
    ? `    device: ${yamlString(input.layoutDevice)}\n`
    : "";
  return [
    "server:",
    `  host: ${yamlString(input.host)}`,
    `  port: ${input.port}`,
    "  debug: false",
    "logging:",
    "  level: INFO",
    "pipeline:",
    "  maas:",
    "    enabled: false",
    "  ocr_api:",
    `    api_url: ${yamlString(input.ocrApiUrl)}`,
    `    api_mode: ${yamlString(input.apiMode)}`,
    `    model: ${yamlString(input.model)}`,
    "    api_key: null",
    "    verify_ssl: false",
    "    connect_timeout: 30",
    `    request_timeout: ${input.timeoutSeconds}`,
    "    retry_max_attempts: 2",
    "    retry_backoff_base_seconds: 0.5",
    "    retry_backoff_max_seconds: 8.0",
    "    retry_jitter_ratio: 0.2",
    "    retry_status_codes: [429, 500, 502, 503, 504]",
    "    connection_pool_size: 128",
    `  max_workers: ${input.maxWorkers}`,
    "  page_maxsize: 100",
    "  region_maxsize: 2000",
    "  page_loader:",
    "    max_tokens: 8192",
    "    temperature: 0.0",
    "    top_p: 0.00001",
    "    top_k: 1",
    "    repetition_penalty: 1.1",
    "    t_patch_size: 2",
    "    patch_expand_factor: 1",
    "    image_expect_length: 6144",
    "    image_format: JPEG",
    "    min_pixels: 12544",
    "    max_pixels: 71372800",
    "    task_prompt_mapping:",
    '      text: "Text Recognition:"',
    '      table: "Table Recognition:"',
    '      formula: "Formula Recognition:"',
    "    pdf_dpi: 200",
    "    pdf_max_pages: null",
    "    pdf_verbose: false",
    "  result_formatter:",
    "    output_format: both",
    "    enable_merge_formula_numbers: true",
    "    enable_merge_text_blocks: true",
    "    enable_format_bullet_points: true",
    "  layout:",
    `    model_dir: ${yamlString(input.layoutModelDir)}`,
    "    threshold: 0.3",
    `    batch_size: ${input.layoutBatchSize}`,
    "    workers: 1",
    layoutDeviceLine.trimEnd(),
    "    use_polygon: false",
    "    layout_nms: true",
    "    layout_unclip_ratio: [1.0, 1.0]",
    "    label_task_mapping:",
    "      text: [abstract, algorithm, content, doc_title, figure_title, paragraph_title, reference_content, text, vertical_text, vision_footnote, seal, formula_number]",
    "      table: [table]",
    "      formula: [display_formula, inline_formula]",
    "      skip: [chart, image]",
    "      abandon: [header, footer, number, footnote, aside_text, reference, footer_image, header_image]",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function resolveModelEndpoint(
  options: GlmOcrRuntimeOptions,
  warnings: string[]
): Promise<{ close(): void; ocrApiUrl: string }> {
  const modelRuntime = options.modelRuntime ?? "lmstudio";
  const model = options.model ?? process.env.LITEPARSE_GLM_OCR_MODEL ?? DEFAULT_GLM_OCR_MODEL;
  if (modelRuntime !== "lmstudio") {
    if (!options.ocrApiUrl)
      throw new Error(`--ocr-api-url is required for model runtime: ${modelRuntime}`);
    return { close: () => undefined, ocrApiUrl: options.ocrApiUrl };
  }

  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? process.env.LITEPARSE_LMSTUDIO_BASE_URL ?? DEFAULT_LMSTUDIO_BASE_URL
  );
  const autoLoadModel = options.autoLoadModel ?? true;
  if (autoLoadModel) {
    const loadResult = await ensureLmStudioModelLoaded({
      baseUrl,
      model,
      timeoutMs: options.timeoutMs,
    });
    if (!loadResult.ok) throw new Error(loadResult.error ?? "failed to auto-load LM Studio model");
  }

  const mode = options.lmstudioApiMode ?? "auto";
  const openAiUrl = `${baseUrl}/v1/chat/completions`;
  if (mode === "openai") {
    return { close: () => undefined, ocrApiUrl: openAiUrl };
  }
  if (
    mode === "auto" &&
    (await probeOpenAiCompatibleEndpoint(openAiUrl, model, options.timeoutMs ?? 10_000))
  ) {
    return { close: () => undefined, ocrApiUrl: openAiUrl };
  }

  if (mode === "auto") warnings.push("lmstudio_openai_probe_failed_using_native_adapter");
  const adapterHost = options.lmstudioAdapterHost ?? "127.0.0.1";
  const adapterPort = options.lmstudioAdapterPort ?? DEFAULT_LMSTUDIO_OPENAI_ADAPTER_PORT;
  const adapter = startLmStudioOpenAiAdapter({
    autoLoadModel,
    baseUrl,
    host: adapterHost,
    model,
    port: adapterPort,
    timeoutMs: options.timeoutMs,
  });
  return {
    close: () => adapter.close(),
    ocrApiUrl: `http://${adapterHost}:${adapterPort}/v1/chat/completions`,
  };
}

async function probeOpenAiCompatibleEndpoint(
  url: string,
  model: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const response = await axios.post(
      url,
      {
        model,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        max_tokens: 1,
        temperature: 0,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: timeoutMs,
        validateStatus: () => true,
      }
    );
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

async function assertGlmOcrImportable(python: string, glmocrRoot?: string): Promise<void> {
  try {
    await execFileAsync(
      python,
      ["-c", "import glmocr; print(getattr(glmocr, '__version__', 'unknown'))"],
      {
        env: buildPythonEnv(glmocrRoot),
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      }
    );
  } catch (error) {
    throw new Error(
      `GLM-OCR SDK is not importable by ${python}. Install glmocr or pass --glmocr-root. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

function spawnGlmOcrServer(input: {
  configPath: string;
  env: NodeJS.ProcessEnv;
  logLevel: string;
  python: string;
  root?: string;
}): GlmOcrChildProcess {
  return spawn(
    input.python,
    ["-m", "glmocr.server", "--config", input.configPath, "--log-level", input.logLevel],
    {
      cwd: input.root ?? process.cwd(),
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

async function waitForHttpHealth(
  url: string,
  timeoutMs: number,
  child: GlmOcrChildProcess,
  logTail: string[]
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `GLM-OCR SDK server exited with code ${child.exitCode}. ${logTail.join("\n").slice(-2000)}`
      );
    }
    try {
      const response = await axios.get(url, { timeout: 2_000, validateStatus: () => true });
      if (response.status >= 200 && response.status < 300) return;
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Timed out waiting for GLM-OCR SDK server at ${url}. ${logTail.join("\n").slice(-2000)}`
  );
}

function resolveGlmOcrRoot(inputRoot?: string): string | undefined {
  const candidates = [inputRoot, process.env.LITEPARSE_GLMOCR_ROOT, "/opt/glm-ocr-sdk"].filter(
    (value): value is string => Boolean(value)
  );
  return candidates.find((candidate) => existsSync(path.join(candidate, "glmocr", "__init__.py")));
}

function buildPythonEnv(glmocrRoot?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (glmocrRoot) {
    env.PYTHONPATH = env.PYTHONPATH
      ? `${glmocrRoot}${path.delimiter}${env.PYTHONPATH}`
      : glmocrRoot;
  }
  return env;
}

function pushTail(logTail: string[], text: string): void {
  logTail.push(text);
  while (logTail.join("").length > 4000 && logTail.length > 1) {
    logTail.shift();
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
