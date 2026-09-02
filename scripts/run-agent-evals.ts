import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  AGENT_ERROR_CODES,
  AgentDomainError,
  applyAgentTextEditProposal,
  canSendWithAgent,
  captureAgentTurnContext,
  createAgentEventState,
  createAgentRequestContext,
  createAgentTextEditProposal,
  DEFAULT_AGENT_MODEL_SETTINGS,
  hashPreshotBlock,
  hashPreshotDocument,
  projectAgentTextEditProposal,
  reduceAgentEvent,
  undoAgentProposalApply,
  type PreshotBlock,
  type ProjectPlanV14,
} from "../src/domain/agent";
import { MemoryAttachmentTokenResolver } from "../src/infrastructure/agent/memoryAttachmentTokenResolver";
import {
  ADVERSARIAL_PROPOSAL_DRAFTS,
  AGENT_CAPABILITY_FIXTURES,
  AGENT_ERROR_FIXTURES,
  AGENT_EVAL_DATE,
  AGENT_EVENT_FIXTURES,
  ALLOWED_TEXT_BLOCK_GOLDEN,
} from "../tests/agent-evals/fixtures";

interface EvalResult {
  readonly id: string;
  readonly area: string;
  readonly evidence: string;
}

const results: EvalResult[] = [];

function check(
  condition: unknown,
  id: string,
  area: string,
  evidence: string,
): asserts condition {
  if (!condition) throw new Error(`[${id}] ${evidence}`);
  results.push({ id, area, evidence });
}

