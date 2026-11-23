import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import LoginPage from "../page";

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockLogin = vi.fn();
const mockApiFetch = vi.fn();

let authUser: { id: string; email: string } | null = null;
let authIsLoading = false;
let profileData: { defaultLandingPage: string } | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ login: mockLogin, user: authUser, isLoading: authIsLoading }),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...original,
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  };
});

vi.mock("@/lib/api/hooks/account", () => ({
  useCurrentUserProfile: () => ({
    data: profileData,
    isLoading: false,
  }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser = null;
    authIsLoading = false;
    profileData = null;
  });

  it("signs in and redirects to the user's default landing page", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue(undefined);
    mockApiFetch.mockResolvedValue({ defaultLandingPage: "timesheet" });

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), "owner@example.com");
    await user.type(screen.getByLabelText(/password/i), "Password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: "owner@example.com",
        password: "Password123",
      });
    });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/users/me");
    });
    expect(mockPush).toHaveBeenCalledWith("/timesheet");
  });

  it("redirects to the user's default landing page when already authenticated", async () => {
    authUser = { id: "user-1", email: "owner@example.com" };
    authIsLoading = false;
    profileData = { defaultLandingPage: "dashboard" };

    render(<LoginPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it.each([
    ["/integrations/operations/abc", "/integrations/operations/abc"],
    ["//evil.example.com/x", "/dashboard"],
    ["https://evil.example.com/x", "/dashboard"],
    ["/.//evil.example.com", "/dashboard"],
    ["/..//evil.example.com", "/dashboard"],
    ["/x/..//evil.example.com", "/dashboard"],
    ["/\\evil.example.com", "/dashboard"],
    ["//[", "/dashboard"],
    ["//x:99999", "/dashboard"],
    ["/x\\y", "/dashboard"],
  ])("returns to next=%s only when it is a same-origin path", async (next, expected) => {
    window.history.replaceState(null, "", `/login?next=${encodeURIComponent(next)}`);
    authUser = { id: "user-1", email: "owner@example.com" };
    profileData = { defaultLandingPage: "dashboard" };

    try {
      render(<LoginPage />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expected));
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("shows a friendly error for invalid credentials", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError(401, "Unauthorized"));

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), "owner@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
