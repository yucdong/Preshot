import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDocumentation,
  markdownLinkTarget,
} from "../../../scripts/docs-check";

async function createFixtureRoot() {
  return mkdtemp(
    path.join(process.cwd(), "src", "app", "packaging", ".docs-check-"),
  );
}

async function createDocumentationFixture(root: string) {
  await mkdir(path.join(root, "docs", "design_docs"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "README.md"), "# Readme\n"),
    writeFile(path.join(root, "README.en.md"), "# Readme\n"),
    writeFile(path.join(root, "AGENTS.md"), "# Agents\n"),
    writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n"),
    writeFile(path.join(root, "CLAUDE.md"), "See `AGENTS.md`.\n"),
    writeFile(
      path.join(root, "THIRD_PARTY_NOTICES.md"),
      "# Third-party notices\n",
    ),
    writeFile(path.join(root, "docs", "README.md"), "# Docs\n"),
    writeFile(path.join(root, "docs", "ARCHITECTURE.md"), "# Architecture\n"),
    writeFile(path.join(root, "docs", "TESTING.md"), "# Testing\n"),
    writeFile(path.join(root, "docs", "RELIABILITY.md"), "# Reliability\n"),
    writeFile(
      path.join(root, "docs", "WINDOWS_INSTALLER.md"),
      "# Windows installer\n",
    ),
    writeFile(
      path.join(root, "docs", "design_docs", "blocknote_v14_design.md"),
      "# BlockNote v14\n",
    ),
    writeFile(
      path.join(root, "docs", "design_docs", "UI_UX_CONTRACT.md"),
      "# UI/UX\n",
    ),
    writeFile(
      path.join(root, "docs", "design_docs", "featurelist.json"),
      '{"features":[]}\n',
    ),
  ]);
  for (const file of [
    "features/projects.md", "features/editor.md", "features/images.md",
    "features/material-library.md", "features/exports.md", "features/settings.md",
    "development/architecture.md", "development/build-and-test.md",
    "development/reliability.md", "development/i18n.md",
    "release/windows-installer.md", "release/github.md", "release/licensing.md",
    "demo/README.md",
  ]) {
    const target = path.join(root, "docs", file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "# Guide\n");
  }
}

describe("documentation checker", () => {
  it("normalizes local Markdown link targets", () => {
    expect(markdownLinkTarget("<design_docs/spec.md#section>")).toBe(
      "design_docs/spec.md",
    );
    expect(markdownLinkTarget("https://example.com")).toBeNull();
    expect(markdownLinkTarget("#section")).toBeNull();
    expect(markdownLinkTarget("spec%20file.md?plain=1#section")).toBe(
      "spec file.md",
    );
  });

  it("accepts valid English documentation, local links, and historical evidence", async () => {
    const root = await createFixtureRoot();
    try {
      await createDocumentationFixture(root);
      await writeFile(path.join(root, "docs", "spec file.md"), "# Spec\n");
      await mkdir(path.join(root, "docs", "design_refs"), { recursive: true });
      await writeFile(
        path.join(root, "docs", "design_refs", "v13-prototype.html"),
        "<h1>BlockNote v13 is the active editor</h1>\n",
      );
      await writeFile(
        path.join(root, "docs", "README.md"),
        [
          "# Docs",
          "",
          "[Architecture](ARCHITECTURE.md#layers)",
          "[Specification][spec]",
          "",
          '[spec]: <spec file.md> "Local specification"',
          "",
          "Historical evidence: BlockNote v13 was the active editor before v14.",
          "The removed uiue.md file was superseded by UI_UX_CONTRACT.md.",
          "",
        ].join("\n"),
      );

      await expect(checkDocumentation(root)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("reports Han characters in repository documentation", async () => {
    const root = await createFixtureRoot();
    try {
      await createDocumentationFixture(root);
      await writeFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "# 许可\n");

      await expect(checkDocumentation(root)).resolves.toContain(
        "THIRD_PARTY_NOTICES.md: contains Han characters",
      );
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("reports broken inline and reference links", async () => {
    const root = await createFixtureRoot();
    try {
      await createDocumentationFixture(root);
      await writeFile(
        path.join(root, "docs", "README.md"),
        "# Docs\n\n[Inline](missing.md)\n\n[Reference][missing]\n\n[missing]: absent.md\n",
      );

      await expect(checkDocumentation(root)).resolves.toEqual(
        expect.arrayContaining([
          "docs/README.md: broken local link missing.md",
          "docs/README.md: broken local link absent.md",
        ]),
      );
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("allows the Chinese README while still checking its links", async () => {
    const root = await createFixtureRoot();
    try {
      await createDocumentationFixture(root);
      await writeFile(
        path.join(root, "README.md"),
        "# 拍摄方案\n\n[English](README.en.md)\n\n[帮助](missing.md)\n",
      );

      const errors = await checkDocumentation(root);

      expect(errors).toEqual(["README.md: broken local link missing.md"]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("reports a missing canonical installer guide", async () => {
    const root = await createFixtureRoot();
    try {
      await createDocumentationFixture(root);
      await rm(path.join(root, "docs", "release", "windows-installer.md"));

      await expect(checkDocumentation(root)).resolves.toContain(
        "docs/release/windows-installer.md: required documentation file is missing",
      );
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("reports stale current v13 and old canonical names", async () => {
    const root = await createFixtureRoot();
    try {
      await createDocumentationFixture(root);
      await writeFile(
        path.join(root, "docs", "README.md"),
        "# Docs\n\nBlockNote v13 is the only editable canvas.\n\nSee uiue.md.\n",
      );
      await writeFile(
        path.join(root, "docs", "design_docs", "active-design.md"),
        "# Active design\n\n- `e2e/blocknote-v13.spec.ts`\n",
      );

      const errors = await checkDocumentation(root);

      expect(
        errors.filter((error) => error.includes("stale canonical")),
      ).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
