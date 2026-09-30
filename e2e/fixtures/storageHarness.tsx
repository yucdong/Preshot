import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import i18n from "../../src/shared/i18n/config";
import { ThemeProvider } from "../../src/app/theme/ThemeProvider";
import { StorageProvider } from "../../src/app/storage/StorageProvider";
import { SettingsPanel } from "../../src/features/settings/SettingsPanel";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/models";
import type { StorageInfo, StorageRepository } from "../../src/domain/storage/ports";
import "../../src/styles.css";

if (import.meta.env.MODE !== "e2e") throw new Error("Storage fixture requires E2E mode");
const scenario = new URLSearchParams(location.search).get("scenario");
const language = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh";
let info: StorageInfo = {
  configurationDirectory: "C:\\Users\\示例用户\\.preshot", applicationDirectory: "C:\\Program Files\\Preshot",
  existingWorkingDirectory: ["existing", "confirmed"].includes(scenario ?? "") ? "C:\\Users\\示例用户\\.preshot" : null,
  libraryDirectory: "C:\\Users\\示例用户\\.preshot\\library", needsSetup: !["missing", "confirmed"].includes(scenario ?? ""), pendingMove: false,
  problem: scenario === "missing" ? "Drive unavailable" : null, generation: 1,
};
const repository: StorageRepository = {
  status: async () => ({ ...info }),
  async configure(path) { info = { ...info, configurationDirectory: path, libraryDirectory: `${path}\\library`, needsSetup: false, problem: null }; return { ...info }; },
  async move(path) {
    info = { ...info, libraryDirectory: path ?? info.libraryDirectory, generation: info.generation + 1 };
    return { ...info };
  },
  cancelMove: async () => ({ ...info, pendingMove: false }),
  pickDirectory: async () => "E:\\摄影素材备份\\素材库",
  reveal: async () => {},
};
export function Workspace() {
  const [open, setOpen] = useState(false);
  return <main className="min-h-screen bg-app-bg p-6 text-app-ink">
    <h1>南京长江大桥摄影计划</h1>
    <label>项目内容<input aria-label="项目内容" defaultValue="保留未保存编辑" /></label>
    <button onClick={() => setOpen(true)}>打开设置</button>
    <SettingsPanel open={open} onClose={() => setOpen(false)} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nextProvider i18n={i18n}>
  <ThemeProvider repository={{ read: async () => ({ ...DEFAULT_SETTINGS, language }), write: async () => {} }}>
    <StorageProvider repository={repository}><Workspace /></StorageProvider>
  </ThemeProvider>
</I18nextProvider>);
