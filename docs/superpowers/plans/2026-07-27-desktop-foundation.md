# Preshot Desktop Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-first, runnable, tested, and documented React/TypeScript/Tauri v2 foundation for Preshot.

**Architecture:** Keep one application package and isolate platform-independent domain contracts from React feature UI and Tauri adapters. The initial shell proves the desktop integration while leaving image ingestion, canvas interaction, persistence, and PDF generation for later specifications.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Tauri v2, Rust, Konva/react-konva, pdf-lib, Vitest, React Testing Library, Playwright, ESLint, pnpm

---

## File Map

- `package.json`: package metadata and all development, test, and build scripts.
- `pnpm-lock.yaml`: deterministic JavaScript dependency graph.
- `vite.config.ts`: Vite, Tailwind, and Vitest configuration.
- `playwright.config.ts`: browser smoke-test configuration.
- `eslint.config.js`: TypeScript and React lint rules.
- `tsconfig*.json`: browser and tooling TypeScript settings.
- `index.html`: Vite application entry document.
- `src/main.tsx`: React bootstrap only.
- `src/app/App.tsx`: application composition root.
- `src/app/App.test.tsx`: application-shell behavior tests.
- `src/app/ErrorBoundary.tsx`: last-resort rendering error UI.
- `src/app/ErrorBoundary.test.tsx`: error-boundary behavior tests.
- `src/app/layout/AppShell.tsx`: desktop layout and feature navigation.
- `src/app/layout/Workspace.tsx`: empty-state workspace.
- `src/domain/project/models.ts`: platform-independent project model types.
- `src/domain/project/ports.ts`: repository, PDF, and desktop file-system ports.
- `src/infrastructure/desktop/tauriDesktop.ts`: typed Tauri adapter boundary.
- `src/shared/testing/setup.ts`: Vitest DOM matchers and cleanup.
- `src/styles.css`: Tailwind import and application theme.
- `e2e/app.spec.ts`: browser-shell smoke test.
- `src-tauri/Cargo.toml`: Rust package and Tauri dependencies.
- `src-tauri/build.rs`: Tauri build entry.
- `src-tauri/tauri.conf.json`: application and bundler configuration.
- `src-tauri/capabilities/default.json`: least-privilege application capability.
- `src-tauri/src/lib.rs`: command registration and testable native logic.
- `src-tauri/src/main.rs`: desktop binary entry.
- `init.ps1`: Windows prerequisite checks and dependency initialization.
- `AGENTS.md`: concise repository guide, capped at 200 lines.
- `README.md`: product overview and developer quick start.
- `docs/ARCHITECTURE.md`: dependency rules and extension guidance.
- `docs/TESTING.md`: test strategy, commands, and conventions.

### Task 1: Bootstrap the React and Tauri Toolchain

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `eslint.config.js`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `src/vite-env.d.ts`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/icons/icon.ico`
- Create: `src-tauri/src/main.rs`

- [ ] **Step 1: Enable pnpm through Corepack**

Run:

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm --version
```

Expected: the final command prints `10.15.0`.

- [ ] **Step 2: Generate the standard Tauri React TypeScript scaffold**

Run:

```powershell
pnpm create tauri-app@latest . --template react-ts --manager pnpm --force
```

Expected: the command creates `package.json`, `src`, and `src-tauri` while
preserving `.git`, `LICENSE`, and `docs`.

- [ ] **Step 3: Install the selected runtime and test dependencies**

Run:

```powershell
pnpm add @tauri-apps/api konva react-konva pdf-lib
pnpm add -D tailwindcss @tailwindcss/vite vitest jsdom `
  @testing-library/react @testing-library/jest-dom @testing-library/user-event `
  @playwright/test eslint @eslint/js typescript-eslint `
  eslint-plugin-react-hooks eslint-plugin-react-refresh
```

Expected: dependencies are added to `package.json` and `pnpm-lock.yaml`.

- [ ] **Step 4: Replace the generated scripts with the project command surface**

Set the `package.json` scripts to:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "lint": "eslint .",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

Expected: every documented command has one canonical package script.

- [ ] **Step 5: Configure Tailwind and Vitest in Vite**

Replace `vite.config.ts` with:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/shared/testing/setup.ts"],
    css: true,
  },
});
```

- [ ] **Step 6: Configure ESLint**

Replace `eslint.config.js` with:

