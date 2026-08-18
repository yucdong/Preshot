import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error("DOCX ZIP end-of-central-directory record is missing");
}

export async function unzipDocx(
  archive: Blob | Uint8Array,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const bytes = archive instanceof Uint8Array
    ? archive
    : new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(bytes);
  const entryCount = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error(`DOCX ZIP central directory entry ${index} is invalid`);
    }
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + fileNameLength),
    );

    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
      throw new Error(`DOCX ZIP local header for "${fileName}" is invalid`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset =
      localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(
      dataOffset,
      dataOffset + compressedSize,
    );
    const data = compression === 0
      ? new Uint8Array(compressed)
      : compression === 8
        ? new Uint8Array(inflateRawSync(compressed))
        : (() => {
            throw new Error(
              `DOCX ZIP entry "${fileName}" uses unsupported compression ${compression}`,
            );
          })();
    entries.set(fileName, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

export function docxXml(
  entries: ReadonlyMap<string, Uint8Array>,
  name: string,
): { readonly document: XMLDocument; readonly text: string } {
  const bytes = entries.get(name);
  if (!bytes) throw new Error(`DOCX entry "${name}" is missing`);
  const text = new TextDecoder().decode(bytes);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`DOCX entry "${name}" is not valid XML`);
  }
  return { document, text };
}

export function xmlElements(
  document: XMLDocument | Element,
  localName: string,
): Element[] {
  return Array.from(document.getElementsByTagNameNS("*", localName));
}

export function wordAttribute(
  element: Element,
  localName: string,
): string | null {
  return element.getAttributeNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    localName,
  ) ?? element.getAttribute(`w:${localName}`);
}
