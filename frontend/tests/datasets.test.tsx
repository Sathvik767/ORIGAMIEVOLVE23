import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inferFormat } from "../src/api/client";
import { dataset, json, mockFetch, renderApp, report } from "./utils";

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("origami.apiToken", "oe_test");
});

describe("inferFormat", () => {
  it.each([
    ["a.csv", "csv"],
    ["A.NDJSON", "ndjson"],
    ["x.jsonl", "ndjson"],
    ["x.json", "json"],
    ["x.xlsx", undefined],
  ])("%s -> %s", (name, fmt) => expect(inferFormat(name)).toBe(fmt));
});

describe("dataset detail", () => {
  it("shows the validation report with descriptions, samples and line numbers", async () => {
    mockFetch({
      [`/datasets/${dataset.id}/report`]: () => json(200, report),
      [`/datasets/${dataset.id}/designs`]: () =>
        json(200, {
          items: [
            { id: "d1", external_id: "tile_1", name: null, has_scaffold: true, scaffold_length: 64, staple_count: 2,
              candidate_count: 1, measurement_names: ["gel_yield"] },
          ],
          next_cursor: null,
        }),
      [`/datasets/${dataset.id}`]: () => json(200, dataset),
    });
    renderApp(`/datasets/${dataset.id}`);

    const reportSection = await screen.findByRole("region", { name: "Validation report" });
    expect(within(reportSection).getByText("E_ALPHABET")).toBeInTheDocument();
    expect(within(reportSection).getByText(/characters other than A, C, G, T/)).toBeInTheDocument();
    expect(within(reportSection).getByText("strand[s1].sequence")).toBeInTheDocument();
    expect(within(reportSection).getByText("Showing 1 of 2. Download the full report for all.")).toBeInTheDocument();
    expect(within(reportSection).getAllByRole("columnheader", { name: "Line" })).toHaveLength(2);

    const designs = await screen.findByRole("region", { name: "Designs" });
    expect(within(designs).getByRole("link", { name: "tile_1" })).toHaveAttribute("href", "/designs/d1");
    expect(within(designs).getByText("gel_yield")).toBeInTheDocument();
  });

  it("surfaces a failed ingest job", async () => {
    mockFetch({
      [`/datasets/${dataset.id}/report`]: () => json(404, { type: "about:blank", title: "Not Found", status: 404 }),
      [`/datasets/${dataset.id}/designs`]: () => json(200, { items: [], next_cursor: null }),
      [`/datasets/${dataset.id}`]: () =>
        json(200, {
          ...dataset,
          status: "failed",
          counts: {},
          ingest_job: { id: "j", status: "failed", error: { code: "DISPATCH_FAILED", message: "Queue unavailable", retryable: true } },
        }),
    });
    renderApp(`/datasets/${dataset.id}`);
    expect(await screen.findByText(/Ingestion failed: Queue unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-run validation" })).toBeEnabled();
  });
});

class FakeXHR {
  static last: FakeXHR;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 0;
  responseText = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

describe("upload", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function chooseFile(name: string) {
    renderApp("/datasets");
    const file = new File(["design_id,strand_id,strand_type,sequence\n"], name, { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText("File"), file);
    return file;
  }

  it("infers name and format, streams the raw file with auth, and links the new dataset", async () => {
    mockFetch({ "/api/v1/datasets": () => json(200, { items: [], next_cursor: null }) });
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const file = await chooseFile("batch_a.csv");

    expect(screen.getByLabelText("Name")).toHaveValue("batch_a");
    expect(screen.getByLabelText("Format")).toHaveValue("csv");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const xhr = FakeXHR.last;
    expect(xhr.method).toBe("POST");
    const url = new URL(xhr.url, "http://x");
    expect(url.pathname).toBe("/api/v1/datasets");
    expect(Object.fromEntries(url.searchParams)).toEqual({ name: "batch_a", format: "csv", filename: "batch_a.csv" });
    expect(xhr.headers.Authorization).toBe("Bearer oe_test");
    expect(xhr.body).toBe(file);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    expect(await screen.findByText("Uploading… 50%")).toBeInTheDocument();
    xhr.respond(202, { dataset, duplicate: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Validation is running");
    expect(screen.getByRole("link", { name: "Batch A" })).toHaveAttribute("href", `/datasets/${dataset.id}`);
  });

  it("explains duplicates and server-side rejections", async () => {
    mockFetch({ "/api/v1/datasets": () => json(200, { items: [], next_cursor: null }) });
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    await chooseFile("batch_a.csv");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    FakeXHR.last.respond(200, { dataset, duplicate: true });
    expect(await screen.findByRole("status")).toHaveTextContent("already uploaded");

    await userEvent.upload(screen.getByLabelText("File"), new File(["x"], "other.csv"));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    FakeXHR.last.respond(413, { type: "about:blank", title: "Content Too Large", status: 413, detail: "Upload exceeds 524288000 bytes" });
    expect(await screen.findByText("Upload exceeds 524288000 bytes")).toBeInTheDocument();
  });

  it("requires a format for unknown extensions", async () => {
    mockFetch({ "/api/v1/datasets": () => json(200, { items: [], next_cursor: null }) });
    await chooseFile("data.txt");
    expect(screen.getByLabelText("Format")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });
});