```js
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        document: "readonly",
        HTMLElement: "readonly",
        process: "readonly",
        window: "readonly"
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true }
      ]
    }
  }
);
```

- [ ] **Step 7: Verify the generated frontend toolchain**

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit with code 0.

- [ ] **Step 8: Commit the toolchain**

```powershell
git add package.json pnpm-lock.yaml index.html vite.config.ts eslint.config.js `
  tsconfig.json tsconfig.app.json tsconfig.node.json src/vite-env.d.ts src-tauri
git commit -m "build: scaffold React and Tauri foundation"
```

### Task 2: Define Platform-Independent Domain Contracts

**Files:**
- Create: `src/domain/project/models.ts`
- Create: `src/domain/project/ports.ts`
- Create: `src/domain/project/models.test.ts`

- [ ] **Step 1: Write a failing domain model test**

Create `src/domain/project/models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./models";

describe("createEmptyProject", () => {
  it("creates a project with one empty board", () => {
    const project = createEmptyProject("project-1", "Editorial shoot");

    expect(project).toEqual({
      id: "project-1",
      name: "Editorial shoot",
      boards: [
        {
          id: "project-1-board-1",
          name: "Main board",
          assets: [],
          textBlocks: [],
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm test -- src/domain/project/models.test.ts
```

Expected: FAIL because `./models` does not exist.

- [ ] **Step 3: Implement the minimal domain model**

Create `src/domain/project/models.ts`:

```ts
export interface Asset {
  id: string;
  sourcePath: string;
  name: string;
}

export interface TextBlock {
  id: string;
  content: string;
}

export interface Board {
  id: string;
  name: string;
  assets: Asset[];
  textBlocks: TextBlock[];
}

export interface Project {
  id: string;
  name: string;
  boards: Board[];
}

export function createEmptyProject(id: string, name: string): Project {
  return {
    id,
    name,
    boards: [
      {
        id: `${id}-board-1`,
        name: "Main board",
        assets: [],
        textBlocks: [],
      },
    ],
  };
}
```

- [ ] **Step 4: Define the future capability ports**

Create `src/domain/project/ports.ts`:

```ts
import type { Project } from "./models";

export interface ProjectRepository {
  load(path: string): Promise<Project>;
  save(path: string, project: Project): Promise<void>;
}

export interface PdfExportOptions {
  destinationPath: string;
  title: string;
}

export interface PdfExporter {
  export(project: Project, options: PdfExportOptions): Promise<void>;
}

export interface DesktopFileSystem {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
}
```

- [ ] **Step 5: Run the domain test and type checker**

Run:

```powershell
pnpm test -- src/domain/project/models.test.ts
pnpm typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Commit the domain boundary**

```powershell
git add src/domain
git commit -m "feat: define project domain contracts"
```

### Task 3: Build the Tested Application Shell

**Files:**
- Create: `src/shared/testing/setup.ts`
- Create: `src/app/layout/AppShell.tsx`
- Create: `src/app/layout/Workspace.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/App.test.tsx`
- Create: `src/app/ErrorBoundary.tsx`
- Create: `src/app/ErrorBoundary.test.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Delete: generated demo assets and styles no longer imported

- [ ] **Step 1: Configure DOM test setup**

Create `src/shared/testing/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 2: Write a failing application-shell test**

Create `src/app/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("shows the Preshot planning workspace", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Preshot" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Planning tools" })).toBeVisible();
    expect(screen.getByText("Start your photography plan")).toBeVisible();
    expect(screen.getByText("Canvas")).toBeVisible();
    expect(screen.getByText("Assets")).toBeVisible();
    expect(screen.getByText("Copywriting")).toBeVisible();
    expect(screen.getByText("Export")).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the shell test to verify it fails**

Run:

```powershell
pnpm test -- src/app/App.test.tsx
```

Expected: FAIL because `src/app/App.tsx` does not exist.

- [ ] **Step 4: Implement focused layout components**

Create `src/app/layout/Workspace.tsx`:

```tsx
export function Workspace() {
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center bg-stone-100 p-8">
      <section className="max-w-lg text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
          Project workspace
        </p>
        <h2 className="text-3xl font-semibold text-stone-900">
          Start your photography plan
        </h2>
        <p className="mt-4 leading-7 text-stone-600">
          Canvas editing, reference assets, copywriting, and PDF export will be
          added as focused capabilities.
        </p>
      </section>
    </main>
  );
}
```

Create `src/app/layout/AppShell.tsx`:

```tsx
import type { PropsWithChildren } from "react";

const tools = ["Canvas", "Assets", "Copywriting", "Export"];

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="flex min-h-screen flex-col bg-stone-950 text-stone-100">
      <header className="flex h-16 items-center border-b border-white/10 px-6">
        <h1 className="text-lg font-semibold tracking-wide">Preshot</h1>
        <span className="ml-3 text-sm text-stone-400">Photography planning</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Planning tools"
          className="w-56 border-r border-white/10 p-4"
        >
          <ul className="space-y-1">
            {tools.map((tool) => (
              <li key={tool} className="rounded-lg px-3 py-2 text-sm text-stone-300">
                {tool}
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </div>
    </div>
  );
}
```

Create `src/app/App.tsx`:

```tsx
import { AppShell } from "./layout/AppShell";
import { Workspace } from "./layout/Workspace";

export function App() {
  return (
    <AppShell>
      <Workspace />
    </AppShell>
  );
}
```

- [ ] **Step 5: Write a failing error-boundary test**

Create `src/app/ErrorBoundary.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function BrokenView(): never {
  throw new Error("render failed");
}

describe("ErrorBoundary", () => {
  it("shows a recovery message for unexpected rendering failures", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <BrokenView />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Preshot could not render this view",
    );
  });
});
```

- [ ] **Step 6: Run the boundary test to verify it fails**

Run:

```powershell
pnpm test -- src/app/ErrorBoundary.test.tsx
```

Expected: FAIL because `src/app/ErrorBoundary.tsx` does not exist.

- [ ] **Step 7: Implement and wire the error boundary**

Create `src/app/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type PropsWithChildren } from "react";

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  PropsWithChildren,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected application render failure", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="grid min-h-screen place-items-center bg-stone-950 p-8 text-stone-100">
          <section role="alert" className="max-w-md text-center">
            <h1 className="text-2xl font-semibold">
              Preshot could not render this view
            </h1>
            <p className="mt-3 text-stone-400">
              Restart the application. If the problem continues, preserve the
              project files and report the error.
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
```

Replace the render body in `src/main.tsx` with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
```

- [ ] **Step 8: Apply the Tailwind entry and base theme**

Replace `src/styles.css` with:

```css
@import "tailwindcss";

:root {
  color: #1c1917;
  background: #0c0a09;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input,
textarea {
  font: inherit;
}
```

- [ ] **Step 9: Run shell tests and static checks**

Run:

```powershell
pnpm test -- src/app
pnpm typecheck
pnpm lint
```

Expected: all commands exit with code 0.

- [ ] **Step 10: Commit the application shell**

```powershell
git add src
git commit -m "feat: add tested desktop application shell"
```

### Task 4: Add the Typed Tauri Adapter Boundary

**Files:**
- Create: `src/infrastructure/desktop/tauriDesktop.ts`
- Create: `src/infrastructure/desktop/tauriDesktop.test.ts`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write a failing adapter test**

Create `src/infrastructure/desktop/tauriDesktop.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("getDesktopPlatform", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("uses the typed platform_info command", async () => {
    invoke.mockResolvedValue({ os: "windows" });
    const { getDesktopPlatform } = await import("./tauriDesktop");

    await expect(getDesktopPlatform()).resolves.toEqual({ os: "windows" });
    expect(invoke).toHaveBeenCalledWith("platform_info");
  });

  it("retains operation context when the command fails", async () => {
    invoke.mockRejectedValue(new Error("bridge unavailable"));
    const { getDesktopPlatform } = await import("./tauriDesktop");

    await expect(getDesktopPlatform()).rejects.toThrow(
      "Unable to read desktop platform: bridge unavailable",
    );
  });
});
```

- [ ] **Step 2: Run the adapter test to verify it fails**

Run:

```powershell
pnpm test -- src/infrastructure/desktop/tauriDesktop.test.ts
```

Expected: FAIL because `tauriDesktop.ts` does not exist.

- [ ] **Step 3: Implement the typed frontend adapter**

Create `src/infrastructure/desktop/tauriDesktop.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export interface DesktopPlatform {
  os: string;
}

export async function getDesktopPlatform(): Promise<DesktopPlatform> {
  try {
    return await invoke<DesktopPlatform>("platform_info");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read desktop platform: ${detail}`, {
      cause: error,
    });
  }
}
```

- [ ] **Step 4: Write the Rust test before the command implementation**

Replace `src-tauri/src/lib.rs` with:

```rust
#[derive(Debug, PartialEq, serde::Serialize)]
struct PlatformInfo {
    os: &'static str,
}

fn current_platform() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
    }
}

