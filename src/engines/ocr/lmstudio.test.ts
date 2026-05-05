import { describe, expect, it, vi } from "vitest";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

vi.mock("axios", () => {
  return {
    default: {
      get: vi.fn(async () => ({
        status: 200,
        data: {
          models: [
            {
              key: "glm-ocr-g32-mixed_4_8-mlx",
              loaded_instances: [{}],
            },
          ],
        },
      })),
      post: vi.fn(async () => ({
        status: 200,
        data: {
          output: [
            {
              content:
                '```json\n{"markdown_result":"Hello","json_result":[[{"index":0,"label":"text","content":"Hello","bbox_2d":[0,0,1000,1000]}]]}\n```',
            },
          ],
        },
      })),
    },
  };
});

vi.mock("child_process", () => {
  return {
    execFile: vi.fn((_file, _args, _options, callback) => {
      callback(null, "", "");
      return {};
    }),
  };
});

import { execFile } from "child_process";
import axios from "axios";
import {
  convertLmStudioArtifactToOcrResults,
  ensureLmStudioModelLoaded,
  getLmStudioModelStatus,
  runLmStudioOcr,
} from "./lmstudio";

describe("LM Studio GLM-OCR client", () => {
  it("calls LM Studio native chat API and normalizes GLM-OCR layout JSON", async () => {
    const artifact = await runLmStudioOcr(png1x1, {
      autoLoadModel: false,
      baseUrl: "http://localhost:1234",
      mode: "layout",
    });

    expect(artifact.ok).toBe(true);
    expect(artifact.endpoint).toBe("http://localhost:1234/api/v1/chat");
    expect(artifact.parsed.markdown_result).toBe("Hello");
    expect(artifact.parsed.layout_details).toStrictEqual([
      [{ index: 0, label: "text", content: "Hello", bbox_2d: [0, 0, 1000, 1000] }],
    ]);
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:1234/api/v1/chat",
      expect.objectContaining({
        model: "glm-ocr-g32-mixed_4_8-mlx",
        input: expect.any(Array),
      }),
      expect.any(Object)
    );
  });

  it("converts normalized bbox_2d regions into LiteParse OCR pixel boxes", async () => {
    const artifact = await runLmStudioOcr(png1x1, {
      autoLoadModel: false,
      baseUrl: "http://localhost:1234",
    });
    const converted = convertLmStudioArtifactToOcrResults(artifact);

    expect(converted.results).toStrictEqual([
      {
        text: "Hello",
        bbox: [0, 0, 1, 1],
        confidence: 1,
      },
    ]);
    expect(converted.warnings).toStrictEqual([]);
  });

  it("creates deterministic fallback line boxes for OCR-only text", async () => {
    const artifact = await runLmStudioOcr(png1x1, {
      autoLoadModel: false,
      baseUrl: "http://localhost:1234",
    });
    artifact.parsed.layout_details = [];
    artifact.parsed.json_result = [];
    artifact.parsed.markdown_result = "Alpha\nBeta";

    const converted = convertLmStudioArtifactToOcrResults(artifact);

    expect(converted.results.map((item) => item.text)).toStrictEqual(["Alpha", "Beta"]);
    expect(converted.warnings).toContain("fallback_line_bboxes");
  });

  it("reports LM Studio model availability and loaded state", async () => {
    const status = await getLmStudioModelStatus(
      "http://localhost:1234",
      "glm-ocr-g32-mixed_4_8-mlx"
    );

    expect(status).toStrictEqual({
      available: true,
      loaded: true,
      models: ["glm-ocr-g32-mixed_4_8-mlx"],
    });
  });

  it("auto-loads an installed but unloaded local LM Studio model", async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          models: [{ key: "glm-ocr-g32-mixed_4_8-mlx", loaded_instances: [] }],
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          models: [{ key: "glm-ocr-g32-mixed_4_8-mlx", loaded_instances: [{}] }],
        },
      });

    const result = await ensureLmStudioModelLoaded({
      baseUrl: "http://localhost:1234",
      model: "glm-ocr-g32-mixed_4_8-mlx",
    });

    expect(result).toStrictEqual({
      ok: true,
      loaded: true,
      attempted_load: true,
      error: undefined,
    });
    expect(execFile).toHaveBeenCalledWith(
      "lms",
      ["load", "glm-ocr-g32-mixed_4_8-mlx", "--identifier", "glm-ocr-g32-mixed_4_8-mlx", "-y"],
      expect.objectContaining({ timeout: 120000 }),
      expect.any(Function)
    );
  });
});
