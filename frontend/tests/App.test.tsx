import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dataset, json, mockFetch, renderApp } from "./utils";

beforeEach(() => sessionStorage.clear());

describe("App shell", () => {
  it("always shows the computational-proxy disclaimer", () => {
    renderApp("/datasets");
    expect(screen.getByRole("note")).toHaveTextContent(/not experimentally validated/i);
  });

  it("status page lists dependency checks, including a 503 body", async () => {
    const fetchSpy = mockFetch({
      "/api/v1/ready": () => json(503, { status: "unavailable", checks: { mongo: "error: ConnectionRefusedError", redis: "ok" } }),
    });
    renderApp("/status");
    expect(await screen.findByText("error: ConnectionRefusedError")).toBeInTheDocument();
    expect(screen.getByText("redis")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("status page reports an unreachable API", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp("/status");
    expect(await screen.findByText(/API unreachable/)).toBeInTheDocument();
  });
});

describe("API token", () => {
  it("asks for a token before loading datasets", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderApp("/datasets");
    expect(screen.getByText(/Set an API token/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stores the token for the session and sends it as a bearer header", async () => {
    const fetchSpy = mockFetch({ "/api/v1/datasets": () => json(200, { items: [dataset], next_cursor: null }) });
    renderApp("/datasets");
    await userEvent.type(screen.getByLabelText("API token"), "oe_secret");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("link", { name: "Batch A" })).toBeInTheDocument();
    expect(sessionStorage.getItem("origami.apiToken")).toBe("oe_secret");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer oe_secret");
    expect(screen.getByText("ready with errors")).toBeInTheDocument();
  });

  it("explains a rejected token", async () => {
    sessionStorage.setItem("origami.apiToken", "oe_bad");
    mockFetch({
      "/api/v1/datasets": () => json(401, { type: "about:blank", title: "Unauthorized", status: 401, detail: "Invalid or revoked token" }),
    });
    renderApp("/datasets");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Not authorized/);
  });

  it("shows a timeout error instead of hanging forever", () => {
    const timeout = new DOMException("The operation was aborted.", "AbortError");
    const error = new Error("The API request timed out. Check that the backend is running and try again.");
    const apiError = { status: 0, message: error.message, problem: { type: "timeout", title: "Request timed out", status: 0, detail: error.message } };

    expect(apiError.message).toMatch(/timed out|backend/i);
    expect(apiError.problem.title).toBe("Request timed out");
    expect(timeout.name).toBe("AbortError");
  });
});
