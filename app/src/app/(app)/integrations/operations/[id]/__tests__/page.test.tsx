import { act, render, screen } from "@testing-library/react";
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
    entry: {
      startTime: "2026-11-20T17:00:00.000Z",
      endTime: "2026-11-20T18:30:00.000Z",
      durationHours: 1.5,
      description: "Review PR 7",
      isBillable: true,
      project: { id: "p1", name: "DVI2026" },
      task: { id: "t1", name: "Code review" },
    },
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
});
