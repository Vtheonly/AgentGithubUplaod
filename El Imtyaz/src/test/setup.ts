/**
 * Vitest setup — runs before every test file.
 *
 * Imports @testing-library/jest-dom so React component assertions like
 * `expect(element).toBeInTheDocument()` work, and registers a cleanup
 * hook so the DOM is reset between tests.
 *
 * Iteration 7: adds ResizeObserver + MutationObserver polyfills for jsdom
 * (the PageTabs sliding-indicator logic uses ResizeObserver to re-measure
 * the active trigger on resize; jsdom doesn't ship it natively).
 *
 * Iteration 7 (backup): imports `fake-indexeddb` so the IndexedDB vault
 * tests can run in Node without a real browser. The polyfill replaces
 * `globalThis.indexedDB` with an in-memory implementation.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "fake-indexeddb/auto";

// ---- jsdom polyfills (iteration 7) ----------------------------------

class ResizeObserverStub {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(_target: Element) {
    // no-op — jsdom doesn't perform layout, so there's nothing to observe.
  }
  unobserve(_target: Element) {
    // no-op
  }
  disconnect() {
    // no-op
  }
}

class MutationObserverStub {
  private cb: MutationCallback;
  constructor(cb: MutationCallback) {
    this.cb = cb;
  }
  observe(_target: Node, _options?: MutationObserverInit) {
    // no-op
  }
  disconnect() {
    // no-op
  }
  takeRecords(): MutationRecord[] {
    return [];
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

if (typeof globalThis.MutationObserver === "undefined") {
  (globalThis as unknown as { MutationObserver: typeof MutationObserverStub }).MutationObserver =
    MutationObserverStub;
}

// jsdom doesn't implement Element.scrollIntoView — silently no-op for tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {
    /* no-op */
  };
}

// ---- cleanup --------------------------------------------------------

afterEach(() => {
  cleanup();
});