#[tauri::command]
fn platform_info() -> PlatformInfo {
    current_platform()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![platform_info])
        .run(tauri::generate_context!())
        .expect("error while running Preshot");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_compilation_platform() {
        assert_eq!(
            current_platform(),
            PlatformInfo {
                os: std::env::consts::OS
            }
        );
    }
}
```

- [ ] **Step 5: Run adapter and Rust tests**

Run:

```powershell
pnpm test -- src/infrastructure/desktop/tauriDesktop.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Commit the native boundary**

```powershell
git add src/infrastructure src-tauri/src/lib.rs
git commit -m "feat: add typed Tauri platform adapter"
```

### Task 5: Add Browser Smoke Testing

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/app.spec.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write the smoke test**

Create `e2e/app.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("opens the photography planning workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Preshot" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Planning tools" }),
  ).toBeVisible();
  await expect(page.getByText("Start your photography plan")).toBeVisible();
});
```

- [ ] **Step 2: Configure Playwright**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 3: Add generated test output to `.gitignore`**

Append:

```gitignore
playwright-report/
test-results/
.superpowers/
```

- [ ] **Step 4: Install the browser and run the test**

Run:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

Expected: one Chromium test passes.

- [ ] **Step 5: Commit the smoke test**

```powershell
git add playwright.config.ts e2e/app.spec.ts .gitignore
git commit -m "test: add browser shell smoke coverage"
```

