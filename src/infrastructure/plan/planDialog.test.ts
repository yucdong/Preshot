import { describe, expect, it, vi } from "vitest";
import { createPlanImagePicker } from "./planDialog";

describe("createPlanImagePicker", () => {
  it("requests a single jpg/png file and returns the path", async () => {
    const openDialog = vi.fn().mockResolvedValue("C:\\src\\a.png");
    const picker = createPlanImagePicker({ openDialog });

    const path = await picker.pickImageFile("Pick");

    expect(openDialog).toHaveBeenCalledWith({
      title: "Pick",
      directory: false,
      multiple: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
    });
    expect(path).toBe("C:\\src\\a.png");
  });

  it("returns null when cancelled", async () => {
    const picker = createPlanImagePicker({ openDialog: vi.fn().mockResolvedValue(null) });
    await expect(picker.pickImageFile("Pick")).resolves.toBeNull();
  });
});
