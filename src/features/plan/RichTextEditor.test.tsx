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

  it("does not emit onChange while hydrating non-empty html", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor ariaLabel="Notes" html="<p>Seed</p>" onChange={onChange} />);
    await screen.findByText("Seed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not emit onChange while hydrating empty html", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor ariaLabel="Notes" html="" onChange={onChange} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });
});
