#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const keep = args.has("--keep");
const dockerImage = process.env.LITEPARSE_OFFLINE_TGZ_NODE_IMAGE || "node:24-trixie-slim";
const dockerPlatform = process.env.LITEPARSE_OFFLINE_TGZ_PLATFORM || "linux/amd64";
const skipPull = process.env.LITEPARSE_OFFLINE_TGZ_SKIP_PULL === "1";
const forceContainerPack = process.env.LITEPARSE_OFFLINE_TGZ_CONTAINER_PACK === "1";
const tmpRoot = path.join(repoRoot, ".tmp");
fs.mkdirSync(tmpRoot, { recursive: true });
const workRoot = fs.mkdtempSync(path.join(tmpRoot, "offline-npm-tgz-smoke-"));
let pulledImage = false;

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });
}

function output(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function ensureDockerImage() {
  if (skipPull || pulledImage) return;
  run("docker", ["pull", "--platform", dockerPlatform, dockerImage]);
  pulledImage = true;
}

function dockerArch(arch) {
  if (arch === "x64") return "amd64";
  return arch;
}

function hostMatchesTargetPlatform() {
  return `${os.platform()}/${dockerArch(os.arch())}` === dockerPlatform;
}

function packOnHost() {
  return output("npm", ["pack", "--pack-destination", workRoot, "--json"]);
}

function packInContainer() {
  ensureDockerImage();
  const excludes = [
    ".git",
    ".tmp",
    "dist",
    "node_modules",
    "ocr/glmocr/.pytest_cache",
    "ocr/glmocr/.venv",
    "ocr/glmocr/__pycache__",
    "tmp",
  ]
    .map((entry) => `--exclude=${entry}`)
    .join(" ");
  const containerScript = [
    "set -euo pipefail",
    "rm -rf /work/src",
    "mkdir -p /work/src",
    `tar ${excludes} -cf - -C /repo . | tar -xf - -C /work/src`,
    "cd /work/src",
    "npm_config_audit=false npm_config_fund=false npm ci",
    "npm run build",
    "npm prune --omit=dev",
    "npm pack --pack-destination /work --json > /work/pack.json",
  ].join("\n");
  run("docker", [
    "run",
    "--rm",
    "--platform",
    dockerPlatform,
    "-v",
    `${repoRoot}:/repo:ro`,
    "-v",
    `${workRoot}:/work`,
    dockerImage,
    "bash",
    "-lc",
    containerScript,
  ]);
  return fs.readFileSync(path.join(workRoot, "pack.json"), "utf8");
}

function writeSmokePdf(filePath) {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 120] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 48 >>\nstream\nBT /F1 16 Tf 36 72 Td (Hello LiteParse) Tj ET\nendstream\nendobj\n",
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(filePath, pdf);
}

try {
  const packJson =
    forceContainerPack || !hostMatchesTargetPlatform() ? packInContainer() : packOnHost();
  const pack = JSON.parse(packJson)[0];
  const tgzName = pack.filename;
  const tgzPath = path.join(workRoot, tgzName);
  if (!fs.existsSync(tgzPath)) {
    throw new Error(`npm pack did not create ${tgzPath}`);
  }

  const requiredFiles = [
    "README.md",
    "OCR_API_SPEC.md",
    "cli/README.md",
    "ocr/README.md",
    "ocr/glmocr/README.md",
    "ocr/glmocr/server.py",
    "dist/src/index.js",
  ];
  const packedFiles = new Set(pack.files.map((file) => file.path));
  const missing = requiredFiles.filter((file) => !packedFiles.has(file));
  const projectOwnedFiles = pack.files
    .map((file) => file.path)
    .filter((file) => !file.startsWith("node_modules/"));
  const forbidden = projectOwnedFiles.filter((file) =>
    /\.test\.|^test_case_|^\.tmp\/|^tmp\//.test(file)
  );
  if (missing.length || forbidden.length) {
    throw new Error(
      `package content check failed: ${JSON.stringify({ missing, forbidden })}`
    );
  }

  writeSmokePdf(path.join(workRoot, "smoke.pdf"));

  ensureDockerImage();

  const containerScript = [
    "set -euo pipefail",
    `npm_config_audit=false npm_config_fund=false npm install -g /pkg/${tgzName}`,
    "lit --version",
    "liteparse --version",
    "lit parse /pkg/smoke.pdf --no-ocr --format json > /tmp/smoke.json",
    "node -e 'const fs=require(\"fs\"); const data=JSON.parse(fs.readFileSync(\"/tmp/smoke.json\",\"utf8\")); const text=(data.pages||[]).map((p)=>p.text||\"\").join(\"\\n\"); if(!/Hello LiteParse/.test(text)){ console.error(JSON.stringify(data,null,2)); process.exit(1); } console.log(JSON.stringify({pages:data.pages.length,text:text.trim()}));'",
  ].join("\n");

  run("docker", [
    "run",
    "--rm",
    "--network=none",
    "--platform",
    dockerPlatform,
    "-v",
    `${workRoot}:/pkg:ro`,
    dockerImage,
    "bash",
    "-lc",
    containerScript,
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        package: pack.name,
        version: pack.version,
        tgz: tgzPath,
        docker_image: dockerImage,
        docker_platform: dockerPlatform,
        network: "none",
      },
      null,
      2
    )
  );
} finally {
  if (keep) {
    console.error(`kept smoke workspace: ${workRoot}`);
  } else {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}
