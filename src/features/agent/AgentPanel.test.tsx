import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentPanel } from "./AgentPanel";

describe("AgentPanel", () => {
  it("renders a labelled assistant region with a disabled input and send button", () => {
    render(<AgentPanel />);

    const region = screen.getByRole("complementary", { name: "Assistant" });
    expect(region).toBeVisible();

    const input = screen.getByLabelText("Message the assistant");
    expect(input).toBeDisabled();

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
  });
});
