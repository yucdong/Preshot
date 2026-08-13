import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

export interface EvidenceRecorder {
  checkpoint(name: string): Promise<void>;
  record(name: string, data: unknown): Promise<void>;
  finish(data: Record<string, unknown>): Promise<void>;
  directory: string;
}

export async function createEvidenceRecorder(page: Page, runId: string, caseId: string): Promise<EvidenceRecorder> {
  const directory = path.resolve("test-results", "midscene", runId, caseId);
  await mkdir(directory, { recursive: true });
  const consoleEvents: Array<Record<string, unknown>> = [];
  const pageErrors: Array<Record<string, unknown>> = [];
  page.on("console", (message) => consoleEvents.push({ type: message.type(), text: message.text(), timestamp: new Date().toISOString() }));
  page.on("pageerror", (error) => pageErrors.push({ message: error.message, stack: error.stack, timestamp: new Date().toISOString() }));
  let index = 0;
  return {
    directory,
    async checkpoint(name) {
      index += 1;
      await page.screenshot({ path: path.join(directory, `${String(index).padStart(2, "0")}-${name}.png`), fullPage: true });
    },
    async record(name, data) {
      await writeFile(path.join(directory, `${name}.json`), JSON.stringify(data, null, 2), "utf8");
    },
    async finish(data) {
      await writeFile(path.join(directory, "console.json"), JSON.stringify(consoleEvents, null, 2), "utf8");
      await writeFile(path.join(directory, "page-errors.json"), JSON.stringify(pageErrors, null, 2), "utf8");
      await writeFile(path.join(directory, "result.json"), JSON.stringify(data, null, 2), "utf8");
    },
  };
}
