import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { en } from "../src/shared/i18n/locales/en";
import { zh } from "../src/shared/i18n/locales/zh";
import uiEn from "../src/shared/i18n/locales/ui.en.json";

const problems: string[] = [];
const han = /\p{Script=Han}/u;
const parameters = (text: string) => [...text.matchAll(/{{\s*([^}]+)\s*}}/g)].map((match) => match[1]).sort().join(",");
function compare(source: Record<string, unknown>, target: Record<string, unknown>, prefix = "translation") {
  for (const [key, value] of Object.entries(source)) {
    const name = `${prefix}.${key}`;
    const translated = target[key];
    if (typeof value === "string") {
      if (typeof translated !== "string" || !translated.trim() || han.test(translated)) problems.push(`${name}: missing English translation`);
      else if (parameters(value) !== parameters(translated)) problems.push(`${name}: interpolation mismatch`);
    } else if (value && typeof value === "object" && translated && typeof translated === "object") {
      compare(value as Record<string, unknown>, translated as Record<string, unknown>, name);
    } else problems.push(`${name}: missing namespace`);
  }
  for (const key of Object.keys(target)) if (!(key in source)) problems.push(`${prefix}.${key}: extra key`);
}
compare(zh, en);
for (const [source, translated] of Object.entries(uiEn)) {
  if (!translated.trim() || han.test(translated)) problems.push(`ui: missing English translation for ${JSON.stringify(source)}`);
  if (parameters(source) !== parameters(translated)) problems.push(`ui: interpolation mismatch for ${JSON.stringify(source)}`);
}

const inventory = new Map<string, number>();
function scan(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["testing", "locales"].includes(entry.name)) scan(file);
      continue;
    }
    if (!/\.tsx?$/.test(file) || /\.test\./.test(file)) continue;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if ((ts.isStringLiteralLike(node) || ts.isJsxText(node)) && han.test(node.text)) {
        const path = relative(process.cwd(), file).replaceAll("\\", "/");
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (ts.isJsxText(node) || ts.isJsxAttribute(node.parent)) problems.push(`${path}:${line}: hard-coded Chinese JSX copy`);
        const call = node.parent;
        if (ts.isCallExpression(call) && call.expression.getText(source) === "ui" && call.arguments[0] === node) {
          if (!(node.text in uiEn)) problems.push(`${path}:${line}: missing UI catalog key`);
        } else {
          const area = path.split("/").slice(0, 3).join("/");
          inventory.set(area, (inventory.get(area) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan("src");
if (process.argv.includes("--inventory")) {
  console.log("Non-call Chinese literals by area (includes catalog-backed static labels, search aliases, data and diagnostic contracts):");
  for (const [area, count] of inventory) console.log(`${area}: ${count}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else console.log(`i18n check passed: semantic catalogs match; ${Object.keys(uiEn).length} UI messages; no raw Chinese JSX.`);