### Task 6: Create the Windows Initialization Script

**Files:**
- Create: `init.ps1`

- [ ] **Step 1: Implement explicit prerequisite checks**

Create `init.ps1`:

```powershell
[CmdletBinding()]
param(
    [switch]$SkipBrowserInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$locationPushed = $false

function Assert-Command {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command '$Name'. $InstallHint"
    }
}

function Test-WebView2 {
    $clientKeys = @(
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7E4A4-7A2D-4C48-9F73-D3E5B6109F1B}",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F1E7E4A4-7A2D-4C48-9F73-D3E5B6109F1B}",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7E4A4-7A2D-4C48-9F73-D3E5B6109F1B}"
    )

    return $clientKeys | Where-Object { Test-Path $_ } | Select-Object -First 1
}

try {
    Assert-Command "node" "Install the current Node.js LTS release from https://nodejs.org/."
    Assert-Command "corepack" "Install a Node.js distribution that includes Corepack."
    Assert-Command "rustc" "Install Rust with rustup from https://rustup.rs/."
    Assert-Command "cargo" "Install Rust with rustup from https://rustup.rs/."

    if (-not (Test-WebView2)) {
        throw "Microsoft Edge WebView2 Runtime was not detected. Install it from https://developer.microsoft.com/microsoft-edge/webview2/."
    }

    Push-Location $PSScriptRoot
    $locationPushed = $true
    corepack enable
    corepack prepare pnpm@10.15.0 --activate
    pnpm install --frozen-lockfile

    if (-not $SkipBrowserInstall) {
        pnpm exec playwright install chromium
    }

    Write-Host "Preshot is ready. Run 'pnpm tauri:dev' to start the desktop app." -ForegroundColor Green
}
catch {
    Write-Error "Preshot initialization failed: $($_.Exception.Message)"
    exit 1
}
finally {
    if ($locationPushed) {
        Pop-Location -ErrorAction SilentlyContinue
    }
}
```

- [ ] **Step 2: Verify the script parser**

Run:

```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path .\init.ps1),
  [ref]$null,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) { throw ($errors -join [Environment]::NewLine) }
```

Expected: the command exits with code 0 and prints no parser errors.

- [ ] **Step 3: Exercise the initializer**

Run:

```powershell
.\init.ps1 -SkipBrowserInstall
```

Expected: prerequisites are either reported with an actionable error and exit
code 1, or installation completes and the script prints the `pnpm tauri:dev`
instruction.

- [ ] **Step 4: Commit the initializer**

```powershell
git add init.ps1
git commit -m "build: add Windows initialization script"
```

### Task 7: Document Architecture, Testing, and Contributor Guidance

