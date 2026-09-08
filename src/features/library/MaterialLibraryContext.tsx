import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { MaterialDetail, MaterialMetadata, MaterialSnapshot, MaterialSummary } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { MaterialBrowser, type MaterialBrowserPreferences } from "./MaterialBrowser";
import { MaterialSaveDialog } from "./MaterialSaveDialog";
import "./material-library.css";

export interface MaterialBrowserInput {
  targetLabel: string;
  onInsert(material: MaterialSummary): Promise<void>;
}

export interface MaterialSaveInput {
  snapshot: MaterialSnapshot;
  projectName: string;
  onSave(metadata: MaterialMetadata): Promise<MaterialDetail>;
}

export interface MaterialLibraryController {
  repository: MaterialLibraryRepository;
  openBrowser(input?: MaterialBrowserInput): void;
  registerDocumentBrowser(open: () => void): () => void;
  openSave(input: MaterialSaveInput): void;
  close(): void;
}

export interface MaterialLibraryProviderProps {
  repository: MaterialLibraryRepository;
  children: ReactNode;
  renderPreview?: (material: MaterialDetail) => ReactNode;
  createPreview?: (material: MaterialDetail) => Promise<void>;
}

type Session =
  | { id: number; kind: "browser"; input?: MaterialBrowserInput; preferences: MaterialBrowserPreferences }
  | { id: number; kind: "save"; input: MaterialSaveInput };

const Context = createContext<MaterialLibraryController | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalMaterialLibrary(): MaterialLibraryController | null {
  return useContext(Context);
}

export function MaterialLibraryProvider({
  repository, children, renderPreview, createPreview,
}: MaterialLibraryProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const sequence = useRef(0);
  const documentBrowser = useRef<(() => void) | null>(null);
  const preferences = useRef<MaterialBrowserPreferences>({
    query: "", filter: "all", sort: "auto", page: 0, selectedId: null,
  });
  const close = useCallback(() => {
    sequence.current += 1;
    setSession(null);
  }, []);
  const openBrowser = useCallback((input?: MaterialBrowserInput) => {
    if (input === undefined && documentBrowser.current) {
      documentBrowser.current();
      return;
    }
    setSession({ id: ++sequence.current, kind: "browser", input, preferences: preferences.current });
  }, []);
  const registerDocumentBrowser = useCallback((open: () => void) => {
    documentBrowser.current = open;
    return () => {
      if (documentBrowser.current === open) documentBrowser.current = null;
    };
  }, []);
  const openSave = useCallback((input: MaterialSaveInput) => {
    setSession({
      id: ++sequence.current, kind: "save",
      input: { ...input, snapshot: structuredClone(input.snapshot) },
    });
  }, []);
  const controller = useMemo(() => ({
    repository, openBrowser, registerDocumentBrowser, openSave, close,
  }), [repository, openBrowser, registerDocumentBrowser, openSave, close]);
  const closeSession = (id: number) => {
    if (sequence.current === id) close();
  };

  return <Context.Provider value={controller}>
    {children}
    {session?.kind === "browser" && <MaterialBrowser
      key={session.id}
      repository={repository}
      input={session.input}
      initialPreferences={session.preferences}
      onPreferencesChange={(value) => { preferences.current = value; }}
      onClose={() => closeSession(session.id)}
      renderPreview={renderPreview}
      createPreview={createPreview}
    />}
    {session?.kind === "save" && <MaterialSaveDialog
      key={session.id}
      repository={repository}
      input={session.input}
      onClose={() => closeSession(session.id)}
      createPreview={createPreview}
    />}
  </Context.Provider>;
}
