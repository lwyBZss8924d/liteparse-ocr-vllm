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
const jsonMode = args.has("--json");
const sourceOnly = args.has("--source-only");
const skipCli = args.has("--skip-cli");

const checks = [];

function record(name, ok, detail = {}) {
  const check = { name, ok, ...detail };
  checks.push(check);
  return ok;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function expandPath(value) {
  return value
    .replaceAll("$HOME", os.homedir())
    .replace(/^~(?=$|\/)/, os.homedir());
}

function resolveRepoPath(value) {
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

function readTextTree(root) {
  return listFiles(root)
    .filter((relativePath) => /\.(md|yaml|yml|json|txt)$/.test(relativePath))
    .map((relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8"))
    .join("\n");
}

function parseSimpleYaml(source, filePath) {
  const stack = [{ indent: -1, value: {} }];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNo = index + 1;
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }
    if (rawLine.includes("\t")) {
      throw new Error(`${filePath}:${lineNo}: tabs are not allowed`);
    }

    const match = rawLine.match(/^(\s*)([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      throw new Error(`${filePath}:${lineNo}: unsupported YAML mapping syntax`);
    }

    const indent = match[1].length;
    const key = match[2];
    const valueText = match[3] ?? "";
    if (indent % 2 !== 0) {
      throw new Error(`${filePath}:${lineNo}: indentation must use two spaces`);
    }

    while (stack.length && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    if (!stack.length) {
      throw new Error(`${filePath}:${lineNo}: invalid indentation`);
    }

    const parent = stack[stack.length - 1].value;
    if (Object.prototype.hasOwnProperty.call(parent, key)) {
      throw new Error(`${filePath}:${lineNo}: duplicate key ${key}`);
    }

    if (!valueText) {
      const next = {};
      parent[key] = next;
      stack.push({ indent, value: next });
      continue;
    }

    if (/^["']/.test(valueText)) {
      const quote = valueText[0];
      if (!valueText.endsWith(quote) || valueText.length === 1) {
        throw new Error(`${filePath}:${lineNo}: unterminated quoted scalar`);
      }
      parent[key] = valueText.slice(1, -1);
    } else {
      parent[key] = valueText;
    }
  }

  return stack[0].value;
}

function parseSkillFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.startsWith("---\n")) {
    throw new Error(`${filePath}: missing YAML frontmatter`);
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error(`${filePath}: missing closing frontmatter delimiter`);
  }
  const frontmatter = content.slice(4, end);
  const parsed = parseSimpleYaml(frontmatter, filePath);
  if (!parsed.name || !parsed.description) {
    throw new Error(`${filePath}: frontmatter must include name and description`);
  }
  return parsed;
}

function commandOutput(binary, command = []) {
  return execFileSync(binary, command, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function checkRequiredFiles(sourceRoot, spec) {
  for (const relativePath of spec.expected_skill_files) {
    const fullPath = path.join(sourceRoot, relativePath);
    record(`skill file: ${relativePath}`, fs.existsSync(fullPath), {
      path: fullPath,
    });
  }
}

function checkYaml(sourceRoot, spec) {
  for (const relativePath of spec.expected_skill_files) {
    const fullPath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    try {
      if (relativePath.endsWith("SKILL.md")) {
        parseSkillFrontmatter(fullPath);
      } else if (relativePath.endsWith(".yaml") || relativePath.endsWith(".yml")) {
        parseSimpleYaml(fs.readFileSync(fullPath, "utf8"), fullPath);
      }
      record(`YAML parses: ${relativePath}`, true, { path: fullPath });
    } catch (error) {
      record(`YAML parses: ${relativePath}`, false, {
        path: fullPath,
        error: error.message,
      });
    }
  }
}

function checkTerms(sourceRoot, spec) {
  const text = readTextTree(sourceRoot);
  for (const term of spec.required_terms) {
    record(`skill source term: ${term}`, text.includes(term), { term });
  }
}

function checkDocs(spec) {
  for (const relativePath of spec.docs.required_files) {
    const fullPath = path.join(repoRoot, relativePath);
    const exists = fs.existsSync(fullPath);
    record(`doc file: ${relativePath}`, exists, { path: fullPath });
    if (!exists) {
      continue;
    }
    const text = fs.readFileSync(fullPath, "utf8");
    for (const term of spec.docs.required_terms[relativePath] ?? []) {
      record(`doc term: ${relativePath}: ${term}`, text.includes(term), {
        path: fullPath,
        term,
      });
    }
  }
}

function checkCli(spec) {
  if (skipCli) {
    record("CLI command surface", true, { skipped: true });
    return;
  }

  const binary = spec.cli.binary;
  let help;
  try {
    help = commandOutput(binary, ["--help"]);
    record("CLI help available", true, { binary });
  } catch (error) {
    record("CLI help available", false, {
      binary,
      error: error.stderr?.toString() || error.message,
    });
    return;
  }

  for (const command of spec.cli.required_commands) {
    record(`CLI command listed: ${command}`, help.includes(command), {
      command,
    });
  }

  for (const [command, requiredOptions] of Object.entries(
    spec.cli.command_help_options,
  )) {
    let commandHelp;
    try {
      commandHelp = commandOutput(binary, [command, "--help"]);
      record(`CLI command help available: ${command}`, true, { command });
    } catch (error) {
      record(`CLI command help available: ${command}`, false, {
        command,
        error: error.stderr?.toString() || error.message,
      });
      continue;
    }

    for (const option of requiredOptions) {
      record(`CLI option: ${command}: ${option}`, commandHelp.includes(option), {
        command,
        option,
      });
    }
  }
}

function checkForbiddenRoots(spec) {
  for (const relativePath of spec.forbidden_repo_autoload_roots) {
    const fullPath = path.join(repoRoot, relativePath);
    record(`forbidden repo autoload root absent: ${relativePath}`, !fs.existsSync(fullPath), {
      path: fullPath,
    });
  }
}

function checkProjection(spec, sourceHash) {
  const installedRoot = resolveRepoPath(spec.installed_root);
  const installedExists = fs.existsSync(installedRoot);
  const installedIsSymlink =
    installedExists && fs.lstatSync(installedRoot).isSymbolicLink();
  const installedHash = installedExists ? hashTree(installedRoot) : null;
  record("installed projection exists", installedExists, { path: installedRoot });
  record("installed projection is copied directory", installedExists && !installedIsSymlink, {
    path: installedRoot,
  });
  record("installed projection hash matches source", installedHash === sourceHash, {
    sourceHash,
    installedHash,
  });

  const installedRealpath = installedExists ? fs.realpathSync(installedRoot) : null;
  const targets = [];
  for (const targetSpec of spec.projection_targets) {
    const target = resolveRepoPath(targetSpec);
    const sameAsInstalled = path.resolve(target) === path.resolve(installedRoot);
    const exists = fs.existsSync(target);
    const entry = { path: target, exists };
    if (sameAsInstalled) {
      entry.kind = "installed_copy";
      entry.ok = exists && !installedIsSymlink && installedHash === sourceHash;
    } else if (!exists) {
      entry.kind = "missing";
      entry.ok = false;
    } else {
      const isSymlink = fs.lstatSync(target).isSymbolicLink();
      const realpath = fs.realpathSync(target);
      entry.kind = isSymlink ? "symlink" : "directory";
      entry.realpath = realpath;
      entry.ok = Boolean(isSymlink && installedRealpath && realpath === installedRealpath);
    }
    targets.push(entry);
    record(`projection target aligned: ${targetSpec}`, entry.ok, entry);
  }
  return { installedHash, targets };
}

function main() {
  const spec = readJson(specPath);
  const sourceRoot = resolveRepoPath(spec.source_root);
  const sourceExists = fs.existsSync(sourceRoot);
  record("source root exists", sourceExists, { path: sourceRoot });
  if (!sourceExists) {
    finish(spec, null, null);
    return;
  }

  const sourceHash = hashTree(sourceRoot);
  checkRequiredFiles(sourceRoot, spec);
  checkYaml(sourceRoot, spec);
  checkTerms(sourceRoot, spec);
  checkDocs(spec);
  checkForbiddenRoots(spec);
  checkCli(spec);

  let projection = null;
  if (!sourceOnly) {
    projection = checkProjection(spec, sourceHash);
  } else {
    record("projection validation", true, { skipped: true });
  }

  finish(spec, sourceHash, projection);
}

function finish(spec, sourceHash, projection) {
  const ok = checks.every((check) => check.ok);
  const output = {
    ok,
    name: spec.name,
    mode: sourceOnly ? "source-only" : "full",
    sourceRoot: resolveRepoPath(spec.source_root),
    installedRoot: resolveRepoPath(spec.installed_root),
    sourceHash,
    installedHash: projection?.installedHash ?? null,
    projectionTargets: projection?.targets ?? null,
    checks,
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    for (const check of checks) {
      const status = check.ok ? "ok" : "FAIL";
      process.stdout.write(`${status} ${check.name}\n`);
      if (!check.ok && check.error) {
        process.stdout.write(`  ${check.error}\n`);
      }
    }
    process.stdout.write(
      `\n${ok ? "ok" : "FAIL"} ${spec.name} ${output.mode} validation\n`,
    );
  }

  process.exit(ok ? 0 : 1);
}

main();
