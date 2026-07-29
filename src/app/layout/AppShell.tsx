import type { PropsWithChildren } from "react";

const tools = [
  { label: "Plan", active: true },
  { label: "Canvas", active: false },
  { label: "Assets", active: false },
  { label: "Copywriting", active: false },
  { label: "Export", active: false },
];

interface AppShellProps extends PropsWithChildren {
  projectName?: string;
}

export function AppShell({ children, projectName }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-stone-950 text-stone-100">
      <header className="flex h-16 items-center border-b border-white/10 px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">Preshot</h1>
          {projectName ? (
            <p className="text-sm text-stone-300">{projectName}</p>
          ) : null}
        </div>
        <span className="ml-3 text-sm text-stone-400">
          Photography planning
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Planning tools"
          className="w-56 border-r border-white/10 p-4"
        >
          <ul className="space-y-1">
            {tools.map((tool) => (
              <li
                aria-current={tool.active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm ${tool.active ? "bg-white/10 text-white" : "text-stone-500"}`}
                key={tool.label}
              >
                {tool.label}
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </div>
    </div>
  );
}
