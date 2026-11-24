import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationOperation } from "@/lib/api/types";

const hooks = vi.hoisted(() => ({
  op: null as IntegrationOperation | null,
  error: null as unknown,
  confirm: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api/hooks/account", () => ({ useCurrentUserProfile: () => ({ data: { dateFormat: "ymd" } }) }));
vi.mock("@/lib/api/hooks/integration-operations", () => ({
  useIntegrationOperation: () => ({ data: hooks.op, isLoading: false, isError: hooks.error !== null, error: hooks.error }),
  useConfirmIntegrationOperation: () => ({ mutateAsync: hooks.confirm, isPending: false }),
  useCancelIntegrationOperation: () => ({ mutateAsync: hooks.cancel, isPending: false }),
}));

import { ApiError } from "@/lib/api/client";
import IntegrationOperationPage from "../page";

function operation(overrides: Partial<IntegrationOperation> = {}, tokenUsable = true): IntegrationOperation {
  return {
    id: "op-1",
    kind: "create_entry",
    status: "pending",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    confirmedAt: null,
    cancelledAt: null,
    entryId: null,
    entryDeleted: false,
    entry: {
      startTime: "2026-11-20T17:00:00.000Z",
      endTime: "2026-11-20T18:30:00.000Z",
      durationHours: 1.5,
      description: "Review PR 7",
      isBillable: true,
      project: { id: "p1", name: "DVI2026" },
      task: { id: "t1", name: "Code review" },
    },
    before: null,
    changedFields: [],
    integration: { name: "Raycast", tokenPrefix: "tbp_abcdefgh", tokenUsable },
    ...overrides,
  };
}

async function renderPage() {
  await act(async () => {
    render(<IntegrationOperationPage params={Promise.resolve({ id: "op-1" })} />);
  });
}

describe("IntegrationOperationPage", () => {
  beforeEach(() => {
    hooks.confirm.mockReset();
    hooks.cancel.mockReset();
    hooks.error = null;
  });

  it("offers confirm and cancel for a pending operation", async () => {
    hooks.op = operation();
    await renderPage();

    expect(screen.getByRole("heading", { name: "Confirm new time entry" })).toBeInTheDocument();
    expect(screen.getByText("Review PR 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm and save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByText("Requested by")).toBeInTheDocument();
    expect(screen.getByText(/Expires in/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Time left to confirm" })).toBeInTheDocument();
  });

  it("blocks confirmation when the token can no longer be used, but keeps cancel", async () => {
    hooks.op = operation({}, false);
    await renderPage();

    expect(screen.getByText("Token no longer valid")).toBeInTheDocument();
    expect(screen.getByText(/revoked or expired\. Ask the integration to create it again\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm and save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("shows the final state without actions once confirmed", async () => {
    hooks.op = operation({ status: "confirmed", entryId: "e1" });
    await renderPage();

    expect(screen.getByText("Entry saved to your timesheet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open time entries" })).toHaveAttribute("href", "/tracker");
    expect(screen.queryByRole("button", { name: "Confirm and save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("labels a cancelled operation and offers no actions on it", async () => {
    hooks.op = operation({ status: "cancelled" });
    await renderPage();

    expect(screen.getByText("Cancelled", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("explains a request that is not this account's", async () => {
    hooks.op = null;
    hooks.error = new ApiError(404, "Operation not found");
    await renderPage();

    expect(screen.getByRole("heading", { name: "Entry request not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to tracker" })).toHaveAttribute("href", "/tracker");
  });

  it("says when the confirmed entry was deleted later", async () => {
    hooks.op = operation({ status: "confirmed", entryId: "e1", entryDeleted: true });
    await renderPage();

    expect(screen.getByText("This entry was saved and later deleted from your timesheet.")).toBeInTheDocument();
  });

  describe("correction", () => {
    const correction = (overrides: Partial<IntegrationOperation> = {}) =>
      operation({
        kind: "correct_entry",
        entryId: "e1",
        before: { ...operation().entry, endTime: "2026-11-20T18:00:00.000Z", durationHours: 1, isBillable: false },
        changedFields: ["endTime", "isBillable"],
        ...overrides,
      });

    it("shows before and after and marks only the changed fields", async () => {
      hooks.op = correction();
      await renderPage();

      expect(screen.getByRole("heading", { name: "Confirm entry correction" })).toBeInTheDocument();
      expect(screen.getByText(/2 fields will change\. Everything else stays as it is\./)).toBeInTheDocument();
      const changed = Array.from(document.querySelectorAll("[data-changed]")).map((row) => row.querySelector("dt")?.textContent);
      expect(changed).toEqual(["End", "Duration", "Billable"]);
      expect(screen.getByText("Non-billable", { selector: "span" })).toBeInTheDocument();
      expect(screen.getByText("Billable", { selector: "dd" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm correction" })).toBeEnabled();
    });

    it("explains a conflict, focuses it, marks rows edited elsewhere and keeps the refreshed preview confirmable", async () => {
      hooks.op = correction();
      // The app edited the description after the preview; the hook stores the refreshed operation.
      const refreshed = correction({ before: { ...hooks.op.before!, description: "Edited in the app" }, entry: { ...hooks.op.entry, description: "Edited in the app" } });
      hooks.confirm.mockImplementation(async () => {
        hooks.op = refreshed;
        throw new ApiError(409, "This entry changed after the preview", [], { code: "entry_changed", operation: refreshed });
      });
      const params = Promise.resolve({ id: "op-1" });
      let rerender: ReturnType<typeof render>["rerender"] = () => undefined;
      await act(async () => {
        rerender = render(<IntegrationOperationPage params={params} />).rerender;
      });

      await act(async () => screen.getByRole("button", { name: "Confirm correction" }).click());
      // The query cache update re-renders the page with the refreshed operation.
      await act(async () => rerender(<IntegrationOperationPage params={params} />));

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("This entry changed after the preview");
      expect(alert).toHaveFocus();
      const elsewhere = Array.from(document.querySelectorAll("[data-changed-elsewhere]"));
      expect(elsewhere.map((row) => row.querySelector("dt")?.textContent)).toEqual(["Description"]);
      expect(within(elsewhere[0] as HTMLElement).getByText("Changed in TempoBase")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm correction" })).toBeEnabled();
    });

    it("moves focus to the status when the operation closes", async () => {
      hooks.op = correction();
      const params = Promise.resolve({ id: "op-1" });
      let rerender: ReturnType<typeof render>["rerender"] = () => undefined;
      await act(async () => {
        rerender = render(<IntegrationOperationPage params={params} />).rerender;
      });

      hooks.op = correction({ status: "confirmed" });
      await act(async () => rerender(<IntegrationOperationPage params={params} />));

      expect(screen.getByRole("status")).toHaveFocus();
      expect(screen.getByText("After")).toBeInTheDocument();
    });

    it("says in words when less than 2 minutes are left", async () => {
      hooks.op = correction({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
      await renderPage();

      expect(screen.getByText("Less than 2 minutes left")).toHaveAttribute("aria-live", "polite");
    });

    it("does not mark a requested field whose value stays the same", async () => {
      hooks.op = correction({ changedFields: ["endTime", "isBillable", "description"] });
      await renderPage();

      const changed = Array.from(document.querySelectorAll("[data-changed]")).map((row) => row.querySelector("dt")?.textContent);
      expect(changed).not.toContain("Description");
    });

    it("says nothing changed when cancelled", async () => {
      hooks.op = correction({ status: "cancelled" });
      await renderPage();

      expect(screen.getByText(/Nothing was changed\. Ask the integration/)).toBeInTheDocument();
      expect(screen.getByText(/^2 fields requested\./)).toBeInTheDocument();
      expect(screen.getAllByText(/Nothing was changed/)).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Confirm correction" })).not.toBeInTheDocument();
    });

    it("keeps the buttons focusable while a request runs", async () => {
      hooks.op = correction();
      let finish: () => void = () => undefined;
      hooks.confirm.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
      await renderPage();
      const button = screen.getByRole("button", { name: "Confirm correction" });
      button.focus();

      await act(async () => button.click());

      expect(button).not.toBeDisabled();
      expect(button).toHaveFocus();
      await act(async () => finish());
    });

    it("reports a confirmed correction", async () => {
      hooks.op = correction({ status: "confirmed" });
      await renderPage();

      expect(screen.getByText("Entry corrected")).toBeInTheDocument();
      expect(screen.getByText("Changes saved to your timesheet.")).toBeInTheDocument();
    });
  });
});
