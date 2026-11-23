import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth-guard";

const mockReplace = vi.fn();

let authState: {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    accountId: string;
  } | null;
  isLoading: boolean;
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => authState,
}));

describe("AuthGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState = {
      user: {
        id: "user-1",
        email: "owner@example.com",
        firstName: "Owner",
        lastName: "User",
        role: "Owner",
        accountId: "acc-1",
      },
      isLoading: false,
    };
  });

  it("renders a loading state while auth is resolving", () => {
    authState = { user: null, isLoading: true };

    render(
      <AuthGuard>
        <div>Protected content</div>
      </AuthGuard>,
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated users to login", async () => {
    authState = { user: null, isLoading: false };

    render(
      <AuthGuard>
        <div>Protected content</div>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("keeps the requested page so login can return to it", async () => {
    authState = { user: null, isLoading: false };
    window.history.replaceState(null, "", "/integrations/operations/abc");

    try {
      render(<AuthGuard><div /></AuthGuard>);
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/login?next=%2Fintegrations%2Foperations%2Fabc");
      });
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("renders children for authenticated users", () => {
    render(
      <AuthGuard>
        <div>Protected content</div>
      </AuthGuard>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
