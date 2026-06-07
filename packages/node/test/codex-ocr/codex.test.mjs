import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_OCR_DEFAULTS,
  CODEX_OCR_OUTPUT_SCHEMA,
  buildCodexOcrPrompt,
  convertCodexArtifactToOcrResults,
} from "../../dist/codex-ocr/codex.js";

test("converts normalized_1000 layout boxes to LiteParse pixel boxes", () => {
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

  assert.deepEqual(converted.results, [
    {
      text: "Hello Codex",
      bbox: [100, 100, 400, 150],
      confidence: 0.87,
    },
  ]);
  assert.deepEqual(converted.warnings, []);
});

test("uses deterministic fallback line boxes when non-strict output has no region boxes", () => {
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

  assert.equal(converted.results.length, 2);
  assert.deepEqual(converted.results[0]?.bbox, [0, 0, 1000, 250]);
  assert.ok(converted.warnings.includes("region_bbox_missing"));
  assert.ok(converted.warnings.includes("fallback_line_bboxes"));
});

test("drops unboxed regions in strict bbox mode", () => {
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

  assert.deepEqual(converted.results, []);
  assert.ok(converted.warnings.includes("region_bbox_missing"));
  assert.equal(converted.warnings.includes("fallback_line_bboxes"), false);
});

test("keeps prompt and schema aligned to the advanced artifact contract", () => {
  const prompt = buildCodexOcrPrompt({
    imageHeight: 800,
    imageWidth: 1200,
    language: "en",
    pageNumber: 3,
  });

  assert.match(prompt, /page_metadata/);
  assert.match(prompt, /layout_regions/);
  assert.match(prompt, /assets/);
  assert.match(prompt, /normalized_1000/);
  assert.equal(CODEX_OCR_OUTPUT_SCHEMA.properties.assets.type, "array");
  assert.equal(CODEX_OCR_DEFAULTS.model, "gpt-5.5");
  assert.equal(CODEX_OCR_DEFAULTS.reasoningEffort, "medium");
});

function makeArtifact(parsedOverrides = {}) {
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
    model: "gpt-5.5",
    ok: true,
    parsed: {
      annotations: [],
      assets: [],
      layout_regions: [],
      markdown: "",
      page_metadata: {
        detected_language: "en",
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
