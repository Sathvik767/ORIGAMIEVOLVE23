import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

import App from "../src/App";
import { TokenProvider } from "../src/components/TokenContext";

export function renderApp(route = "/datasets") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TokenProvider>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </TokenProvider>
    </QueryClientProvider>,
  );
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Route fetch calls by URL substring. Unmatched calls fail the test loudly. */
export function mockFetch(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.includes(k));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    return routes[key]!();
  });
}

export const dataset = {
  id: "651f00000000000000000001",
  name: "Batch A",
  description: null,
  format: "csv",
  original_filename: "batch_a.csv",
  size_bytes: 4487,
  sha256: "ab".repeat(32),
  status: "ready_with_errors",
  counts: { records_read: 6, designs_valid: 2, designs_invalid: 1, error_count: 2, warning_count: 1 },
  ingest_job: { id: "651f00000000000000000009", status: "completed", error: null },
  created_at: "2026-10-10T08:00:00Z",
  updated_at: "2026-10-10T08:00:05Z",
};

export const report = {
  location_kind: "line",
  records_read: 6,
  designs_valid: 2,
  designs_invalid: 1,
  error_count: 2,
  warning_count: 1,
  errors_by_code: { E_ALPHABET: 2 },
  warnings_by_code: { W_NO_SCAFFOLD: 1 },
  samples: {
    E_ALPHABET: [
      { code: "E_ALPHABET", message: "Invalid characters ['U']", location: 6, design_id: "d3", field: "strand[s1].sequence" },
    ],
    W_NO_SCAFFOLD: [{ code: "W_NO_SCAFFOLD", message: "No scaffold", location: 5, design_id: "d2", field: null }],
  },
  fatal: null,
};
