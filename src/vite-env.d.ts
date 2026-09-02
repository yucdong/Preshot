/// <reference types="vite/client" />

declare module "modern-screenshot/worker?url&no-inline" {
  const workerUrl: string;
  export default workerUrl;
}

interface Window {
  readonly __PRESHOT_AGENT_TEST__?: {
    createSession(title?: string): Promise<string>;
    send(text: string): Promise<void>;
    draftTextProposal(text: string): Promise<string>;
    prepareProposal(proposalId: string): Promise<{ readonly status: string }>;
    applyProposal(proposalId: string): Promise<{ readonly status: string }>;
    undoProposal(): Promise<{ readonly status: string }>;
    resumeSession(sessionId: string): Promise<void>;
    documentText(): Promise<string>;
    selectTestImage(): void;
    emitRunning(): void;
    requestProjectSwitch(): Promise<
      "activated" | "choice_required" | "already_queued"
    >;
    snapshot(): {
      readonly projectId: string | null;
      readonly activeSessionId: string | null;
      readonly status: string | null;
      readonly messages: readonly string[];
      readonly proposals: readonly {
        readonly proposalId: string;
        readonly status: string;
      }[];
      readonly proposalEvents: readonly string[];
      readonly turnAttachments: readonly (string | null)[];
    };
  };
}
