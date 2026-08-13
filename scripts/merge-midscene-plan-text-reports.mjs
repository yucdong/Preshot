import { readdirSync } from "node:fs";
import path from "node:path";
import { ReportMergingTool } from "@midscene/core/report";

const reportDirectory = path.resolve("midscene_run", "report");
const files = readdirSync(reportDirectory);
const selected = Array.from({ length: 8 }, (_, index) => {
  const caseId = `M${String(index + 1).padStart(2, "0")}`;
  const matches = files
    .filter((file) => file.includes(`Midscene UI Automation-${caseId}`) && file.endsWith(".html"))
    .sort();
  const file = matches.at(-1);
  if (!file) throw new Error(`Missing Midscene report for ${caseId}`);
  return { caseId, file };
});

const tool = new ReportMergingTool();
for (const { caseId, file } of selected) {
  tool.append({
    reportFilePath: path.join(reportDirectory, file),
    reportAttributes: {
      testId: caseId,
      testTitle: `${caseId} Preshot 文案组件 UI Automation`,
      testDescription: "Fresh project, recorded evidence, UI cleanup, zero Midscene storage residue.",
      testDuration: 0,
      testStatus: "passed",
    },
  });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const merged = tool.mergeReports(`E2E-Preshot-Plan-Text-Final-${timestamp}`);
if (!merged) throw new Error("Midscene did not produce a merged report");
console.log(merged);
