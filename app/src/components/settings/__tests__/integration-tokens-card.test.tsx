import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationToken } from "@/lib/api/types";

const hooks = vi.hoisted(() => ({
  role: "Member",
  list: { data: [] as IntegrationToken[] | undefined, isLoading: false, isError: false, refetch: vi.fn() },
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/hooks/account", () => ({
  useCurrentUserProfile: () => ({ data: { dateFormat: "ymd", role: hooks.role } }),
}));
vi.mock("@/lib/api/hooks/integration-tokens", () => ({
  useIntegrationTokens: () => hooks.list,
  useCreateIntegrationToken: () => ({ mutateAsync: hooks.create, isPending: false }),
  useRevokeIntegrationToken: () => ({ mutateAsync: hooks.revoke, isPending: false }),
}));

import { IntegrationTokensCard } from "../integration-tokens-card";

const TOKEN = `tbp_${"A".repeat(20)}-_${"b".repeat(21)}`;

function token(overrides: Partial<IntegrationToken> = {}): IntegrationToken {
  return {
    id: "t1",
    name: "Raycast",
    tokenPrefix: "tbp_AbCdEfGh",
    scopes: ["read"],
    expiresAt: "2099-01-01T12:00:00.000Z",
    lastUsedAt: null,
    createdAt: "2026-11-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("IntegrationTokensCard", () => {
  beforeEach(() => {
    hooks.list = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    hooks.role = "Member";
    hooks.create.mockReset();
    hooks.revoke.mockReset();
  });

  it("adds the create scope only when switched on and shows scopes as badges", async () => {
    const user = userEvent.setup();
    hooks.create.mockResolvedValue({ ...token({ scopes: ["read", "create"] }), token: TOKEN });
    hooks.list.data = [token({ scopes: ["read", "create"] })];

    render(<IntegrationTokensCard />);
    const scopeSwitch = screen.getByRole("switch", { name: /allow creating entries/i });
    expect(scopeSwitch).not.toBeChecked();
    expect(screen.getByText(/write access\. the token can propose entries/i)).toBeInTheDocument();

    await user.click(scopeSwitch);
    await user.click(screen.getByRole("button", { name: /create token/i }));

    expect(hooks.create).toHaveBeenCalledWith({ name: "Raycast", expiresInDays: 30, scopes: ["create"] });
    expect(screen.getByText("create", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(screen.getByText("read", { selector: "[data-slot=badge]" })).toBeInTheDocument();
  });

  it("hides the create scope from viewers", () => {
    hooks.role = "Viewer";
    render(<IntegrationTokensCard />);
    expect(screen.queryByRole("switch", { name: /allow creating entries/i })).not.toBeInTheDocument();
  });

  it("creates a read token, shows it once and copies the full value", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    hooks.create.mockResolvedValue({ ...token(), token: TOKEN });

    render(<IntegrationTokensCard />);
    expect(screen.getByText(/no tokens yet\. create one above to connect raycast/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create token/i }));

    expect(hooks.create).toHaveBeenCalledWith({ name: "Raycast", expiresInDays: 30, scopes: [] });
    expect(screen.getByLabelText(/new integration token/i)).toHaveTextContent(TOKEN);
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(writeText).toHaveBeenLastCalledWith(TOKEN);

    await user.click(screen.getByRole("button", { name: "Copy Keychain command" }));
    expect(writeText).toHaveBeenLastCalledWith('security add-generic-password -U -a "$USER" -s tempobase-mcp -w');

    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
  });

  it("lists tokens with dates in the user's format and puts expired ones last", () => {
    hooks.list.data = [
      token({ id: "old", name: "Old laptop", expiresAt: "2020-01-01T12:00:00.000Z" }),
      token({ lastUsedAt: "2026-11-21T12:00:00.000Z" }),
    ];

    render(<IntegrationTokensCard />);

    const names = screen.getAllByText(/^(Raycast|Old laptop)$/).map((n) => n.textContent);
    expect(names).toEqual(["Raycast", "Old laptop"]);
    expect(screen.getByText("Expired", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(screen.getAllByText("2026-11-20")).toHaveLength(2);
    expect(screen.getByText(/^2026-11-21 \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("revokes only after confirmation", async () => {
    const user = userEvent.setup();
    hooks.list.data = [token()];

    render(<IntegrationTokensCard />);
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    expect(hooks.revoke).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    expect(hooks.revoke).toHaveBeenCalledWith("t1");
  });

  it("shows a retry on load errors", async () => {
    const user = userEvent.setup();
    hooks.list = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };

    render(<IntegrationTokensCard />);
    expect(screen.getByText(/couldn't load tokens/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(hooks.list.refetch).toHaveBeenCalled();
  });
});
