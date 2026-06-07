import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_CODEX_OCR_PORT,
  createCodexOcrServer,
} from "../../dist/codex-ocr/server.js";

test("health reports Codex home auth/config readability without exposing file contents", async (t) => {
  const codexHome = await makeCodexHomeFixture();
  const server = createCodexOcrServer({ codexHome });
  const baseUrl = await listen(t, server);

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.engine, "codex-ocr");
  assert.equal(body.backend, "sdk");
  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.reasoning_effort, "medium");
  assert.equal(body.codex_home, codexHome);
  assert.equal(body.auth_configured, true);
  assert.equal(body.config_configured, true);
  assert.equal(JSON.stringify(body).includes("secret-token"), false);
  assert.equal(DEFAULT_CODEX_OCR_PORT, 8833);
});

test("missing multipart file returns 400", async (t) => {
  const server = createCodexOcrServer();
  const baseUrl = await listen(t, server);
  const form = new FormData();
  form.set("language", "en");

  const response = await fetch(`${baseUrl}/ocr`, {
    method: "POST",
    body: form,
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Missing file field/);
});

test("oversized multipart upload returns 413", async (t) => {
  const server = createCodexOcrServer({ maxImageBytes: 4 });
  const baseUrl = await listen(t, server);
  const response = await fetch(`${baseUrl}/ocr`, {
    method: "POST",
    body: makeImageForm(),
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.match(body.error, /exceeds 4 bytes/);
});

test("/ocr returns LiteParse-compatible results with warning metadata", async (t) => {
  const server = createCodexOcrServer({
    runOcr: async (_image, options) =>
      makeArtifact({
        language: options.language,
        pageNumber: options.pageNumber,
        strictBbox: options.strictBbox,
      }),
  });
  const baseUrl = await listen(t, server);
  const form = makeImageForm();
  form.set("page_number", "7");
  form.set("strict_bboxes", "true");

  const response = await fetch(`${baseUrl}/ocr`, {
    method: "POST",
    body: form,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.results, [
    {
      text: "Server text",
      bbox: [10, 20, 50, 40],
      confidence: 0.9,
    },
  ]);
  assert.equal(body.engine, "codex-ocr");
  assert.equal(body.backend, "sdk");
  assert.equal(body.model, "gpt-5.5");
  assert.ok(body.warnings.includes("codex_bboxes_are_model_inferred"));
  assert.equal(body.region_count, 1);
  assert.equal(body.bbox_backed_region_count, 1);
});

test("/ocr/analyze returns full artifact and only includes raw response when configured", async (t) => {
  const server = createCodexOcrServer({
    includeRaw: true,
    runOcr: async (_image, options) =>
      makeArtifact({
        includeRaw: options.includeRaw,
      }),
  });
  const baseUrl = await listen(t, server);

  const response = await fetch(`${baseUrl}/ocr/analyze`, {
    method: "POST",
    body: makeImageForm(),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.parsed.markdown, "Server text");
  assert.deepEqual(body.raw_response, { fixture: true });
});

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

function makeImageForm() {
  const form = new FormData();
  form.set("language", "en");
  form.set(
    "file",
    new Blob([Buffer.from("not-a-real-image-but-server-runner-is-injected")], {
      type: "image/png",
    }),
    "fixture.png",
  );
  return form;
}

async function makeCodexHomeFixture() {
  const codexHome = await mkdir(join(tmpdir(), `liteparse-codex-home-${Date.now()}`), {
    recursive: true,
  });
  await writeFile(join(codexHome, "auth.json"), '{"access_token":"secret-token"}\n');
  await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\n');
  return codexHome;
}

function makeArtifact({ includeRaw = false } = {}) {
  return {
    backend: "sdk",
    conversion: {
      bbox_backed_region_count: 1,
      region_count: 1,
      results: [
        {
          text: "Server text",
          bbox: [10, 20, 50, 40],
          confidence: 0.9,
        },
      ],
      warnings: ["codex_bboxes_are_model_inferred"],
    },
    engine: "codex-ocr",
    image: {
      height: 80,
      mime_type: "image/png",
      width: 100,
    },
    input_sha256: "test",
    model: "gpt-5.5",
    ok: true,
    parsed: {
      annotations: [],
      assets: [],
      layout_regions: [
        {
          id: "r1",
          type: "text",
          text: "Server text",
          bbox: { coordinate_space: "pixel", value: [10, 20, 50, 40] },
          confidence: 0.9,
        },
      ],
      markdown: "Server text",
      page_metadata: {
        detected_language: "en",
        headings: [],
        page_number: 1,
        title: "",
      },
      warnings: ["codex_bboxes_are_model_inferred"],
    },
    provenance: {
      generated_by: "liteparse codex-ocr",
      output_contract: "LiteParse advanced OCR artifact v1",
      trust_boundary: "test",
    },
    raw_response: includeRaw ? { fixture: true } : undefined,
    request: {
      model_reasoning_effort: "medium",
      timeout_ms: 300000,
    },
    warnings: ["codex_bboxes_are_model_inferred"],
  };
}
