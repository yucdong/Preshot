import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTheme } from "./ThemeContext";
import { ThemeProvider } from "./ThemeProvider";
import type { SettingsRepository } from "../../domain/settings/ports";
import type { AppSettings } from "../../domain/settings/models";

// Helper component to access and display theme context
function TestConsumer() {
  const {
    theme,
    resolved,
    setTheme,
    projectRailWidth,
    assistantWidth,
    assistantOpen,
    setAssistantOpen,
    setPanelWidths,
  } = useTheme();
  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <div data-testid="resolved">{resolved}</div>
      <div data-testid="panel-widths">{projectRailWidth},{assistantWidth}</div>
      <div data-testid="assistant-open">{String(assistantOpen)}</div>
      <button onClick={() => setTheme("dark")}>Set Dark</button>
      <button onClick={() => setTheme("light")}>Set Light</button>
      <button onClick={() => setTheme("system")}>Set System</button>
      <button onClick={() => setPanelWidths({ projectRailWidth: 260, assistantWidth: 360 })}>
        Set Panels
      </button>
      <button onClick={() => setAssistantOpen(true)}>Open Assistant</button>
    </div>
  );
}

// Helper to create a mock SettingsRepository
function createMockRepository(
  initialSettings: AppSettings = { theme: "system" }
): SettingsRepository {
  return {
    read: vi.fn().mockResolvedValue(initialSettings),
    write: vi.fn().mockResolvedValue(undefined),
  };
}

// Helper to create a controllable matchMedia mock
function createMatchMediaMock(initialMatches: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  let matches = initialMatches;

  const mockMatchMedia = vi.fn((query: string) => {
    const mql = {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
        if (event === "change") {
          listeners.push(listener);
        }
      }),
      removeEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
        if (event === "change") {
          const index = listeners.indexOf(listener);
          if (index !== -1) {
            listeners.splice(index, 1);
          }
        }
      }),
      dispatchEvent: vi.fn(),
    };
    return mql;
  });

  const setMatches = (newMatches: boolean) => {
    matches = newMatches;
    listeners.forEach((listener) => {
      listener({ matches: newMatches } as MediaQueryListEvent);
    });
  };

  return { mockMatchMedia, setMatches, getListenerCount: () => listeners.length };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    // Clean up DOM between tests
    document.documentElement.classList.remove("dark");
  });

  it("applies dark class when repository returns theme: 'dark'", async () => {
    const repository = createMockRepository({ theme: "dark" });

    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("dark");
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("removes dark class when repository returns theme: 'light'", async () => {
    const repository = createMockRepository({ theme: "light" });

    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("light");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });

  it("follows matchMedia when theme is 'system' and matches is true", async () => {
    const repository = createMockRepository({ theme: "system" });
    const { mockMatchMedia } = createMatchMediaMock(true);
    globalThis.matchMedia = mockMatchMedia as unknown as typeof globalThis.matchMedia;

    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("system");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("follows matchMedia when theme is 'system' and matches is false", async () => {
    const repository = createMockRepository({ theme: "system" });
    const { mockMatchMedia } = createMatchMediaMock(false);
    globalThis.matchMedia = mockMatchMedia as unknown as typeof globalThis.matchMedia;

    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("system");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });

  it("updates dark class when matchMedia changes during 'system' theme", async () => {
    const repository = createMockRepository({ theme: "system" });
    const { mockMatchMedia, setMatches } = createMatchMediaMock(false);
    globalThis.matchMedia = mockMatchMedia as unknown as typeof globalThis.matchMedia;

    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("system");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Simulate OS theme change to dark
    setMatches(true);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("calls repository.write and updates class when setTheme is called", async () => {
    const repository = createMockRepository({ theme: "light" });

    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("light");
    });

    // Click the "Set Dark" button
    screen.getByText("Set Dark").click();

    await waitFor(() => {
      expect(repository.write).toHaveBeenCalledWith({
        theme: "dark",
        projectRailWidth: 192,
        assistantWidth: 272,
        assistantOpen: false,
      });
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("unsubscribes from matchMedia when theme changes from 'system'", async () => {
    const repository = createMockRepository({ theme: "system" });
    const { mockMatchMedia, getListenerCount } = createMatchMediaMock(true);
    globalThis.matchMedia = mockMatchMedia as unknown as typeof globalThis.matchMedia;

    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("system");
    });

    // Should have a listener when theme is 'system'
    expect(getListenerCount()).toBeGreaterThan(0);

    // Change to explicit theme
    screen.getByText("Set Light").click();

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("light");
    });

    // Listener should be cleaned up
    expect(getListenerCount()).toBe(0);
  });

  it("persists global panel widths with the current theme", async () => {
    const repository = createMockRepository({ theme: "light" });
    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("light"));

    screen.getByText("Set Panels").click();

    await waitFor(() => expect(screen.getByTestId("panel-widths")).toHaveTextContent("260,360"));
    expect(repository.write).toHaveBeenCalledWith({
      theme: "light",
      projectRailWidth: 260,
      assistantWidth: 360,
      assistantOpen: false,
    });
  });

  it("defaults assistant visibility closed and persists opening it", async () => {
    const repository = createMockRepository({ theme: "light" });
    render(
      <ThemeProvider repository={repository}>
        <TestConsumer />
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("assistant-open")).toHaveTextContent("false")
    );
    screen.getByText("Open Assistant").click();
    await waitFor(() =>
      expect(screen.getByTestId("assistant-open")).toHaveTextContent("true")
    );
    expect(repository.write).toHaveBeenLastCalledWith({
      theme: "light",
      projectRailWidth: 192,
      assistantWidth: 272,
      assistantOpen: true,
    });
  });

  it("throws error when useTheme is used outside provider", () => {
    // Suppress console.error for this test
    const originalError = console.error;
    console.error = vi.fn();

    expect(() => {
      render(<TestConsumer />);
    }).toThrow("useTheme must be used within a ThemeProvider");

    console.error = originalError;
  });
});
