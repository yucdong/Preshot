import type {
  BlockProps,
  PreshotBlock,
  PreshotBlockDocument,
  PreshotBlockType,
} from "../plan/canvas/blockDocument";
import { AgentDomainError } from "./errors";

export const AGENT_TEXT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "codeBlock",
] as const satisfies readonly PreshotBlockType[];

export type AgentTextBlockType = (typeof AGENT_TEXT_BLOCK_TYPES)[number];
export type AgentTextAlignment = "left" | "center" | "right" | "justify";

export interface AllowedTextBlockProps {
  readonly textAlignment?: AgentTextAlignment;
  readonly textColor?: string;
  readonly backgroundColor?: string;
  readonly level?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly checked?: boolean;
  readonly language?: string;
}

export interface AllowedTextBlockPatch {
  readonly type?: AgentTextBlockType;
  readonly text?: string;
  readonly props?: AllowedTextBlockProps;
}

export interface AllowedTextBlockDraft {
  readonly type: AgentTextBlockType;
  readonly text: string;
  readonly props?: AllowedTextBlockProps;
  readonly children?: readonly AllowedTextBlockDraft[];
}

export type AgentTextEditOperation =
  | {
      readonly op: "update";
      readonly blockId: string;
      readonly expectedBlockHash: string;
      readonly patch: AllowedTextBlockPatch;
    }
  | {
      readonly op: "insertBefore" | "insertAfter";
      readonly referenceBlockId: string;
      readonly expectedReferenceHash: string;
      readonly blocks: readonly AllowedTextBlockDraft[];
    }
  | {
      readonly op: "delete";
      readonly blockId: string;
      readonly expectedBlockHash: string;
    };

export interface AgentTextEditProposal {
  readonly version: 1;
  readonly proposalId: string;
  readonly sessionId: string;
  readonly baseRevision: number;
  readonly baseDocumentHash: string;
  readonly summary: string;
  readonly operations: readonly AgentTextEditOperation[];
}

export interface AgentProposalLimits {
  readonly maxOperations: number;
  readonly maxInsertedBlocks: number;
  readonly maxTextCharactersPerBlock: number;
  readonly maxTotalTextCharacters: number;
  readonly maxNestingDepth: number;
  readonly maxSummaryCharacters: number;
}

export const DEFAULT_AGENT_PROPOSAL_LIMITS: AgentProposalLimits = {
  maxOperations: 50,
  maxInsertedBlocks: 100,
  maxTextCharactersPerBlock: 20_000,
  maxTotalTextCharacters: 100_000,
  maxNestingDepth: 8,
  maxSummaryCharacters: 500,
};

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMMON_PROP_KEYS = [
  "textAlignment",
  "textColor",
  "backgroundColor",
] as const;

function invalid(message: string): never {
  throw new AgentDomainError(
    "proposal_invalid",
    "proposal",
    message,
    { recovery: "Ask the assistant to regenerate the proposal." },
  );
}

function recordOf(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const extra = Object.keys(record).find((key) => !allowed.includes(key));
  if (extra) invalid(`${context} contains unsupported field "${extra}"`);
}

function identifier(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    value.length > 200
  ) {
    return invalid(`${context} must be a trimmed identifier`);
  }
  return value;
}

function hashValue(value: unknown, context: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    return invalid(`${context} must be a canonical SHA-256 hash`);
  }
  return value;
}

export function isAgentTextBlockType(
  type: PreshotBlockType,
): type is AgentTextBlockType {
  return (AGENT_TEXT_BLOCK_TYPES as readonly string[]).includes(type);
}

function textBlockType(value: unknown, context: string): AgentTextBlockType {
  if (
    typeof value !== "string" ||
    !(AGENT_TEXT_BLOCK_TYPES as readonly string[]).includes(value)
  ) {
    return invalid(`${context} is not an allowed text block type`);
  }
  return value as AgentTextBlockType;
}

function colorValue(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    value.length > 64 ||
    !/^(default|[a-z][a-z0-9_-]{0,31}|#[0-9a-fA-F]{3,8})$/.test(value)
  ) {
    return invalid(`${context} is not an allowed color`);
  }
  return value;
}

