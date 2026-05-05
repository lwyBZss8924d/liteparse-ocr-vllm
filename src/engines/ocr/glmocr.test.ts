import http from "http";
import axios from "axios";
import FormData from "form-data";
import { afterEach, describe, expect, it } from "vitest";
import { buildGlmOcrRuntimeConfigPlan, buildGlmOcrRuntimeConfigYaml } from "./glmocr-runtime";
import { convertGlmOcrResponseToOcrResults, prepareGlmOcrImageInput } from "./glmocr";
import { createGlmOcrOcrServer, runGlmOcrPipelineOcr } from "./glmocr-server";
import {
  createLmStudioOpenAiAdapter,
  openAiChatPayloadToLmStudioNative,
} from "./lmstudio-openai-adapter";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("GLM-OCR SDK response conversion", () => {
  it("converts official normalized bbox_2d into LiteParse pixel OCR results", () => {
    const converted = convertGlmOcrResponseToOcrResults(
      {
        json_result: [
          [
            {
              index: 0,
              label: "text",
              content: "Hello",
              bbox_2d: [100, 200, 900, 400],
            },
          ],
        ],
        markdown_result: "Hello",
      },
      { width: 1000, height: 2000 }
    );

    expect(converted.results).toStrictEqual([
      {
        text: "Hello",
        bbox: [100, 400, 900, 800],
        confidence: 1,
      },
    ]);
    expect(converted.warnings).toStrictEqual([]);
    expect(converted.region_count).toBe(1);
    expect(converted.bbox_backed_region_count).toBe(1);
  });

  it("does not synthesize fallback line bboxes in GLM-OCR pipeline mode", () => {
    const converted = convertGlmOcrResponseToOcrResults(
      {
        json_result: [[{ index: 0, label: "text", content: "Hello" }]],
        markdown_result: "Hello",
      },
      { width: 1000, height: 2000 }
    );

    expect(converted.results).toStrictEqual([]);
    expect(converted.warnings).toContain("region_bbox_missing");
    expect(converted.warnings).toContain("degraded_no_layout_bbox");
    expect(converted.warnings).not.toContain("fallback_line_bboxes");
  });

  it("uses layout_details when json_result is absent", () => {
    const converted = convertGlmOcrResponseToOcrResults(
      {
        layout_details: [[{ content: "From layout", bbox_2d: [0, 0, 1000, 1000] }]],
      },
      { width: 10, height: 20 }
    );

    expect(converted.results[0]).toStrictEqual({
      text: "From layout",
      bbox: [0, 0, 10, 20],
      confidence: 1,
    });
  });

  it("prepares image data URLs with dimensions and hashes", async () => {
    const image = await prepareGlmOcrImageInput(png1x1);

    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(image.mimeType).toBe("image/png");
    expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(image.sha256).toHaveLength(64);
  });
});

describe("GLM-OCR runtime config", () => {
  it("generates self-hosted config that points OCRClient at a model runtime URL", () => {
    const yaml = buildGlmOcrRuntimeConfigYaml({
      apiMode: "openai",
      host: "127.0.0.1",
      layoutBatchSize: 1,
      layoutDevice: "cpu",
      layoutModelDir: "/opt/models/pp-doclayout",
      maxWorkers: 2,
      model: "glm-ocr-g32-mixed_4_8-mlx",
      ocrApiUrl: "http://127.0.0.1:8832/v1/chat/completions",
      port: 5002,
      timeoutSeconds: 300,
    });

    expect(yaml).toContain("enabled: false");
    expect(yaml).toContain('api_url: "http://127.0.0.1:8832/v1/chat/completions"');
    expect(yaml).toContain('model: "glm-ocr-g32-mixed_4_8-mlx"');
    expect(yaml).toContain('api_mode: "openai"');
    expect(yaml).toContain('device: "cpu"');
    expect(yaml).toContain('model_dir: "/opt/models/pp-doclayout"');
  });

  it("builds a default plan without mutating the GLM-OCR source config", () => {
    const plan = buildGlmOcrRuntimeConfigPlan({
      baseUrl: "http://localhost:1234",
      glmocrHost: "127.0.0.1",
      glmocrPort: 5002,
      model: "glm-ocr-g32-mixed_4_8-mlx",
      timeoutMs: 120000,
    });

    expect(plan.serverUrl).toBe("http://127.0.0.1:5002");
    expect(plan.ocrApiUrl).toBe("http://localhost:1234/v1/chat/completions");
    expect(plan.layoutModelDir).toBe("PaddlePaddle/PP-DocLayoutV3_safetensors");
    expect(plan.generatedConfigYaml).toContain("pipeline:");
  });
});

