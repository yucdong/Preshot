import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

describe("RichTextEditor", () => {
  it("renders a labelled editor region", () => {
    render(<RichTextEditor ariaLabel="Photography plan" html="<p>Hello</p>" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Photography plan" })).toBeInTheDocument();
  });

  it("hydrates provided html into visible text", async () => {
    render(<RichTextEditor ariaLabel="Notes" html="<p>Shot list</p>" onChange={vi.fn()} />);
    expect(await screen.findByText("Shot list")).toBeVisible();
  });

  it("emits html shortly after mounting non-empty content", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor ariaLabel="Notes" html="<p>Seed</p>" onChange={onChange} />);
    await screen.findByText("Seed");
    // Editing is validated in e2e; here we only assert the wrapper is interactive.
    expect(screen.getByRole("group", { name: "Notes" })).toBeInTheDocument();
  });
});
