import {
  validateLongImageSaveRequest,
  type LongImageSaveRequest,
  type LongImageSaveTarget,
} from "../../domain/plan/longImageSave";

export interface BrowserLongImageMultiPartAdapter {
  readonly implementation: "noop-test";
  save(request: LongImageSaveRequest): Promise<string[]>;
}

interface Dependencies {
  multiPartAdapter?: BrowserLongImageMultiPartAdapter;
  download?: (blob: Blob, fileName: string) => void;
}

export const noOpLongImageMultiPartAdapter: BrowserLongImageMultiPartAdapter = {
  implementation: "noop-test",
  save(request) {
    return Promise.resolve(request.parts.map((part) => part.fileName));
  },
};

export function createBrowserLongImageSaveTarget({
  multiPartAdapter = noOpLongImageMultiPartAdapter,
  download = downloadBlob,
}: Dependencies = {}): LongImageSaveTarget {
  return {
    revealProjectDirectoryAfterSave: false,
    save(request) {
      validateLongImageSaveRequest(request);
      if (request.parts.length > 1) {
        return multiPartAdapter.save(request);
      }

      const part = request.parts[0]!;
      const blob = new Blob([blobByteView(part.bytes)], {
        type: request.format === "png" ? "image/png" : "image/jpeg",
      });
      download(blob, part.fileName);
      return Promise.resolve([part.fileName]);
    },
  };
}

function blobByteView(
  bytes: Readonly<Uint8Array>,
): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Uint8Array.from(bytes);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const browserLongImageSaveTarget = createBrowserLongImageSaveTarget();
