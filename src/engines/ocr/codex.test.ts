import { describe, expect, it } from "vitest";
import {
  CODEX_OCR_OUTPUT_SCHEMA,
  CodexOcrArtifact,
  buildCodexOcrPrompt,
  convertCodexArtifactToOcrResults,
} from "./codex";

describe("Codex OCR artifact conversion", () => {
  it("converts normalized_1000 layout boxes to LiteParse pixel boxes", () => {
    const artifact = makeArtifact({
      layout_regions: [
        {
          id: "r1",
          type: "text",
          text: "Hello Codex",
          bbox: { coordinate_space: "normalized_1000", value: [100, 200, 400, 300] },
          confidence: 0.87,
        },
      ],
    });

    const converted = convertCodexArtifactToOcrResults(artifact);

    expect(converted.results).toEqual([
      {
        text: "Hello Codex",
        bbox: [100, 100, 400, 150],
        confidence: 0.87,
      },
    ]);
    expect(converted.warnings).toEqual([]);
  });

  it("uses deterministic fallback line boxes when non-strict output has no region boxes", () => {
    const artifact = makeArtifact({
      markdown: "First line\nSecond line",
      layout_regions: [
        {
          id: "r1",
          type: "text",
          text: "First line",
          confidence: 1,
        },
      ],
    });

    const converted = convertCodexArtifactToOcrResults(artifact);

    expect(converted.results).toHaveLength(2);
    expect(converted.results[0]?.bbox).toEqual([0, 0, 1000, 250]);
    expect(converted.warnings).toContain("region_bbox_missing");
    expect(converted.warnings).toContain("fallback_line_bboxes");
  });

  it("drops unboxed regions in strict bbox mode", () => {
    const artifact = makeArtifact({
      markdown: "Unboxed text",
      layout_regions: [
        {
          id: "r1",
          type: "text",
          text: "Unboxed text",
          confidence: 1,
        },
      ],
    });

    const converted = convertCodexArtifactToOcrResults(artifact, { strictBbox: true });

    expect(converted.results).toEqual([]);
    expect(converted.warnings).toContain("region_bbox_missing");
    expect(converted.warnings).not.toContain("fallback_line_bboxes");
  });

  it("keeps the prompt and schema aligned to the advanced artifact contract", () => {
    const prompt = buildCodexOcrPrompt({ imageHeight: 800, imageWidth: 1200, pageNumber: 3 });

    expect(prompt).toContain("page_metadata");
    expect(prompt).toContain("layout_regions");
    expect(prompt).toContain("assets");
    expect(prompt).toContain("normalized_1000");
    expect(CODEX_OCR_OUTPUT_SCHEMA).toHaveProperty("properties.assets");
  });
});

function makeArtifact(parsedOverrides: Partial<CodexOcrArtifact["parsed"]> = {}): CodexOcrArtifact {
  return {
    backend: "sdk",
    conversion: {
      bbox_backed_region_count: 0,
      region_count: 0,
      results: [],
      warnings: [],
    },
    engine: "codex-ocr",
    image: {
      height: 500,
      mime_type: "image/png",
      width: 1000,
    },
    input_sha256: "test",
    model: "gpt-5.4-mini",
    ok: true,
    parsed: {
      annotations: [],
      assets: [],
      layout_regions: [],
      markdown: "",
      page_metadata: {
        headings: [],
        page_number: 1,
        title: "",
      },
      warnings: [],
      ...parsedOverrides,
    },
    provenance: {
      generated_by: "liteparse codex-ocr",
      output_contract: "LiteParse advanced OCR artifact v1",
      trust_boundary: "test",
    },
    request: {
      model_reasoning_effort: "medium",
      timeout_ms: 300000,
    },
    warnings: [],
  };
}
