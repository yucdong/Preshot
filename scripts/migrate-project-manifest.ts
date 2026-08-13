import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { migratePlan } from "../src/domain/plan/canvas/migrate";

interface ProjectManifest {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  coverImage?: string;
  plan?: unknown;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "");
}

function parseManifest(source: string, manifestPath: string): ProjectManifest {
  const value = JSON.parse(source) as Partial<ProjectManifest>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error(`Invalid Preshot project manifest: ${manifestPath}`);
  }
  return value as ProjectManifest;
}

function hasV11ImageViewFields(plan: unknown) {
  if (typeof plan !== "object" || plan === null) return false;
  const components = (plan as { components?: unknown }).components;
  if (!Array.isArray(components)) return false;
  return components.some((component) => {
    if (typeof component !== "object" || component === null) return false;
    const record = component as { type?: unknown; images?: unknown };
    if (record.type !== "reference" || !Array.isArray(record.images)) return false;
    return record.images.some((image) =>
      typeof image === "object" &&
      image !== null &&
      ("crop" in image || "sourceWidth" in image || "sourceHeight" in image)
    );
  });
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const manifestArg = args.find((arg) => arg !== "--write");
  if (!manifestArg) {
    throw new Error("Usage: migrate-project-manifest.ts <path-to-.preshotproj> [--write]");
  }

  const manifestPath = path.resolve(manifestArg);
  const source = await readFile(manifestPath, "utf8");
  const manifest = parseManifest(source, manifestPath);
  if (manifest.plan === undefined) {
    throw new Error("The project manifest does not contain a plan");
  }

  const sourcePlanSchema = (manifest.plan as { schemaVersion?: unknown }).schemaVersion;
  const repairsMislabeledV11 = sourcePlanSchema === 10 && hasV11ImageViewFields(manifest.plan);
  const planForMigration = repairsMislabeledV11
    ? { ...(manifest.plan as Record<string, unknown>), schemaVersion: 11 }
    : manifest.plan;
  const migratedPlan = migratePlan(planForMigration, { projectName: manifest.name });
  const migratedManifest: ProjectManifest = { ...manifest, plan: migratedPlan };
  const serialized = `${JSON.stringify(migratedManifest, null, 2)}\n`;

  console.log(JSON.stringify({
    project: manifest.name,
    manifestPath,
    sourcePlanSchema,
    targetPlanSchema: migratedPlan.schemaVersion,
    components: migratedPlan.components.length,
    images: migratedPlan.components
      .filter((component) => component.type === "reference")
      .reduce((total, component) => total + component.images.length, 0),
    changed: serialized !== source,
    repairsMislabeledV11,
    mode: write ? "write" : "dry-run",
  }, null, 2));

  if (!write || serialized === source) return;

  const backupPath = `${manifestPath}.pre-schema-v${migratedPlan.schemaVersion}-${timestamp()}.backup`;
  const temporaryPath = `${manifestPath}.migration-${process.pid}.tmp`;
  const previousPath = `${manifestPath}.migration-${process.pid}.previous`;
  await copyFile(manifestPath, backupPath);
  await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });

  try {
    await rename(manifestPath, previousPath);
    try {
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      await rename(previousPath, manifestPath);
      throw error;
    }
    await rm(previousPath, { force: true });
  } finally {
    await rm(temporaryPath, { force: true });
  }

  const persisted = parseManifest(await readFile(manifestPath, "utf8"), manifestPath);
  const verified = migratePlan(persisted.plan, { projectName: persisted.name });
  if (verified.schemaVersion !== migratedPlan.schemaVersion) {
    throw new Error("Persisted project failed post-migration verification");
  }
  console.log(JSON.stringify({ backupPath, verifiedPlanSchema: verified.schemaVersion }, null, 2));
}

await main();