**Files:**
- Modify: `README.md`
- Create: `AGENTS.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/TESTING.md`

- [ ] **Step 1: Write `docs/ARCHITECTURE.md`**

Include these exact sections:

```markdown
# Architecture

## Goals
Windows-first desktop delivery, offline-capable project work, explicit platform
boundaries, and a path to future mobile clients.

## Layers
Document `app`, `features`, `domain`, `infrastructure`, and `shared`, including
the allowed dependency direction:
`app/features -> domain <- infrastructure`, with `shared` containing no
business rules.

## Native Boundary
Only infrastructure adapters invoke Tauri. Rust commands remain narrow,
serializable, and free of presentation logic.

## Future Capabilities
Describe where canvas, asset ingestion, copywriting, project persistence, and
PDF adapters will live without claiming they are implemented.

## Mobile Evolution
Extract `domain` into a workspace package only when the first mobile client is
started; do not introduce a monorepo preemptively.
```

- [ ] **Step 2: Write `docs/TESTING.md`**

Include these exact sections and command ownership:

```markdown
# Testing

## Test Pyramid
Domain unit tests are the majority, component tests cover visible behavior,
Playwright provides a small startup smoke layer, and Rust tests cover native
logic without launching the desktop window.

## Commands
- `pnpm test`: Vitest once.
- `pnpm test:watch`: Vitest watch mode.
- `pnpm test:e2e`: Playwright Chromium smoke tests.
- `pnpm typecheck`: TypeScript project checks.
- `pnpm lint`: ESLint.
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust tests.

## Conventions
Co-locate `*.test.ts(x)` files, assert public behavior, mock only platform
boundaries, avoid snapshots for dynamic canvas output, and add regression tests
before fixing defects.
```

- [ ] **Step 3: Write `AGENTS.md` under the 200-line limit**

Document the repository map, dependency rules, canonical commands, TDD
expectation, error-handling policy, Windows initialization, and deferred
capabilities. State that direct Tauri calls outside `src/infrastructure` and
business logic in `src-tauri` are prohibited.

- [ ] **Step 4: Replace `README.md`**

Cover:

1. Product purpose and current foundation-only status.
2. Technology stack.
3. Windows prerequisites: Node LTS, Rust MSVC toolchain, Visual Studio C++
   Build Tools, WebView2, and Corepack.
4. `.\init.ps1`, `pnpm tauri:dev`, and `pnpm dev`.
5. Lint, type-check, unit, E2E, Rust test, frontend build, and Tauri build
   commands.
6. Links to `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/TESTING.md`.

- [ ] **Step 5: Verify documentation matches the command surface**

Run:

```powershell
$agentLines = (Get-Content .\AGENTS.md).Count
if ($agentLines -gt 200) { throw "AGENTS.md has $agentLines lines" }
rg "pnpm (lint|typecheck|test|test:e2e|build|tauri:dev|tauri:build)" `
  README.md AGENTS.md docs
```

Expected: `AGENTS.md` is at most 200 lines and every documented command exists
in `package.json`.

- [ ] **Step 6: Commit project documentation**

```powershell
git add README.md AGENTS.md docs/ARCHITECTURE.md docs/TESTING.md
git commit -m "docs: add desktop development guide"
```

### Task 8: Run the Complete Verification Matrix

**Files:**
- Modify only files required to correct failures caused by Tasks 1-7.

- [ ] **Step 1: Run frontend static validation**

Run:

```powershell
pnpm lint
pnpm typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 2: Run automated tests**

Run:

```powershell
pnpm test
pnpm test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all unit, component, browser, and Rust tests pass.

- [ ] **Step 3: Build both delivery targets**

Run:

```powershell
pnpm build
pnpm tauri:build
```

Expected: Vite emits `dist`, and Tauri emits a Windows executable and installer
bundle under `src-tauri/target/release/bundle`.

- [ ] **Step 4: Inspect repository hygiene**

Run:

```powershell
git status --short
git --no-pager diff --check
(Get-Content .\AGENTS.md).Count
```

Expected: only intentional files are changed, no whitespace errors are
reported, and the line count is at most 200.

- [ ] **Step 5: Commit any verification-only corrections**

If verification required code changes:

```powershell
git add <corrected-files>
git commit -m "fix: complete desktop foundation verification"
```

If no changes were required, do not create an empty commit.
