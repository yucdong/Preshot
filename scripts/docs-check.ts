import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCUMENT_EXTENSIONS = new Set([
  ".htm",
  ".html",
  ".json",
  ".md",
  ".mdx",
  ".txt",
]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const HAN_PATTERN = /\p{Script=Han}/u;
const ROOT_DOCUMENTS = [
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "THIRD_PARTY_NOTICES.md",
];
const OLD_CANONICAL_REFERENCES = [
  /blocknote_v13_migration_design\.md/i,
  /\buiue\.md\b/i,
  /e2e[\\/]+blocknote-v13\.spec\.ts/i,
];
const CURRENT_V13_PATTERNS = [
  /\b(?:active|canonical|current|production|shipping)\s+(?:(?:canvas|document|editable|editor|plan)\s+){0,3}(?:BlockNote|schema)(?:\s+(?:is|version))?\s*v?13\b/i,
  /\b(?:BlockNote|schema)\s*v?13\b.{0,40}\b(?:is|remains|serves as)\b.{0,40}\b(?:active|canonical|current|editable|production|shipping|sole)\b/i,
  /\bBlockNote v13 is the only editable\b/i,
  /\bonly\s+(?:BlockNote|schema)\s*v?13\b.{0,30}\b(?:can|may|must)\s+be\s+edited\b/i,
  /\buse\s+(?:BlockNote|schema)\s*v?13\b.{0,20}\b(?:active|current|editable|editing|production|shipping)\b/i,
  /\bnew projects?\b.{0,40}\b(?:BlockNote|schema)\s*v?13\b/i,
];
const HISTORICAL_CONTEXT_PATTERN =
  /\b(?:archived|before v14|former|formerly|historical|legacy|no longer|previous|previously|removed|renamed|replaced|superseded|traceability)\b/i;
const HISTORICAL_EVIDENCE_DIRECTORIES = [
  "docs/design_refs/",
  "docs/test_reports/",
];

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  }));
  return nested.flat();
}

function maskMarkdownCode(content: string): string {
  return content
    .replace(/^(?: {0,3})(`{3,}|~{3,}).*?^\s*\1\s*$/gms, "")
    .replace(/`[^`\n]*`/g, "");
}

function inlineMarkdownTargets(content: string): string[] {
  const targets: string[] = [];
  let cursor = 0;

  while ((cursor = content.indexOf("](", cursor)) !== -1) {
    let index = cursor + 2;
    while (/\s/.test(content[index] ?? "")) index += 1;

    if (content[index] === "<") {
      const end = content.indexOf(">", index + 1);
      if (end !== -1) targets.push(content.slice(index, end + 1));
      cursor = end === -1 ? index + 1 : end + 1;
      continue;
    }

    const start = index;
    let depth = 0;
    let escaped = false;
    while (index < content.length) {
      const character = content[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (/\s/.test(character) && depth === 0) {
        break;
      }
      index += 1;
    }
    if (index > start) targets.push(content.slice(start, index));
    cursor = Math.max(index + 1, cursor + 2);
  }

  return targets;
}

function markdownTargets(content: string): string[] {
  const markdown = maskMarkdownCode(content);
  const targets = inlineMarkdownTargets(markdown);
  const definitionPattern =
    /^(?: {0,3})\[(?!\^)[^\]]+]:\s*(<[^>\n]+>|[^\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*$/gm;
  for (const match of markdown.matchAll(definitionPattern)) {
    targets.push(match[1]);
  }
  return targets;
}

export function markdownLinkTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim().replace(/^<|>$/g, "");
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  ) {
    return null;
  }
  const withoutFragment = trimmed.split(/[?#]/, 1)[0];
  if (withoutFragment.length === 0) return null;
  const unescaped = withoutFragment.replace(/\\([()[\]<> ])/g, "$1");
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

function isHistoricalEvidencePath(relative: string): boolean {
  return HISTORICAL_EVIDENCE_DIRECTORIES.some((directory) =>
    relative.startsWith(directory)
  );
}

function staleCanonicalReferences(relative: string, content: string): string[] {
  if (isHistoricalEvidencePath(relative)) return [];
  const errors: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    for (const pattern of CURRENT_V13_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        errors.push(match[0]);
        break;
      }
    }

    for (const pattern of OLD_CANONICAL_REFERENCES) {
      const match = line.match(pattern);
      if (!match) continue;
      const context = line.replace(match[0], "");
      if (!HISTORICAL_CONTEXT_PATTERN.test(context)) {
        errors.push(match[0]);
      }
    }
  }

  return errors;
}

export async function checkDocumentation(root: string): Promise<string[]> {
  const errors: string[] = [];
  const docsFiles = (await collectFiles(path.join(root, "docs")))
    .filter((file) => DOCUMENT_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const rootFiles = ROOT_DOCUMENTS.map((file) => path.join(root, file));
  const files = [...rootFiles, ...docsFiles].sort();

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (HAN_PATTERN.test(content)) {
      errors.push(`${relative}: contains Han characters`);
    }
    if (MARKDOWN_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      for (const rawTarget of markdownTargets(content)) {
        const target = markdownLinkTarget(rawTarget);
        if (!target) continue;
        const resolved = target.startsWith("/")
          ? path.resolve(root, target.slice(1))
          : path.resolve(path.dirname(file), target);
        try {
          await stat(resolved);
        } catch {
          errors.push(`${relative}: broken local link ${target}`);
        }
      }
    }

    for (const staleReference of staleCanonicalReferences(relative, content)) {
      errors.push(
        `${relative}: contains stale canonical reference ${staleReference}`,
      );
    }
  }

  const featureListPath = path.join(
    root,
    "docs",
    "design_docs",
    "featurelist.json",
  );
  try {
    JSON.parse(await readFile(featureListPath, "utf8"));
  } catch (error) {
    errors.push(
      `docs/design_docs/featurelist.json: invalid JSON (${String(error)})`,
    );
  }

  return errors;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await checkDocumentation(root);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Documentation checks passed.");
}

const entryPoint = process.argv[1]
  ? path.resolve(process.argv[1])
  : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  await main();
}
