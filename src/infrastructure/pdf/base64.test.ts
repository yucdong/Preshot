// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";

describe("bytesToBase64", () => {
  it("round-trips through atob", () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // %PDF

    expect(atob(bytesToBase64(bytes))).toBe("%PDF");
  });
});
