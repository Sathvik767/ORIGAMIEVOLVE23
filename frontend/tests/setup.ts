import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// The redesigned pages render more markup; on slower machines a full parallel run needs more than the 1 s default.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
