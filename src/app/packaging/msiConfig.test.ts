import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const template = readFileSync(
  resolve(root, "src-tauri/wix/main.wxs"),
  "utf8",
);
const locale = readFileSync(
  resolve(root, "src-tauri/wix/en-US.wxl"),
  "utf8",
);
const conf = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
) as {
  bundle?: {
    targets?: unknown;
    publisher?: unknown;
    homepage?: unknown;
    windows?: {
      allowDowngrades?: unknown;
      webviewInstallMode?: unknown;
      wix?: {
        language?: unknown;
        template?: unknown;
        upgradeCode?: unknown;
      };
    };
  };
};
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const productionTools = readFileSync(
  resolve(root, "scripts/production-tools.psm1"),
  "utf8",
);
const productionBuild = readFileSync(
  resolve(root, "scripts/production-build.ps1"),
  "utf8",
);
const productionVerify = readFileSync(
  resolve(root, "scripts/production-verify.ps1"),
  "utf8",
);
const installerGuide = readFileSync(
  resolve(root, "docs/WINDOWS_INSTALLER.md"),
  "utf8",
);

const PER_USER_UPGRADE_CODE = "493C5FB5-639D-4FBA-94D3-AEBE4EB0DCE6";
const LEGACY_PER_MACHINE_UPGRADE_CODE =
  "97EE9B44-6313-52EB-A67E-A1334832EB86";

function openingTag(name: string): string {
  const match = template.match(new RegExp(`<${name}\\b[^>]*>`, "s"));
  expect(match, `missing <${name}>`).not.toBeNull();
  return match![0];
}

function openingTagById(name: string, id: string): string {
  const match = template.match(
    new RegExp(`<${name}\\b(?=[^>]*\\bId="${id}")[^>]*\\/?>`, "s"),
  );
  expect(match, `missing <${name} Id="${id}">`).not.toBeNull();
  return match![0];
}

