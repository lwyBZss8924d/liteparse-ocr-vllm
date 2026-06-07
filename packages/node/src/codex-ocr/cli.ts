import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Command, Option } from "commander";
import type { ModelReasoningEffort } from "@openai/codex-sdk";
import { CODEX_OCR_DEFAULTS, runCodexOcr } from "./codex.js";
import type { CodexOcrOptions } from "./types.js";
import { DEFAULT_CODEX_OCR_PORT, startCodexOcrServer } from "./server.js";

interface CommonCodexOcrOptions {
  codexHome?: string;
  codexPath?: string;
  includeRaw?: boolean;
  language?: string;
  model?: string;
  reasoningEffort?: ModelReasoningEffort;
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

export function registerCodexOcrCommands(program: Command): void {
  program
    .command("codex-ocr <image>")
    .description("Run OpenAI Codex SDK OCR for a single page image")
    .option("-o, --output <file>", "Write normalized Codex OCR artifact JSON to a file")
    .option("--raw-output <file>", "Write raw Codex SDK response JSON to a file")
    .addOption(reasoningEffortOption("medium"))
    .option("--codex-home <dir>", "Codex home directory; default is $LITEPARSE_CODEX_HOME, $CODEX_HOME, or $HOME/.codex")
    .option("--codex-path <path>", "Path to the codex CLI binary used by @openai/codex-sdk")
    .option("--model <model>", "Codex model", CODEX_OCR_DEFAULTS.model)
    .option("--language <lang>", "Language hint", "en")
    .option("--page-number <n>", "Page number metadata", "1")
    .option("--timeout-ms <n>", "Request timeout in milliseconds", String(CODEX_OCR_DEFAULTS.timeoutMs))
    .option("--json", "Print normalized artifact JSON to stdout")
    .option("--include-raw", "Include raw Codex response in saved/printed artifact")
    .option("--strict-bbox", "Drop OCR regions without usable bounding boxes")
    .action(async (image: string, options: CodexOcrCommandOptions) => {
      if (!existsSync(image)) exitWithError(`File not found: ${image}`);
      const artifact = await runCodexOcr(image, {
        ...resolveCodexOcrOptions(options),
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
    .description("Start a LiteParse-compatible /ocr server backed by OpenAI Codex SDK OCR")
    .option("--host <host>", "Server host", "127.0.0.1")
    .option("--port <port>", "Server port", String(DEFAULT_CODEX_OCR_PORT))
    .addOption(reasoningEffortOption("medium"))
    .option("--codex-home <dir>", "Codex home directory; default is $LITEPARSE_CODEX_HOME, $CODEX_HOME, or $HOME/.codex")
    .option("--codex-path <path>", "Path to the codex CLI binary used by @openai/codex-sdk")
    .option("--model <model>", "Codex model", CODEX_OCR_DEFAULTS.model)
    .option("--language <lang>", "Language hint", "en")
    .option("--concurrency <n>", "Maximum concurrent OCR requests", "1")
    .option("--max-image-bytes <n>", "Maximum uploaded image size", String(50 * 1024 * 1024))
    .option("--timeout-ms <n>", "Request timeout in milliseconds", String(CODEX_OCR_DEFAULTS.timeoutMs))
    .option("--include-raw", "Include raw Codex response in /ocr/analyze artifacts")
    .option("--strict-bbox", "Drop OCR regions without usable bounding boxes")
    .action((options: CodexOcrServerCommandOptions) => {
      const host = options.host ?? "127.0.0.1";
      const port = parseInteger(options.port, DEFAULT_CODEX_OCR_PORT);
      const server = startCodexOcrServer({
        ...resolveCodexOcrOptions(options),
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
}

function resolveCodexOcrOptions(options: CommonCodexOcrOptions): CodexOcrOptions {
  return {
    codexHome: options.codexHome ?? process.env.LITEPARSE_CODEX_HOME ?? process.env.CODEX_HOME,
    codexPath: options.codexPath,
    includeRaw: options.includeRaw ?? false,
    language: options.language ?? "en",
    model: options.model ?? CODEX_OCR_DEFAULTS.model,
    reasoningEffort: options.reasoningEffort ?? CODEX_OCR_DEFAULTS.reasoningEffort,
    strictBbox: options.strictBbox ?? false,
    timeoutMs: parseInteger(options.timeoutMs, CODEX_OCR_DEFAULTS.timeoutMs),
    workingDirectory: process.cwd(),
  };
}

function reasoningEffortOption(defaultValue: ModelReasoningEffort): Option {
  return new Option("--reasoning-effort <effort>", "Codex model reasoning effort")
    .choices(["minimal", "low", "medium", "high", "xhigh"])
    .default(defaultValue);
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
