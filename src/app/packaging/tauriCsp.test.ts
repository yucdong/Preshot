import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as {
  app?: {
    security?: {
      csp?: string;
    };
  };
};

function parseDirectives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      }),
  );
}

describe("Tauri production CSP", () => {
  const csp = config.app?.security?.csp;

  it("allows only the script and connection sources required by React-PDF", () => {
    expect(csp).toBeTypeOf("string");
    const directives = parseDirectives(csp ?? "");

    expect(directives.get("script-src")).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
    ]);
    expect(directives.get("connect-src")).toEqual([
      "'self'",
      "ipc:",
      "http://ipc.localhost",
    ]);
  });

  it("preserves the existing restrictive asset directives", () => {
    const directives = parseDirectives(csp ?? "");

    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("img-src")).toEqual(["'self'", "data:"]);
    expect(directives.get("media-src")).toEqual(["'self'", "data:"]);
    expect(directives.get("style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  it("does not allow hosted proxies or broad network origins", () => {
    const directives = parseDirectives(csp ?? "");
    const allowedIpcOrigin = "http://ipc.localhost";
    const externalNetworkSources = [...directives.values()]
      .flat()
      .filter(
        (source) =>
          /^(?:https?|wss?):/.test(source) && source !== allowedIpcOrigin,
      );

    expect(externalNetworkSources).toEqual([]);
    expect([...directives.values()].flat()).not.toContain("*");
    expect(directives.get("connect-src")).not.toContain("https:");
    expect(directives.get("connect-src")).not.toContain("http:");
    expect(directives.get("script-src") ?? []).not.toContain("'unsafe-eval'");
  });
});
