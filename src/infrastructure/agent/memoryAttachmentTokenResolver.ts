import { AgentDomainError } from "../../domain/agent/errors";
import type {
  AgentAttachmentTokenIssue,
  AgentAttachmentTokenResolve,
  AgentAttachmentTokenResolverPort,
  AgentProjectRegistration,
  AgentResolvedAttachment,
} from "../../domain/agent/ports";

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1_000;
const MAX_PINNED_TOKENS_PER_PROJECT = 8;
const PROJECT_FILE_PATTERN = /^(?:references|media)\/[^/\\]+$/i;

interface TokenRecord extends AgentAttachmentTokenIssue {
  readonly expiresAt: number;
  readonly sequence: number;
}

interface MemoryAttachmentTokenResolverOptions {
  readonly now?: () => number;
  readonly makeId?: () => string;
  readonly ttlMs?: number;
}

function opaque(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export class MemoryAttachmentTokenResolver
  implements AgentAttachmentTokenResolverPort {
  private readonly projects = new Map<
    string,
    { readonly handle: string; readonly path: string }
  >();
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly ttlMs: number;
  private sequence = 0;

  constructor(options: MemoryAttachmentTokenResolverOptions = {}) {
    this.now = options.now ?? Date.now;
    this.makeId = options.makeId ?? (() => crypto.randomUUID());
    this.ttlMs = options.ttlMs ?? DEFAULT_TOKEN_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("Attachment token TTL must be a positive integer");
    }
  }

  registerProject(registration: AgentProjectRegistration): string {
    if (!registration.projectId || !registration.projectPath) {
      throw new AgentDomainError(
        "project_deleted",
        "workspace",
        "Project registration is incomplete",
      );
    }
    const handle = opaque("project", this.makeId());
    this.projects.set(registration.projectId, {
      handle,
      path: registration.projectPath,
    });
    return handle;
  }

  issueAttachment(input: AgentAttachmentTokenIssue): string {
    this.pruneExpired();
    const project = this.projects.get(input.projectId);
    if (
      !project ||
      project.handle !== input.projectHandle ||
      !PROJECT_FILE_PATTERN.test(input.relativeFile) ||
      !Number.isSafeInteger(input.documentRevision) ||
      input.documentRevision < 0
    ) {
      throw new AgentDomainError(
        "attachment_unavailable",
        "workspace",
        "The selected attachment is no longer available",
        { retryable: true },
      );
    }
    for (const [existingToken, record] of this.tokens) {
      const sameImage = record.projectId === input.projectId &&
        record.groupId === input.groupId &&
        record.imageId === input.imageId;
      if (
        (!input.pinned && record.projectId === input.projectId &&
          !record.pinned) ||
        (input.pinned && record.pinned && sameImage)
      ) {
        this.tokens.delete(existingToken);
      }
    }
    const token = opaque("attachment", this.makeId());
    this.tokens.set(token, {
      ...input,
      expiresAt: this.now() + this.ttlMs,
      sequence: ++this.sequence,
    });
    if (input.pinned) this.enforcePinnedBound(input.projectId);
    return token;
  }

  async resolveAttachment(
    input: AgentAttachmentTokenResolve,
  ): Promise<AgentResolvedAttachment> {
    this.pruneExpired();
    const record = this.tokens.get(input.token);
    if (
      !record ||
      record.projectId !== input.expectedProjectId ||
      record.documentRevision !== input.expectedDocumentRevision
    ) {
      this.tokens.delete(input.token);
      throw new AgentDomainError(
        "attachment_unavailable",
        "workspace",
        "Attachment token is expired or does not match this project revision",
        { retryable: true },
      );
    }
    const project = this.projects.get(record.projectId);
    if (!project || project.handle !== record.projectHandle) {
      this.tokens.delete(input.token);
      throw new AgentDomainError(
        "project_deleted",
        "workspace",
        "Attachment project is unavailable",
      );
    }
    this.tokens.delete(input.token);
    return Object.freeze({
      projectId: record.projectId,
      documentRevision: record.documentRevision,
      groupId: record.groupId,
      imageId: record.imageId,
      absolutePath: `${project.path.replace(/[\\/]+$/, "")}\\${
        record.relativeFile.replaceAll("/", "\\")
      }`,
    });
  }

  revokeAttachment(token: string): void {
    this.tokens.delete(token);
  }

  revokeImage(projectId: string, groupId: string, imageId: string): void {
    for (const [token, record] of this.tokens) {
      if (
        record.projectId === projectId &&
        record.groupId === groupId &&
        record.imageId === imageId
      ) {
        this.tokens.delete(token);
      }
    }
  }

  retainProjectRevision(projectId: string, documentRevision: number): void {
    this.pruneExpired();
    for (const [token, record] of this.tokens) {
      if (
        record.projectId === projectId &&
        record.documentRevision !== documentRevision
      ) {
        this.tokens.delete(token);
      }
    }
  }

  pruneExpired(): void {
    const now = this.now();
    for (const [token, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(token);
    }
  }

  revokeProject(projectId: string): void {
    this.projects.delete(projectId);
    for (const [token, record] of this.tokens) {
      if (record.projectId === projectId) this.tokens.delete(token);
    }
  }

  activeTokenCount(projectId?: string): number {
    this.pruneExpired();
    return projectId
      ? [...this.tokens.values()].filter((record) =>
        record.projectId === projectId
      ).length
      : this.tokens.size;
  }

  private enforcePinnedBound(projectId: string): void {
    const pinned = [...this.tokens.entries()]
      .filter(([, record]) =>
        record.projectId === projectId && record.pinned
      )
      .sort((left, right) => left[1].sequence - right[1].sequence);
    for (
      let index = 0;
      index < pinned.length - MAX_PINNED_TOKENS_PER_PROJECT;
      index += 1
    ) {
      this.tokens.delete(pinned[index][0]);
    }
  }
}
