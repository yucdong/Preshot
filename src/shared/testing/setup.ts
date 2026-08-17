import "../i18n/config";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// ProseMirror relies on browser APIs jsdom lacks. Shim the minimum.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= IntersectionObserverStub as unknown as typeof IntersectionObserver;
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
})) as unknown as typeof globalThis.matchMedia;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
Document.prototype.elementFromPoint ??= () => null;
Document.prototype.elementsFromPoint ??= () => [];
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= () =>
    ({ item: () => null, length: 0, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
}
