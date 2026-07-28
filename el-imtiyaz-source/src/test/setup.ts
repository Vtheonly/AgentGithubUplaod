/**
 * Vitest setup — runs before every test file.
 *
 * Imports @testing-library/jest-dom so React component assertions like
 * `expect(element).toBeInTheDocument()` work, and registers a cleanup
 * hook so the DOM is reset between tests.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees after each test to avoid leaking state across tests.
afterEach(() => {
  cleanup();
});
