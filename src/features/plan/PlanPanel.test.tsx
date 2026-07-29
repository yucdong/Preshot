import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanPanel } from "./PlanPanel";

const noop = {
  onAddGroup: vi.fn(),
  onRenameGroup: vi.fn(),
  onDeleteGroup: vi.fn(),
  onSetColumns: vi.fn(),
  onAddImage: vi.fn(),
  onRemoveImage: vi.fn(),
  onOpenImage: vi.fn(),
};

describe("PlanPanel", () => {
  it("defaults to Reference Images and switches to the Photography placeholder", async () => {
    const user = userEvent.setup();
    render(<PlanPanel groups={[]} imageSrc={() => undefined} {...noop} />);

    expect(screen.getByRole("button", { name: "Add reference group" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Photography Plan" }));
    expect(screen.getByText(/coming soon/i)).toBeVisible();
  });
});
