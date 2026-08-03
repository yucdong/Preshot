import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentPanel } from "./AgentPanel";

describe("AgentPanel", () => {
  it("renders a labelled assistant region with a disabled input and send button", () => {
    render(<AgentPanel />);

    const region = screen.getByRole("complementary", { name: "助手" });
    expect(region).toBeVisible();

    const input = screen.getByLabelText("向助手发送消息");
    expect(input).toBeDisabled();

    const send = screen.getByRole("button", { name: "发送" });
    expect(send).toBeDisabled();
  });
});
