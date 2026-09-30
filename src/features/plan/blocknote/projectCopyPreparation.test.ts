import { describe, expect, it, vi } from "vitest";
import { prepareProjectCopy } from "./projectCopyPreparation";

describe("project copy preparation", () => {
  it("commits field drafts and waits for media before saving, retaining the lease until copying ends", async () => {
    const events: string[] = [];
    let finish!: () => void;
    const media = new Promise<void>(resolve => { finish = resolve; });
    const task = prepareProjectCopy({ freeze: () => { events.push("freeze"); return () => { events.push("release"); }; },
      flushFields: () => { events.push("fields"); }, drain: async () => { events.push("drain"); await media; },
      flushDocument: () => { events.push("document"); }, save: async () => { events.push("save"); } });
    expect(events).toEqual(["freeze", "fields", "drain"]);
    finish(); const release = await task;
    expect(events).toEqual(["freeze", "fields", "drain", "document", "save"]);
    release(); release(); expect(events.filter(v => v === "release")).toHaveLength(1);
  });
  it("releases the original editor if saving fails", async () => {
    const release = vi.fn();
    await expect(prepareProjectCopy({ freeze: () => release, flushFields: vi.fn(), drain: vi.fn(), flushDocument: vi.fn(), save: vi.fn().mockRejectedValue(new Error("save failed")) })).rejects.toThrow("save failed");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
