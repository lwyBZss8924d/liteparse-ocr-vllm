#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const specPath = path.join(
  repoRoot,
  "skills/harness/liteparse-cli-skills.spec.json",
);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const jsonMode = args.has("--json") || dryRun;
const noValidate = args.has("--no-validate");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function expandPath(value) {
  return value
    .replaceAll("$HOME", os.homedir())
    .replace(/^~(?=$|\/)/, os.homedir());
}

function resolvePath(value) {
  const expanded = expandPath(value);
  return path.isAbsolute(expanded) ? expanded : path.join(repoRoot, expanded);
}

function listFiles(root) {
  const files = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else if (entry.isSymbolicLink()) {
        files.push(relativePath);
      }
    }
  }

  walk(root);
  return files;
}

function hashTree(root) {
  if (!fs.existsSync(root)) {
    return null;
  }

  const hash = createHash("sha256");
  for (const relativePath of listFiles(root)) {
    const fullPath = path.join(root, relativePath);
    const stat = fs.lstatSync(fullPath);
    hash.update(relativePath);
    hash.update("\0");
    if (stat.isSymbolicLink()) {
      hash.update("symlink");
      hash.update("\0");
      hash.update(fs.readlinkSync(fullPath));
    } else {
      hash.update("file");
      hash.update("\0");
      hash.update(fs.readFileSync(fullPath));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function nowStamp() {
  const date = new Date();
  return date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d+Z$/, "Z");
}

function rmPath(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copySource(sourceRoot, targetRoot) {
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    force: true,
    dereference: false,
    preserveTimestamps: true,
  });
}

function validateSource() {
  const output = execFileSync(
    process.execPath,
    ["scripts/validate-liteparse-cli-skills.mjs", "--source-only", "--json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output);
}

function validateFull() {
  const output = execFileSync(
    process.execPath,
    ["scripts/validate-liteparse-cli-skills.mjs", "--json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output);
}

function classifyProjection(target, installedRoot, sourceHash) {
  const sameAsInstalled = path.resolve(target) === path.resolve(installedRoot);
  const exists = fs.existsSync(target);
  if (sameAsInstalled) {
    const hash = exists ? hashTree(target) : null;
    const isSymlink = exists ? fs.lstatSync(target).isSymbolicLink() : false;
    return {
      path: target,
      role: "installed",
      exists,
      hash,
      action: exists && !isSymlink && hash === sourceHash ? "unchanged" : "replace_installed_copy",
    };
  }

  const installedRealpath = fs.existsSync(installedRoot)
    ? fs.realpathSync(installedRoot)
    : installedRoot;
  if (!exists) {
    return {
      path: target,
      role: "projection",
      exists,
      action: "link_to_installed",
    };
  }

  const isSymlink = fs.lstatSync(target).isSymbolicLink();
  const realpath = fs.realpathSync(target);
  return {
    path: target,
    role: "projection",
    exists,
    kind: isSymlink ? "symlink" : "directory",
    realpath,
    action: isSymlink && realpath === installedRealpath ? "unchanged" : "replace_with_installed_symlink",
  };
}

function buildPlan(spec, sourceRoot, installedRoot, sourceHash) {
  return spec.projection_targets.map((targetSpec) =>
    classifyProjection(resolvePath(targetSpec), installedRoot, sourceHash),
  );
}

function syncInstalledCopy(sourceRoot, installedRoot, sourceHash) {
  const parent = path.dirname(installedRoot);
  fs.mkdirSync(parent, { recursive: true });

  const tempRoot = path.join(
    parent,
    `.liteparse-cli-tools-custom-collection.tmp-${process.pid}-${Date.now()}`,
  );
  rmPath(tempRoot);
  copySource(sourceRoot, tempRoot);

  const tempHash = hashTree(tempRoot);
  if (tempHash !== sourceHash) {
    rmPath(tempRoot);
    throw new Error(`temp copy hash mismatch: ${tempHash} !== ${sourceHash}`);
  }

  let backupPath = null;
  if (fs.existsSync(installedRoot)) {
    const backupRoot = path.join(parent, ".backups");
    fs.mkdirSync(backupRoot, { recursive: true });
    backupPath = path.join(
      backupRoot,
      `liteparse-cli-tools-custom-collection-${nowStamp()}`,
    );
    fs.renameSync(installedRoot, backupPath);
  }

  fs.renameSync(tempRoot, installedRoot);
  return backupPath;
}

function syncProjection(target, installedRoot) {
  if (path.resolve(target) === path.resolve(installedRoot)) {
    return "installed_copy";
  }

  if (fs.existsSync(target)) {
    const isSymlink = fs.lstatSync(target).isSymbolicLink();
    const realpath = fs.realpathSync(target);
    const installedRealpath = fs.realpathSync(installedRoot);
    if (isSymlink && realpath === installedRealpath) {
      return "unchanged";
    }
    rmPath(target);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(installedRoot, target, "dir");
  return "linked";
}

function main() {
  const spec = readJson(specPath);
  const sourceRoot = resolvePath(spec.source_root);
  const installedRoot = resolvePath(spec.installed_root);
  const sourceHash = hashTree(sourceRoot);
  const validation = noValidate ? { ok: true, skipped: true } : validateSource();

  if (!validation.ok) {
    throw new Error("source validation failed; refusing to sync");
  }

  const plan = buildPlan(spec, sourceRoot, installedRoot, sourceHash);
  const changedTargets = plan
    .filter((entry) => entry.action !== "unchanged")
    .map((entry) => ({ path: entry.path, action: entry.action }));

  if (dryRun) {
    emit({
      ok: true,
      dryRun: true,
      name: spec.name,
      syncMode: spec.sync_mode,
      sourceRoot,
      installedRoot,
      sourceHash,
      validation,
      plan,
      changedTargets,
    });
    return;
  }

  const backupPath = syncInstalledCopy(sourceRoot, installedRoot, sourceHash);
  const projectionResults = [];
  for (const targetSpec of spec.projection_targets) {
    const target = resolvePath(targetSpec);
    const status = syncProjection(target, installedRoot);
    projectionResults.push({ path: target, status });
  }

  const finalValidation = noValidate ? { ok: true, skipped: true } : validateFull();
  emit({
    ok: finalValidation.ok,
    dryRun: false,
    name: spec.name,
    syncMode: spec.sync_mode,
    sourceRoot,
    installedRoot,
    sourceHash,
    backupPath,
    changedTargets,
    projectionResults,
    validation,
    finalValidation,
  });

  process.exit(finalValidation.ok ? 0 : 1);
}

function emit(summary) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${summary.ok ? "ok" : "FAIL"} ${summary.name} sync${summary.dryRun ? " dry-run" : ""}\n`,
  );
  for (const target of summary.changedTargets ?? []) {
    process.stdout.write(`${target.action} ${target.path}\n`);
  }
}

try {
  main();
} catch (error) {
  const failure = {
    ok: false,
    dryRun,
    error: error.message,
  };
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
  } else {
    process.stderr.write(`FAIL ${error.message}\n`);
  }
  process.exit(1);
}
