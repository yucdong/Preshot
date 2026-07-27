import { describe, expect, it, vi } from "vitest";
import { createWorkspaceDirectoryPicker } from "./workspaceDialog";

function expectErrorWithCause(
  error: unknown,
  message: string,
  cause: unknown,
): void {
  expect(error).toBeInstanceOf(Error);

  if (!(error instanceof Error)) {
    throw error;
  }

  expect(error.message).toBe(message);
  expect(error.cause).toBe(cause);
}

describe("createWorkspaceDirectoryPicker", () => {
  it("returns the selected directory path", async () => {
    const openDialog = vi.fn().mockResolvedValue("C:\\shoots");
    const picker = createWorkspaceDirectoryPicker({ openDialog });

    await expect(picker.pickDirectory("Select workspace")).resolves.toBe(
      "C:\\shoots",
    );
    expect(openDialog).toHaveBeenCalledWith({
      title: "Select workspace",
      directory: true,
      multiple: false,
    });
  });

  it("returns null when the directory picker is cancelled", async () => {
    const openDialog = vi.fn().mockResolvedValue(null);
    const picker = createWorkspaceDirectoryPicker({ openDialog });

    await expect(picker.pickDirectory("Select workspace")).resolves.toBeNull();
  });

  it.each([
    [["C:\\shoots"]],
    [42],
    [undefined],
  ])(
    "rejects unexpected dialog responses: %j",
    async (response: unknown) => {
      const openDialog = vi.fn().mockResolvedValue(response);
      const picker = createWorkspaceDirectoryPicker({ openDialog });

      await expect(picker.pickDirectory("Select workspace")).rejects.toThrow(
        "Unable to select workspace directory: Unexpected dialog response",
      );
    },
  );

  it("wraps plugin failures with operation context and cause", async () => {
    const failure = new Error("dialog unavailable");
    const openDialog = vi.fn().mockRejectedValue(failure);
    const picker = createWorkspaceDirectoryPicker({ openDialog });

    try {
      await picker.pickDirectory("Select workspace");
    } catch (error) {
      expectErrorWithCause(
        error,
        "Unable to select workspace directory: dialog unavailable",
        failure,
      );
      return;
    }

    throw new Error("Expected pickDirectory() to reject");
  });

  it("surfaces structured dialog failure messages", async () => {
    const failure = {
      message: "dialog unavailable",
    };
    const openDialog = vi.fn().mockRejectedValue(failure);
    const picker = createWorkspaceDirectoryPicker({ openDialog });

    try {
      await picker.pickDirectory("Select workspace");
    } catch (error) {
      expectErrorWithCause(
        error,
        "Unable to select workspace directory: dialog unavailable",
        failure,
      );
      return;
    }

    throw new Error("Expected pickDirectory() to reject");
  });
});
