// Native binary loader for custom source builds. Prefer the package-local binary
// produced by `napi build` so this fork never silently loads upstream optional
// native packages.

import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

interface NativeBindings {
  LiteParse: new (config?: LiteParseNativeConfig) => LiteParseNative;
  searchItems(
    items: NativeTextItem[],
    phrase: string,
    caseSensitive?: boolean | null,
  ): NativeTextItem[];
}

export interface LiteParseNativeConfig {
  ocrLanguage?: string;
  ocrEnabled?: boolean;
  ocrServerUrl?: string;
  ocrTimeoutMs?: number;
  tessdataPath?: string;
  maxPages?: number;
  targetPages?: string;
  dpi?: number;
  outputFormat?: string;
  preserveVerySmallText?: boolean;
  password?: string;
  quiet?: boolean;
  numWorkers?: number;
}

export interface NativeTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
  confidence?: number;
}

export interface NativeParsedPage {
  pageNum: number;
  width: number;
  height: number;
  text: string;
  textItems: NativeTextItem[];
}

export interface NativeParseResult {
  pages: NativeParsedPage[];
  text: string;
}

export interface NativeScreenshotResult {
  pageNum: number;
  width: number;
  height: number;
  imageBuffer: Buffer;
}

export interface LiteParseNative {
  parse(input: string | Buffer): Promise<NativeParseResult>;
  screenshot(
    input: string | Buffer,
    pageNumbers?: number[] | null,
  ): Promise<NativeScreenshotResult[]>;
  format(result: NativeParseResult): string;
  readonly config: LiteParseNativeConfig;
}

function loadNative(): NativeBindings {
  const platform = process.platform;
  const arch = process.arch;
  const candidates: string[] = [];
  if (platform === "linux") {
    candidates.push(`${platform}-${arch}-gnu`);
    candidates.push(`${platform}-${arch}-musl`);
  } else if (platform === "win32") {
    candidates.push(`${platform}-${arch}-msvc`);
  } else {
    candidates.push(`${platform}-${arch}`);
  }

  // Try several paths since __dirname may be dist/ or dist/src/
  const searchDirs = [__dirname, join(__dirname, ".."), join(__dirname, "..", "..")];
  const fileNames = [
    ...candidates.map((c) => `liteparse.${c}.node`),
    `liteparse.${platform}-${arch}.node`,
    "liteparse.node",
  ];
  for (const dir of searchDirs) {
    for (const fileName of fileNames) {
      try {
        return require(join(dir, fileName));
      } catch {
        // try next
      }
    }
  }

  throw new Error(
    `Failed to load native module for ${platform}-${arch}. ` +
      `Run npm run build:rs in packages/node to produce the package-local .node file.`,
  );
}

export const native = loadNative();