describe("MSI bundle configuration", () => {
  it("pins the reviewed Tauri CLI and custom template", () => {
    expect(packageJson.devDependencies?.["@tauri-apps/cli"]).toBe("2.11.4");
    expect(conf.bundle?.windows?.wix?.template).toBe("wix/main.wxs");
    expect(template).toContain("Upstream tag: tauri-cli-v2.11.4");
    expect(template).toContain(
      "Upstream commit: 8909f221d1515955fc843808032bdc5d62209c96",
    );
    expect(template).toContain(
      "Upstream blob: dec39dadb4bc9160d108d19094987ada2a6eb996",
    );
    expect(template).toContain(
      "Upstream SHA-256: e371a01628a06730828f9bd24111feacb8bec53c250ccec4b46df756fe0a0198",
    );
  });

  it("targets only the x64 MSI bundle", () => {
    expect(conf.bundle?.targets).toEqual(["msi"]);
    expect(template).toContain('$(sys.BUILDARCH)="x64"');
    expect(template).not.toMatch(/\$\(sys\.BUILDARCH\)="(?:x86|arm64)"/);
    expect(template).toContain("Preshot MSI supports only x64");
  });

  it("is a limited per-user package and rejects ALLUSERS", () => {
    const packageTag = openingTag("Package");
    expect(packageTag).toContain('Id="*"');
    expect(packageTag).toContain('InstallScope="perUser"');
    expect(packageTag).toContain('InstallPrivileges="limited"');
    expect(template).toMatch(
      /<Condition\s+Message="[^"]*per-user[^"]*">\s*NOT ALLUSERS\s*<\/Condition>/,
    );
  });

  it("installs below LocalAppData Programs and writes only HKCU registration", () => {
    expect(template).toMatch(
      /<Directory Id="LocalAppDataFolder">[\s\S]*?<Directory Id="PreshotProgramsFolder" Name="Programs">[\s\S]*?<Directory Id="PreshotInstallDir" Name="\{\{product_name\}\}"\/>/,
    );
    expect(template).not.toContain('ConfigurableDirectory="');
    expect(template).not.toContain('Id="INSTALLDIR"');
    expect(template).not.toContain('Dialog="InstallDirDlg"');

    const registryWrites = [
      ...template.matchAll(/<Registry(?:Key|Value)\b[^>]*\bRoot="([^"]+)"/g),
    ];
    expect(registryWrites.length).toBeGreaterThan(0);
    expect(registryWrites.map((match) => match[1])).toEqual(
      Array(registryWrites.length).fill("HKCU"),
    );
  });

  it("uses a new fixed per-user upgrade family with generated product and package codes", () => {
    expect(
      String(conf.bundle?.windows?.wix?.upgradeCode).toUpperCase(),
    ).toBe(PER_USER_UPGRADE_CODE);
    expect(PER_USER_UPGRADE_CODE).not.toBe(LEGACY_PER_MACHINE_UPGRADE_CODE);
    expect(openingTag("Product")).toContain('Id="*"');
    expect(openingTag("Product")).toContain('UpgradeCode="{{upgrade_code}}"');
    expect(openingTag("Package")).toContain('Id="*"');
    expect(template.match(/<MajorUpgrade\b/g)).toHaveLength(1);
  });

  it("detects and blocks the historical per-machine lineage with localized uninstall guidance", () => {
    expect(template).toContain(
      `<Upgrade Id="${LEGACY_PER_MACHINE_UPGRADE_CODE}">`,
    );
    expect(template).toMatch(
      /<UpgradeVersion[\s\S]*?Minimum="0\.0\.0"[\s\S]*?Maximum="255\.255\.65535"[\s\S]*?OnlyDetect="yes"[\s\S]*?Property="LEGACY_MACHINE_PRESHOT_FOUND"[\s\S]*?\/>/,
    );
    expect(template).toMatch(
      /<Condition Message="!\(loc\.LegacyMachineInstallMessage\)">\s*Installed OR NOT LEGACY_MACHINE_PRESHOT_FOUND\s*<\/Condition>/,
    );
    expect(locale).toMatch(
      /<String Id="LegacyMachineInstallMessage">[^<]*machine-wide[^<]*Uninstall[^<]*Installed apps[^<]*per-user[^<]*<\/String>/,
    );
    expect(template).not.toMatch(
      /<RemoveExistingProducts>[\s\S]*LEGACY_MACHINE_PRESHOT_FOUND/,
    );
  });

  it("rejects downgrades and does not treat same-version builds as upgrades", () => {
    expect(conf.bundle?.windows?.allowDowngrades).toBe(false);
    const majorUpgrade = openingTag("MajorUpgrade");
    expect(majorUpgrade).toContain(
      'DowngradeErrorMessage="!(loc.DowngradeErrorMessage)"',
    );
    expect(majorUpgrade).not.toContain("AllowDowngrades");
    expect(majorUpgrade).not.toContain("AllowSameVersionUpgrades");
  });

  it("installs Start Menu by default and gates Desktop on DESKTOPSHORTCUT=1", () => {
    expect(template).toContain('Id="ApplicationStartMenuShortcut"');
    expect(template).toContain('Id="ApplicationShortcut"');
    expect(template).toMatch(
      /<Property Id="DESKTOPSHORTCUT"[^>]*Value="0"[^>]*\/>/,
    );
    expect(template).toMatch(
      /<Feature\s+Id="DesktopShortcutFeature"[\s\S]*?Level="2"[\s\S]*?<Condition Level="1">DESKTOPSHORTCUT = "1"<\/Condition>[\s\S]*?<ComponentRef Id="ApplicationShortcutDesktop"\s*\/>[\s\S]*?<\/Feature>/,
    );
    expect(template).not.toContain('Id="UninstallShortcut"');
    expect(template).not.toContain('Id="CMP_UninstallShortcut"');
  });

  it("keeps the executable and required binaries in mandatory MainProgram", () => {
    expect(template).toMatch(
      /<Feature\s+Id="MainProgram"[\s\S]*?<ComponentRef Id="RegistryEntries"\/>\s*<ComponentRef Id="Path"\/>\s*\{\{#each binaries as \|bin\| ~\}\}\s*<ComponentRef Id="\{\{ bin\.id \}\}"\/>\s*\{\{\/each~\}\}/,
    );

    const environmentFeature = template.match(
      /<Feature\s+Id="Environment"[\s\S]*?<\/Feature>/,
    )?.[0];
    expect(environmentFeature).toBeDefined();
    expect(environmentFeature).toContain(
      '<ComponentRef Id="PathEnvironment"/>',
    );
    expect(environmentFeature).not.toContain('<ComponentRef Id="Path"/>');
    expect(environmentFeature).not.toContain("{{ bin.id }}");

    expect(openingTagById("Component", "PathEnvironment")).toContain(
      'Win64="$(var.Win64)"',
    );
    expect(template).toMatch(
      /<Component Id="PathEnvironment"[\s\S]*?<Environment Id="PathEnvironmentVariable"[\s\S]*?Name="PATH"[\s\S]*?Value="\[PreshotInstallDir\]"[\s\S]*?System="no"[\s\S]*?<\/Component>/,
    );
    expect(template.match(/Target="\[!Path\]"/g)).toHaveLength(2);
  });

  it("propagates WebView2 bootstrapper failures from PowerShell", () => {
    for (const action of [
      "DownloadAndInvokeBootstrapper",
      "InvokeBootstrapper",
    ]) {
      const customAction = openingTagById("CustomAction", action);
      expect(customAction).toContain('Return="check"');
      expect(customAction).toContain("Start-Process");
      expect(customAction).toContain("-PassThru");
      expect(customAction).toContain("-Wait");
      expect(customAction).toContain(
        "$process.ExitCode -notin @(0, 1641, 3010)",
      );
      expect(customAction).toContain("exit $process.ExitCode");
      expect(customAction).toContain(
        "$ErrorActionPreference = &apos;Stop&apos;",
      );
      expect(customAction).toContain(
        '-Command "&amp; {',
      );
      expect(customAction).toContain("&apos;/install&apos;");
    }

    expect(template).not.toContain(
      '<Binary Id="MicrosoftEdgeWebview2Setup.exe"',
    );
    expect(template).toMatch(
      /<Component Id="WebView2Bootstrapper"[\s\S]*?<File Id="WebView2Bootstrapper"[\s\S]*?Source="\{\{webview2_bootstrapper_path\}\}"[\s\S]*?<\/Component>/,
    );
  });

  it("does not own or delete project/profile data", () => {
    expect(template.toLowerCase()).not.toContain(".preshot");
    expect(template).not.toMatch(/<(?:RemoveFile|RemoveFolder)\b/);
    expect(template).not.toMatch(/<RemoveRegistryKey\b/);
    expect(template).not.toMatch(
      /\b(?:PersonalFolder|MyPicturesFolder|DocumentsFolder|UserProfile)\b/,
    );
  });

  it("publishes ARP metadata and the Evergreen WebView2 bootstrapper", () => {
    expect(conf.bundle?.publisher).toBe("yucdong");
    expect(conf.bundle?.homepage).toBe("https://github.com/yucdong/Preshot");
    expect(template).toContain('Id="ARPPRODUCTICON"');
    expect(template).toContain('Id="ARPINSTALLLOCATION"');
    expect(template).toContain('Id="ARPURLINFOABOUT"');
    expect(template).toContain('Id="ARPHELPLINK"');
    expect(openingTag("Product")).toContain('Version="{{version}}"');
    expect(conf.bundle?.windows?.webviewInstallMode).toEqual({
      type: "downloadBootstrapper",
      silent: true,
    });
    expect(template).toContain("{{#if download_bootstrapper}}");
    expect(template).toContain("LinkId=2124703");
  });

  it("preserves the Tauri-generated inputs used by this configuration", () => {
    for (const token of [
      "{{product_name}}",
      "{{upgrade_code}}",
      "{{manufacturer}}",
      "{{version}}",
      "{{icon_path}}",
      "{{main_binary_path}}",
      "{{path_component_guid}}",
      "{{bundle_id}}",
      "{{resources}}",
      "{{#each binaries as |bin| ~}}",
      "{{#each file_associations as |association| ~}}",
      "{{#each deep_link_protocols as |protocol| ~}}",
      "{{#each merge_modules as |msm| ~}}",
      "{{#each component_group_refs as |id| ~}}",
      "{{#if install_webview}}",
      "{{webview_installer_args}}",
    ]) {
      expect(template, `missing Tauri template input ${token}`).toContain(token);
    }
  });

  it("builds the WiX installer in en-US", () => {
    expect(conf.bundle?.windows?.wix?.language).toEqual({
      "en-US": { localePath: "wix/en-US.wxl" },
    });
    expect(locale).toContain('Culture="en-US"');
  });

  it("keeps production command entry points and validation matrices explicit", () => {
    expect(packageJson.scripts?.["production:build"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/production-build.ps1",
    );
    expect(packageJson.scripts?.["production:verify"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/production-verify.ps1",
    );
    expect(packageJson.scripts?.["release:set-version"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/release-set-version.ps1",
    );

    for (const command of [
      "docs:check",
      "lint",
      "typecheck",
      "test",
      "test:init",
      "test:production-scripts",
    ]) {
      expect(productionTools).toContain(`@("${command}")`);
    }
    expect(productionTools).toContain(
      '@("test:e2e"); Description = "Playwright release tests"',
    );
    expect(productionTools).toContain(
      '@("test:e2e:blocknote"); Description = "BlockNote Playwright release tests"',
    );
    expect(productionBuild).toContain(
      '"build", "--target", $configuration.Target, "--no-bundle"',
    );
    expect(productionBuild).toContain(
      '"bundle", "--target", $configuration.Target, "--bundles", "msi"',
    );
    expect(productionBuild).toContain(
      '@{ version = $configuration.Version } | ConvertTo-Json -Compress',
    );
    expect(productionBuild).toContain(
      '"--config", $bundleConfigurationPath',
    );
    expect(productionBuild).toContain(
      "Remove-Item -LiteralPath $bundleConfigurationPath -Force",
    );
    const bundleIndex = productionBuild.indexOf('"bundle", "--target"');
    expect(productionBuild.indexOf("Assert-ReleaseExecutable")).toBeLessThan(
      bundleIndex,
    );
    expect(
      productionBuild.indexOf(
        "Invoke-PostBuildSigning -Paths @($executable.FullName)",
      ),
    ).toBeLessThan(bundleIndex);
    expect(
      productionBuild.indexOf(
        "Invoke-PostBuildSigning -Paths @($artifacts.Msi.FullName)",
      ),
    ).toBeGreaterThan(bundleIndex);
    expect(productionBuild).not.toContain("-IncludeE2E");
    expect(productionBuild).toContain(
      "Assert-ReleasePublicationPolicy $configuration -Publish:$publishing",
    );
    expect(productionVerify).toContain(
      "Invoke-ProductionValidation $configuration -IncludeE2E",
    );
    expect(productionVerify).toContain(
      "Assert-ReleasePublicationPolicy $configuration -Publish:$publishing",
    );
    expect(productionTools).toContain(
      '$script:FirstPerUserPublishVersion = "0.0.2"',
    );
    expect(productionTools).toContain("schemaVersion = 2");
    expect(productionTools).toContain(
      'action = "block-and-uninstall-first"',
    );
  });

  it("pins release artifacts to the explicit MSVC target directory", () => {
    expect(productionTools).toContain(
      '$script:ReleaseTarget = "x86_64-pc-windows-msvc"',
    );
    expect(productionTools).toContain(
      'Join-Path $root "src-tauri\\target\\$script:ReleaseTarget\\release"',
    );
    expect(productionTools).toContain(
      'ChecksumPath = Join-Path $bundleDirectory "$msiFileName.sha256"',
    );
    expect(productionTools).toContain(
      'ManifestPath = Join-Path $bundleDirectory "$safeProductName-$version-release.json"',
    );
  });

  it("documents the operator contract without obsolete artifact paths", () => {
    for (const required of [
      "%LOCALAPPDATA%\\Programs\\Preshot",
      "493c5fb5-639d-4fba-94d3-aebe4eb0dce6",
      "97ee9b44-6313-52eb-a67e-a1334832eb86",
      "DESKTOPSHORTCUT=1",
      "PRESHOT_PUBLISH=1",
      "PRESHOT_INSTALLER_VERIFY_SCRIPT",
      "x86_64-pc-windows-msvc",
      "msiexec.exe /i",
      "msiexec.exe /x",
      "msiexec.exe /famus",
      "Tauri CLI 2.11.4",
    ]) {
      expect(installerGuide).toContain(required);
    }
    expect(installerGuide).not.toContain(
      "src-tauri\\target\\release\\bundle\\msi",
    );
  });
});