describe("LM Studio OpenAI adapter", () => {
  it("maps OpenAI chat payloads into LM Studio native multimodal payloads", () => {
    const native = openAiChatPayloadToLmStudioNative(
      {
        model: "glm-ocr-g32-mixed_4_8-mlx",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
              { type: "text", text: "Text Recognition:" },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0,
      },
      { contextLength: 4096, fallbackModel: "fallback" }
    );

    expect(native).toMatchObject({
      context_length: 4096,
      max_output_tokens: 256,
      model: "glm-ocr-g32-mixed_4_8-mlx",
      input: [
        { type: "image", data_url: "data:image/png;base64,abc" },
        { type: "text", content: "Text Recognition:" },
      ],
    });
  });

  it("serves /v1/chat/completions by forwarding to LM Studio native /api/v1/chat", async () => {
    const lmStudio = await listen(
      http.createServer(async (request, response) => {
        expect(request.url).toBe("/api/v1/chat");
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        expect(body.model).toBe("glm-ocr-g32-mixed_4_8-mlx");
        writeJson(response, 200, { output: [{ content: "recognized text" }] });
      })
    );
    const adapter = await listen(
      createLmStudioOpenAiAdapter({
        autoLoadModel: false,
        baseUrl: lmStudio.url,
        model: "glm-ocr-g32-mixed_4_8-mlx",
      })
    );

    const response = await axios.post(`${adapter.url}/v1/chat/completions`, {
      model: "glm-ocr-g32-mixed_4_8-mlx",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });

    expect(response.data.choices[0].message.content).toBe("recognized text");
  });
});

describe("GLM-OCR LiteParse /ocr server contract", () => {
  it("adapts GLM-OCR SDK /glmocr/parse responses to OCR_API_SPEC.md results", async () => {
    const sdkServer = await listen(
      http.createServer(async (request, response) => {
        expect(request.url).toBe("/glmocr/parse");
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        expect(Array.isArray(body.images)).toBe(true);
        writeJson(response, 200, {
          json_result: [[{ content: "Hello", bbox_2d: [0, 0, 1000, 1000] }]],
          markdown_result: "Hello",
          model: "glm-ocr",
        });
      })
    );
    const ocrServer = await listen(
      createGlmOcrOcrServer({
        glmocrServerUrl: sdkServer.url,
        modelRuntime: "external",
        spawnGlmocrServer: false,
      })
    );
    const form = new FormData();
    form.append("file", png1x1, { filename: "page.png", contentType: "image/png" });
    form.append("language", "en");

    const response = await axios.post(`${ocrServer.url}/ocr`, form, {
      headers: form.getHeaders(),
    });

    expect(response.data.results).toStrictEqual([
      {
        text: "Hello",
        bbox: [0, 0, 1, 1],
        confidence: 1,
      },
    ]);
    expect(response.data.engine).toBe("glmocr-pipeline");
    expect(response.data.warnings).not.toContain("fallback_line_bboxes");
  });

  it("returns a full analyze artifact with raw GLM-OCR response", async () => {
    const sdkServer = await listen(
      http.createServer((_request, response) => {
        writeJson(response, 200, {
          json_result: [[{ content: "Analyze", bbox_2d: [0, 0, 1000, 1000] }]],
          markdown_result: "Analyze",
        });
      })
    );
    const artifact = await runGlmOcrPipelineOcr(png1x1, {
      glmocrServerUrl: sdkServer.url,
      modelRuntime: "external",
      spawnGlmocrServer: false,
    });

    expect(artifact.ok).toBe(true);
    expect(artifact.raw_response).toMatchObject({ markdown_result: "Analyze" });
    expect(artifact.conversion.results[0].text).toBe("Analyze");
  });
});

async function listen(server: http.Server): Promise<{ server: http.Server; url: string }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind test server");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}
