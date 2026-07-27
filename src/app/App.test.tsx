import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("shows the Preshot planning workspace", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Preshot" })).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Planning tools" }),
    ).toBeVisible();
    expect(screen.getByText("Start your photography plan")).toBeVisible();
    expect(screen.getByText("Canvas")).toBeVisible();
    expect(screen.getByText("Assets")).toBeVisible();
    expect(screen.getByText("Copywriting")).toBeVisible();
    expect(screen.getByText("Export")).toBeVisible();
  });
});