function normalizeProps(
  raw: unknown,
  type: AgentTextBlockType | undefined,
  context: string,
): AllowedTextBlockProps | undefined {
  if (raw === undefined) return undefined;
  const value = recordOf(raw, context);
  const typeKeys = type === undefined
    ? ["level", "checked", "language"]
    : type === "heading"
    ? ["level"]
    : type === "checkListItem"
      ? ["checked"]
      : type === "codeBlock"
        ? ["language"]
        : [];
  exactKeys(value, [...COMMON_PROP_KEYS, ...typeKeys], context);
  const props: {
    textAlignment?: AgentTextAlignment;
    textColor?: string;
    backgroundColor?: string;
    level?: 1 | 2 | 3 | 4 | 5 | 6;
    checked?: boolean;
    language?: string;
  } = {};
  if (value.textAlignment !== undefined) {
    if (
      value.textAlignment !== "left" &&
      value.textAlignment !== "center" &&
      value.textAlignment !== "right" &&
      value.textAlignment !== "justify"
    ) {
      invalid(`${context}.textAlignment is invalid`);
    }
    props.textAlignment = value.textAlignment;
  }
  if (value.textColor !== undefined) {
    props.textColor = colorValue(value.textColor, `${context}.textColor`);
  }
  if (value.backgroundColor !== undefined) {
    props.backgroundColor = colorValue(
      value.backgroundColor,
      `${context}.backgroundColor`,
    );
  }
  if (value.level !== undefined) {
    if (
      typeof value.level !== "number" ||
      !Number.isInteger(value.level) ||
      value.level < 1 ||
      value.level > 6
    ) {
      invalid(`${context}.level must be an integer from 1 to 6`);
    }
    props.level = value.level as 1 | 2 | 3 | 4 | 5 | 6;
  }
  if (value.checked !== undefined) {
    if (typeof value.checked !== "boolean") {
      invalid(`${context}.checked must be a boolean`);
    }
    props.checked = value.checked;
  }
  if (value.language !== undefined) {
    if (
      typeof value.language !== "string" ||
      value.language.trim() !== value.language ||
      !value.language ||
      value.language.length > 64 ||
      !/^[a-zA-Z0-9_+#.-]+$/.test(value.language)
    ) {
      invalid(`${context}.language is invalid`);
    }
    props.language = value.language;
  }
  return Object.keys(props).length > 0 ? props : {};
}

function boundedText(
  value: unknown,
  context: string,
  limits: AgentProposalLimits,
): string {
  if (
    typeof value !== "string" ||
    value.length > limits.maxTextCharactersPerBlock
  ) {
    return invalid(
      `${context} must be at most ${limits.maxTextCharactersPerBlock} characters`,
    );
  }
  return value;
}

function normalizePatch(
  raw: unknown,
  context: string,
  limits: AgentProposalLimits,
): AllowedTextBlockPatch {
  const value = recordOf(raw, context);
  exactKeys(value, ["type", "text", "props"], context);
  if (Object.keys(value).length === 0) {
    return invalid(`${context} must change at least one field`);
  }
  const type = value.type === undefined
    ? undefined
    : textBlockType(value.type, `${context}.type`);
  return {
    ...(type ? { type } : {}),
    ...(value.text === undefined
      ? {}
      : { text: boundedText(value.text, `${context}.text`, limits) }),
    ...(value.props === undefined
      ? {}
      : {
          props: normalizeProps(
            value.props,
            type,
            `${context}.props`,
          ),
        }),
  };
}

interface DraftCounters {
  insertedBlocks: number;
  textCharacters: number;
}

function normalizeDraft(
  raw: unknown,
  context: string,
  depth: number,
  limits: AgentProposalLimits,
  counters: DraftCounters,
): AllowedTextBlockDraft {
  if (depth > limits.maxNestingDepth) {
    return invalid(
      `${context} exceeds maximum nesting depth ${limits.maxNestingDepth}`,
    );
  }
  const value = recordOf(raw, context);
  exactKeys(value, ["type", "text", "props", "children"], context);
  const type = textBlockType(value.type, `${context}.type`);
  const text = boundedText(value.text, `${context}.text`, limits);
  counters.insertedBlocks += 1;
  counters.textCharacters += text.length;
  if (counters.insertedBlocks > limits.maxInsertedBlocks) {
    return invalid(
      `Proposal exceeds ${limits.maxInsertedBlocks} inserted blocks`,
    );
  }
  const rawChildren = value.children ?? [];
  if (!Array.isArray(rawChildren)) {
    return invalid(`${context}.children must be an array`);
  }
  const children = rawChildren.map((child, index) =>
    normalizeDraft(
      child,
      `${context}.children[${index}]`,
      depth + 1,
      limits,
      counters,
    )
  );
  return {
    type,
    text,
    ...(value.props === undefined
      ? {}
      : { props: normalizeProps(value.props, type, `${context}.props`) }),
    ...(children.length > 0 ? { children } : {}),
  };
}

function normalizeOperation(
  raw: unknown,
  index: number,
  limits: AgentProposalLimits,
  counters: DraftCounters,
): AgentTextEditOperation {
  const context = `operations[${index}]`;
  const value = recordOf(raw, context);
  if (value.op === "update") {
    exactKeys(value, ["op", "blockId", "expectedBlockHash", "patch"], context);
    const patch = normalizePatch(value.patch, `${context}.patch`, limits);
    if (patch.text !== undefined) counters.textCharacters += patch.text.length;
    return {
      op: "update",
      blockId: identifier(value.blockId, `${context}.blockId`),
      expectedBlockHash: hashValue(
        value.expectedBlockHash,
        `${context}.expectedBlockHash`,
      ),
      patch,
    };
  }
  if (value.op === "delete") {
    exactKeys(value, ["op", "blockId", "expectedBlockHash"], context);
    return {
      op: "delete",
      blockId: identifier(value.blockId, `${context}.blockId`),
      expectedBlockHash: hashValue(
        value.expectedBlockHash,
        `${context}.expectedBlockHash`,
      ),
    };
  }
  if (value.op === "insertBefore" || value.op === "insertAfter") {
    exactKeys(value, [
      "op",
      "referenceBlockId",
      "expectedReferenceHash",
      "blocks",
    ], context);
    if (!Array.isArray(value.blocks) || value.blocks.length === 0) {
      return invalid(`${context}.blocks must be a non-empty array`);
    }
    return {
      op: value.op,
      referenceBlockId: identifier(
        value.referenceBlockId,
        `${context}.referenceBlockId`,
      ),
      expectedReferenceHash: hashValue(
        value.expectedReferenceHash,
        `${context}.expectedReferenceHash`,
      ),
      blocks: value.blocks.map((block, blockIndex) =>
        normalizeDraft(
          block,
          `${context}.blocks[${blockIndex}]`,
          1,
          limits,
          counters,
        )
      ),
    };
  }
  return invalid(`${context}.op is unsupported`);
}

export interface AgentProposalEnvelope {
  readonly proposalId: string;
  readonly sessionId: string;
  readonly baseRevision: number;
  readonly baseDocumentHash: string;
}

function normalizeProposalParts(
  raw: unknown,
  limits: AgentProposalLimits,
): Pick<AgentTextEditProposal, "summary" | "operations"> {
  const value = recordOf(raw, "Proposal");
  exactKeys(value, ["summary", "operations"], "Proposal");
  if (
    typeof value.summary !== "string" ||
    value.summary.trim() !== value.summary ||
    !value.summary ||
    value.summary.length > limits.maxSummaryCharacters
  ) {
    return invalid(
      `Proposal summary must be 1-${limits.maxSummaryCharacters} characters`,
    );
  }
  if (
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    value.operations.length > limits.maxOperations
  ) {
    return invalid(`Proposal must contain 1-${limits.maxOperations} operations`);
  }
  const counters: DraftCounters = { insertedBlocks: 0, textCharacters: 0 };
  const operations = value.operations.map((operation, index) =>
    normalizeOperation(operation, index, limits, counters)
  );
  if (counters.textCharacters > limits.maxTotalTextCharacters) {
    return invalid(
      `Proposal exceeds ${limits.maxTotalTextCharacters} total text characters`,
    );
  }
  const mutationTargets = new Set<string>();
  for (const operation of operations) {
    if (!("blockId" in operation)) {
      continue;
    }
    if (mutationTargets.has(operation.blockId)) {
      return invalid(`Proposal mutates block "${operation.blockId}" more than once`);
    }
    mutationTargets.add(operation.blockId);
  }
  return { summary: value.summary, operations };
}

export function createAgentTextEditProposal(
  envelope: AgentProposalEnvelope,
  raw: unknown,
  limits: AgentProposalLimits = DEFAULT_AGENT_PROPOSAL_LIMITS,
): AgentTextEditProposal {
  const proposalId = identifier(envelope.proposalId, "proposalId");
  const sessionId = identifier(envelope.sessionId, "sessionId");
  if (
    !Number.isSafeInteger(envelope.baseRevision) ||
    envelope.baseRevision < 0
  ) {
    return invalid("baseRevision must be a non-negative integer");
  }
  const baseDocumentHash = hashValue(
    envelope.baseDocumentHash,
    "baseDocumentHash",
  );
  const parts = normalizeProposalParts(raw, limits);
  return {
    version: 1,
    proposalId,
    sessionId,
    baseRevision: envelope.baseRevision,
    baseDocumentHash,
    ...parts,
  };
}

export function validateAgentTextEditProposal(
  raw: unknown,
  limits: AgentProposalLimits = DEFAULT_AGENT_PROPOSAL_LIMITS,
): AgentTextEditProposal {
  const value = recordOf(raw, "Stored proposal");
  exactKeys(value, [
    "version",
    "proposalId",
    "sessionId",
    "baseRevision",
    "baseDocumentHash",
    "summary",
    "operations",
  ], "Stored proposal");
  if (value.version !== 1) invalid("Stored proposal version is unsupported");
  return createAgentTextEditProposal({
    proposalId: identifier(value.proposalId, "proposalId"),
    sessionId: identifier(value.sessionId, "sessionId"),
    baseRevision: typeof value.baseRevision === "number"
      ? value.baseRevision
      : -1,
    baseDocumentHash: hashValue(
      value.baseDocumentHash,
      "baseDocumentHash",
    ),
  }, {
    summary: value.summary,
    operations: value.operations,
  }, limits);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Cannot hash a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) =>
      entry === undefined ? "null" : canonicalJson(entry)
    ).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return invalid("Cannot hash unsupported data");
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function sha256(text: string): string {
  const encoded: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (
      codePoint >= 0xd800 &&
      codePoint <= 0xdbff &&
      index + 1 < text.length
    ) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (codePoint <= 0x7f) {
      encoded.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      encoded.push(
        0xc0 | (codePoint >>> 6),
        0x80 | (codePoint & 0x3f),
      );
    } else if (codePoint <= 0xffff) {
      encoded.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      encoded.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  const bytes = Uint8Array.from(encoded);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15];
      const word2 = words[index - 2];
      const sigma0 = rotateRight(word15, 7) ^
        rotateRight(word15, 18) ^
        (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^
        rotateRight(word2, 19) ^
        (word2 >>> 10);
      words[index] = (
        words[index - 16] +
        sigma0 +
        words[index - 7] +
        sigma1
      ) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function hashAgentValue(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}

export function hashPreshotBlock(block: PreshotBlock): string {
  return hashAgentValue(block);
}

export function hashPreshotDocument(
  document: PreshotBlockDocument,
): string {
  return hashAgentValue(document);
}

function safeExistingProps(
  props: BlockProps,
  type: AgentTextBlockType,
): Record<string, boolean | number | string> {
  const safe: Record<string, boolean | number | string> = {};
  for (const key of COMMON_PROP_KEYS) {
    if (props[key] !== undefined) safe[key] = props[key];
  }
  if (type === "heading" && props.level !== undefined) safe.level = props.level;
  if (type === "checkListItem" && props.checked !== undefined) {
    safe.checked = props.checked;
  }
  if (type === "codeBlock" && props.language !== undefined) {
    safe.language = props.language;
  }
  return safe;
}

function defaultTypeProps(
  type: AgentTextBlockType,
): Record<string, boolean | number | string> {
  if (type === "heading") return { level: 2 };
  if (type === "checkListItem") return { checked: false };
  if (type === "codeBlock") return { language: "text" };
  return {};
}

export function applyAllowedTextBlockPatch(
  block: PreshotBlock,
  patch: AllowedTextBlockPatch,
): PreshotBlock {
  if (!isAgentTextBlockType(block.type)) {
    return invalid(`Block "${block.id}" is not an editable text block`);
  }
  const type = patch.type ?? block.type;
  if (
    (patch.props?.level !== undefined && type !== "heading") ||
    (patch.props?.checked !== undefined && type !== "checkListItem") ||
    (patch.props?.language !== undefined && type !== "codeBlock")
  ) {
    return invalid(`Patch properties do not apply to ${type}`);
  }
  const baseProps = patch.type && patch.type !== block.type
    ? {
        ...safeExistingProps(block.props, type),
        ...defaultTypeProps(type),
      }
    : { ...block.props };
  return {
    ...block,
    type,
    props: patch.props ? { ...baseProps, ...patch.props } : baseProps,
    content: patch.text === undefined
      ? block.content
      : patch.text
        ? [{ type: "text", text: patch.text, styles: {} }]
        : [],
  };
}

export function textBlockFromDraft(
  draft: AllowedTextBlockDraft,
  id: string,
  children: PreshotBlock[],
): PreshotBlock {
  return {
    id,
    type: draft.type,
    props: {
      ...defaultTypeProps(draft.type),
      ...(draft.props ?? {}),
    },
    content: draft.text
      ? [{ type: "text", text: draft.text, styles: {} }]
      : [],
    children,
  };
}