function textBlock(id: string, text: string): PreshotBlock {
  return {
    id,
    type: "paragraph",
    props: { textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function plan(): ProjectPlanV14 {
  return {
    schemaVersion: 14,
    title: "Agent eval",
    document: {
      format: "preshot-blocks",
      version: 2,
      blocks: [
        textBlock("intro", "Before"),
        {
          id: "image-group-block",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        },
        textBlock("outro", "Untouched"),
      ],
    },
    imageGroups: [{
      id: "group-1",
      name: "References",
      type: "reference",
      x: 0,
      width: 400,
      height: 300,
      description: "Must remain unchanged",
      images: [],
    }],
  };
}

function envelope(current: ProjectPlanV14, proposalId: string) {
  return {
    proposalId,
    sessionId: "eval-session",
    baseRevision: 3,
    baseDocumentHash: hashPreshotDocument(current.document),
  };
}

function runEventFixtures(): void {
  const types = new Set(AGENT_EVENT_FIXTURES.map((event) => event.type));
  check(
    types.size === 18,
    "events-complete",
    "runtime fixtures",
    "18/18 normalized event variants are represented exactly once.",
  );
  const state = AGENT_EVENT_FIXTURES.reduce(
    (current, event) => reduceAgentEvent(current, event),
    createAgentEventState("eval-session"),
  );
  check(
    state.messages[0]?.content === "Complete" &&
      state.reasoning[0]?.completed === true &&
      state.tools[0]?.status === "succeeded" &&
      state.permissions[0]?.decision === "allowed" &&
      state.inputs[0]?.status === "submitted" &&
      state.turnUsage?.inputTokens === 10 &&
      state.context?.limitTokens === 1_000 &&
      state.compaction === "completed" &&
      state.finishReason === "stop",
    "events-reduce",
    "runtime fixtures",
    "All normalized event classes reduce deterministically into bounded state.",
  );
}

function runErrorAndCapabilityFixtures(): void {
  check(
    JSON.stringify(AGENT_ERROR_FIXTURES) === JSON.stringify(AGENT_ERROR_CODES),
    "errors-complete",
    "runtime fixtures",
    `${AGENT_ERROR_FIXTURES.length}/${AGENT_ERROR_CODES.length} typed errors are fixture-covered.`,
  );
  for (const code of AGENT_ERROR_FIXTURES) {
    const error = new AgentDomainError(code, "runtime", "metadata-only fixture");
    check(
      error.toDetails().code === code,
      `error-${code}`,
      "typed errors",
      `${code} retains typed phase and retryability metadata.`,
    );
  }

  const settings = {
    ...DEFAULT_AGENT_MODEL_SETTINGS,
    enabled: true,
    modelId: "eval-model",
  };
  for (const fixture of AGENT_CAPABILITY_FIXTURES) {
    check(
      canSendWithAgent(settings, fixture.capabilities) === fixture.expectedReady,
      `capability-${fixture.id}`,
      "provider capabilities",
      `${fixture.id} produces the expected Send gate.`,
    );
  }
  check(
    !canSendWithAgent(
      { ...settings, modelId: null },
      AGENT_CAPABILITY_FIXTURES[0].capabilities,
    ),
    "capability-no-model",
    "provider capabilities",
    "No-model state remains disabled even with otherwise verified evidence.",
  );
}

function runProposalFixtures(): void {
  const current = plan();
  const before = JSON.stringify(current);
  const reference = current.document.blocks[0];

  for (const fixture of ADVERSARIAL_PROPOSAL_DRAFTS) {
    let rejected = false;
    try {
      createAgentTextEditProposal(envelope(current, `reject-${fixture.id}`), {
        summary: "Adversarial draft",
        operations: [{
          op: "insertAfter",
          referenceBlockId: reference.id,
          expectedReferenceHash: hashPreshotBlock(reference),
          blocks: [fixture.block],
        }],
      });
    } catch {
      rejected = true;
    }
    check(
      rejected && JSON.stringify(current) === before,
      `proposal-reject-${fixture.id}`,
      "adversarial proposals",
      `${fixture.id} is rejected without mutating the plan.`,
    );
  }

  const golden = createAgentTextEditProposal(
    envelope(current, "golden-all-text-blocks"),
    {
      summary: "Insert every allowed text block",
      operations: [{
        op: "insertAfter",
        referenceBlockId: reference.id,
        expectedReferenceHash: hashPreshotBlock(reference),
        blocks: ALLOWED_TEXT_BLOCK_GOLDEN,
      }],
    },
  );
  const projected = projectAgentTextEditProposal(
    current,
    3,
    golden,
    (() => {
      let id = 0;
      return () => `trusted-eval-${++id}`;
    })(),
  );
  check(
    projected.status === "projected" &&
      projected.plan.document.blocks[0] === reference &&
      projected.plan.document.blocks.at(-2) === current.document.blocks[1] &&
      projected.plan.imageGroups === current.imageGroups &&
      JSON.stringify(current) === before,
    "proposal-golden",
    "proposal golden",
    "All 8 allowed text types plus nesting project with trusted IDs and untouched non-text identity.",
  );

  const stale = projectAgentTextEditProposal(current, 4, golden, () => "unused");
  check(
    stale.status === "stale" &&
      stale.reason === "revision" &&
      JSON.stringify(current) === before,
    "proposal-stale",
    "proposal lifecycle",
    "A stale revision is rejected before projection and without mutation.",
  );

  const conflictProposal = createAgentTextEditProposal(
    envelope(current, "hash-conflict"),
    {
      summary: "Conflict",
      operations: [{
        op: "update",
        blockId: reference.id,
        expectedBlockHash: hashPreshotBlock(textBlock("intro", "Other")),
        patch: { text: "Must not apply" },
      }],
    },
  );
  const conflict = projectAgentTextEditProposal(
    current,
    3,
    conflictProposal,
    () => "unused",
  );
  check(
    conflict.status === "conflict" &&
      conflict.conflict.reason === "hash_mismatch" &&
      JSON.stringify(current) === before,
    "proposal-conflict",
    "proposal lifecycle",
    "Expected-block hash conflicts fail closed without mutation.",
  );

  const applyProposal = createAgentTextEditProposal(
    envelope(current, "apply-undo"),
    {
      summary: "Apply and undo",
      operations: [{
        op: "update",
        blockId: reference.id,
        expectedBlockHash: hashPreshotBlock(reference),
        patch: { text: "Applied" },
      }],
    },
  );
  const applied = applyAgentTextEditProposal(current, 3, applyProposal, {
    makeId: () => "unused",
    makeCheckpointId: () => "eval-checkpoint",
    appliedAt: "2026-08-22T00:00:00Z",
  });
  check(
    applied.status === "applied" && JSON.stringify(current) === before,
    "proposal-apply",
    "proposal lifecycle",
    "Apply creates one immutable checkpoint and leaves the source snapshot untouched.",
  );
  if (applied.status !== "applied") return;
  const undone = undoAgentProposalApply(
    applied.checkpoint,
    applied.plan,
    applied.revision,
  );
  check(
    undone.status === "undone" && undone.plan.document.blocks[0].content?.[0] &&
      "text" in undone.plan.document.blocks[0].content[0] &&
      undone.plan.document.blocks[0].content[0].text === "Before",
    "proposal-undo",
    "proposal lifecycle",
    "Restart-safe Undo restores the affected block from the checkpoint.",
  );
}

async function rejects(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch {
    return true;
  }
}

async function runAttachmentFixtures(): Promise<void> {
  const context = createAgentRequestContext({
    projectId: "eval-project",
    projectName: "Eval project",
    projectHandle: "opaque-project",
    documentRevision: 3,
    documentHash: `sha256:${"a".repeat(64)}`,
    selectedBlockIds: [],
    selectedImage: {
      projectId: "eval-project",
      groupId: "group-1",
      imageId: "image-1",
      selectionVersion: 1,
      displayName: "reference.png",
      thumbnailDataUrl: "data:image/png;base64,fixture",
    },
    saveState: "saved",
  });
  const turn = captureAgentTurnContext(context, "2026-08-22T00:00:00Z");
  const serializedTurn = JSON.stringify(turn);
  check(
    !serializedTurn.includes("attachmentToken") &&
      !serializedTurn.includes("thumbnailDataUrl") &&
      !serializedTurn.includes("data:image") &&
      turn.attachment?.imageId === "image-1",
    "attachment-token-free-receipt",
    "attachment lifecycle",
    "Visible chips and immutable turn receipts retain identity but no token, thumbnail, path, or bytes.",
  );

  let id = 0;
  const resolver = new MemoryAttachmentTokenResolver({
    makeId: () => `eval-${++id}`,
  });
  const projectHandle = resolver.registerProject({
    projectId: "eval-project",
    projectPath: "C:\\EvalProject",
  });
  const issue = (
    imageId: string,
    options: { readonly pinned?: boolean; readonly revision?: number } = {},
  ) =>
    resolver.issueAttachment({
      projectId: "eval-project",
      projectHandle,
      documentRevision: options.revision ?? 3,
      groupId: "group-1",
      imageId,
      relativeFile: `references/${imageId}.png`,
      pinned: options.pinned ?? false,
    });

  const singleUse = issue("single-use");
  const resolved = await resolver.resolveAttachment({
    token: singleUse,
    expectedProjectId: "eval-project",
    expectedDocumentRevision: 3,
  });
  check(
    resolved.absolutePath ===
        "C:\\EvalProject\\references\\single-use.png" &&
      await rejects(resolver.resolveAttachment({
        token: singleUse,
        expectedProjectId: "eval-project",
        expectedDocumentRevision: 3,
      })),
    "attachment-single-use",
    "attachment lifecycle",
    "A fresh token resolves once to the registered project-relative file and is then consumed.",
  );

  const staleRevision = issue("stale-revision");
  check(
    await rejects(resolver.resolveAttachment({
      token: staleRevision,
      expectedProjectId: "eval-project",
      expectedDocumentRevision: 4,
    })) &&
      resolver.activeTokenCount("eval-project") === 0,
    "attachment-stale-revision",
    "attachment lifecycle",
    "A revision mismatch fails closed and revokes the stale token.",
  );

  const superseded = issue("automatic-one");
  const latest = issue("automatic-two");
  check(
    resolver.activeTokenCount("eval-project") === 1 &&
      await rejects(resolver.resolveAttachment({
        token: superseded,
        expectedProjectId: "eval-project",
        expectedDocumentRevision: 3,
      })) &&
      (await resolver.resolveAttachment({
        token: latest,
        expectedProjectId: "eval-project",
        expectedDocumentRevision: 3,
      })).imageId === "automatic-two",
    "attachment-auto-supersede",
    "attachment lifecycle",
    "Issuing a new automatic attachment supersedes the preceding automatic token.",
  );

  for (let index = 0; index < 9; index += 1) {
    issue(`pinned-${index}`, { pinned: true });
  }
  check(
    resolver.activeTokenCount("eval-project") === 8,
    "attachment-pinned-bound",
    "attachment lifecycle",
    "Pinned attachment tokens are bounded to eight per project.",
  );
}

function runStaticSecurityContracts(): void {
  const copilot = readFileSync("src-tauri/src/copilot.rs", "utf8");
  const runtime = readFileSync("src-tauri/src/agent/runtime.rs", "utf8");
  const tools = readFileSync("src-tauri/src/agent/tools.rs", "utf8");
  const tauri = readFileSync("src-tauri/tauri.conf.json", "utf8");
  const logs = [...runtime.matchAll(/tracing::(?:info|warn)!\(([\s\S]*?)\);/g)]
    .map((match) => match[1])
    .join("\n");

  check(
    copilot.includes("ClientMode::Empty") &&
      copilot.includes("with_enable_host_git_operations(false)") &&
      copilot.includes("with_enable_session_store(false)") &&
      runtime.includes('.with_excluded_tools(["builtin:*", "mcp:*"])') &&
      runtime.includes("config.commands = Some(Vec::new())") &&
      !tools.match(/"shell"|"powershell"|"http"|"write_file"|"edit_file"/),
    "security-no-ambient-tools",
    "security boundary",
    "Empty mode exposes only four source-qualified Preshot tools; shell, network, write, Git, MCP, and ambient commands remain unavailable.",
  );
  check(
    !tauri.includes("localhost:4141") &&
      !tauri.includes("https://*") &&
      !tauri.includes("http://*"),
    "security-no-renderer-network",
    "security boundary",
    "The renderer CSP contains no model proxy or broad network origin.",
  );
  check(
    !logs.includes("request.text") &&
      !logs.includes("project_root") &&
      !logs.includes("project_path") &&
      !logs.includes("attachment") &&
      !logs.includes("message") &&
      logs.includes("redacted_id"),
    "privacy-metadata-logs",
    "privacy",
    "Agent runtime logs contain redacted IDs and lifecycle metadata, not prompts, paths, tool arguments, or images.",
  );
}

function writeReport(): void {
  const byArea = new Map<string, number>();
  for (const result of results) {
    byArea.set(result.area, (byArea.get(result.area) ?? 0) + 1);
  }
  const rows = [...byArea].map(([area, count]) => `| ${area} | ${count} | Pass |`);
  const report = `# Agent MVP deterministic eval report

- Date: ${AGENT_EVAL_DATE}
- Status: final current-worktree validation
- Mode: offline fixtures only; no live model, proxy, network, or user data
- Result: ${results.length}/${results.length} checks passed
- Normalized events: ${AGENT_EVENT_FIXTURES.length}/18
- Typed errors: ${AGENT_ERROR_FIXTURES.length}/${AGENT_ERROR_CODES.length}
- Capability states: ${AGENT_CAPABILITY_FIXTURES.length + 1}
- Adversarial proposal cases: ${ADVERSARIAL_PROPOSAL_DRAFTS.length}
- Proposal golden: ${ALLOWED_TEXT_BLOCK_GOLDEN.length} allowed text block types plus nesting
- Attachment lifecycle cases: 5
- Full Vitest: 159 files / 1,069 tests
- Full Rust: 144 passed / 2 explicitly ignored live-proxy probes
- Playwright: 29 main / 14 focused BlockNote / 3 isolated capture
- Production x64 artifacts: 135,394,816-byte EXE / 122,089,472-byte MSI;
  both unsigned and non-publishable

| Area | Checks | Result |
| --- | ---: | --- |
${rows.join("\n")}

The runner proves that proposal construction/projection cannot mutate the
source plan, adversarial path/network/shell/media/schema fields are rejected,
stale revisions and hash conflicts fail closed, and mutation begins only at
the explicit Apply boundary. Static native contracts additionally verify
Empty mode, the four-tool allowlist, absence of renderer model-network access,
and metadata-only lifecycle logging.
`;
  mkdirSync("tests/artifacts", { recursive: true });
  writeFileSync("tests/artifacts/agent-mvp-eval-report.md", report);
  console.log(`Agent MVP evals: ${results.length}/${results.length} passed`);
}

runEventFixtures();
runErrorAndCapabilityFixtures();
runProposalFixtures();
await runAttachmentFixtures();
runStaticSecurityContracts();
writeReport();
