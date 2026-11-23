import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import SettingsPage from "../page";

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

const mockReplace = vi.fn();
const mockUpdateAccount = vi.fn();
const mockUpdateProfile = vi.fn();
const mockChangePassword = vi.fn();
const mockDeleteCurrentUser = vi.fn();
const mockDeleteWorkspace = vi.fn();
const mockExportAccount = vi.fn();
const mockPurgeTimeEntries = vi.fn();
const mockCreateInvite = vi.fn();
const mockRevokeInvite = vi.fn();
const mockUpdateTeamMember = vi.fn();
const mockRemoveTeamMember = vi.fn();
const mockSetMemberAccess = vi.fn();
const mockUpdateUser = vi.fn();
const mockLogout = vi.fn();
const mockClipboardWriteText = vi.fn();

type Role = "Owner" | "Admin" | "Manager" | "Member" | "Viewer";

let currentUser: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  accountId: string;
} | null;

let accountData: {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  auditRetentionDays: number;
  createdAt: string;
};

let profileData: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  dateFormat: "system" | "ymd" | "dmy" | "mdy";
  defaultProjectId?: string | null;
  defaultLandingPage: "dashboard" | "tracker" | "timesheet";
  showAuditMetadata: boolean;
  canViewAmounts: boolean;
  createdAt: string;
};

let projectsData: Array<{
  id: string;
  name: string;
  status: string;
}>;

let teamMembersData: Array<{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  canViewAmounts: boolean;
  createdAt: string;
  allowedProjectIds: string[];
  allowedTaskIds: string[];
}>;

let invitesData: Array<{
  id: string;
  token: string;
  joinUrl: string;
  expiresAt: string;
  createdAt: string;
}>;

function seedData() {
  accountData = {
    id: "acc-1",
    name: "TempoBase",
    slug: "tempobase",
    timezone: "UTC",
    currency: "USD",
    auditRetentionDays: 365,
    createdAt: "2026-03-23T00:00:00Z",
  };

  profileData = {
    id: currentUser?.id ?? "user-1",
    email: currentUser?.email ?? "owner@example.com",
    firstName: currentUser?.firstName ?? "Owner",
    lastName: currentUser?.lastName ?? "User",
    role: currentUser?.role ?? "Owner",
    dateFormat: "system",
    defaultProjectId: "project-1",
    defaultLandingPage: "tracker",
    showAuditMetadata: true,
    canViewAmounts: true,
    createdAt: "2026-03-23T00:00:00Z",
  };

  projectsData = [
    { id: "project-1", name: "TempoBase Core", status: "Active" },
    { id: "project-2", name: "Mobile Rollout", status: "Active" },
  ];

  teamMembersData = [
    {
      id: currentUser?.id ?? "user-1",
      email: currentUser?.email ?? "owner@example.com",
      firstName: currentUser?.firstName ?? "Owner",
      lastName: currentUser?.lastName ?? "User",
      role: currentUser?.role ?? "Owner",
      isActive: true,
      canViewAmounts: true,
      createdAt: "2026-03-23T00:00:00Z",
      allowedProjectIds: [],
      allowedTaskIds: [],
    },
    {
      id: "user-2",
      email: "member@example.com",
      firstName: "Morgan",
      lastName: "Member",
      role: "Member",
      isActive: true,
      canViewAmounts: true,
      createdAt: "2026-03-23T00:00:00Z",
      allowedProjectIds: [],
      allowedTaskIds: [],
    },
  ];

  invitesData = [
    {
      id: "invite-1",
      token: "invite-token-1234",
      joinUrl: "http://localhost:3000/register?invite=invite-token-1234",
      expiresAt: "2026-04-01T00:00:00Z",
      createdAt: "2026-03-23T00:00:00Z",
    },
  ];
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: currentUser,
    updateUser: mockUpdateUser,
    logout: mockLogout,
  }),
}));

vi.mock("@/lib/api/hooks/account", () => ({
  useAccount: () => ({
    data: accountData,
    isLoading: false,
  }),
  useCurrentUserProfile: () => ({
    data: profileData,
    isLoading: false,
  }),
  useUpdateAccount: () => ({ mutateAsync: mockUpdateAccount, isPending: false }),
  useUpdateMyProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
  useChangePassword: () => ({ mutateAsync: mockChangePassword, isPending: false }),
  useDeleteCurrentUser: () => ({ mutateAsync: mockDeleteCurrentUser, isPending: false }),
  useDeleteWorkspace: () => ({ mutateAsync: mockDeleteWorkspace, isPending: false }),
  useExportAccount: () => ({ mutateAsync: mockExportAccount, isPending: false }),
  usePurgeTimeEntries: () => ({ mutateAsync: mockPurgeTimeEntries, isPending: false }),
}));

vi.mock("@/components/settings/integration-tokens-card", () => ({
  IntegrationTokensCard: () => null,
}));

vi.mock("@/lib/api/hooks/team", () => ({
  useTeamMembers: () => ({
    data: teamMembersData,
    isLoading: false,
  }),
  useInvites: () => ({
    data: invitesData,
    isLoading: false,
  }),
  useCreateInvite: () => ({ mutateAsync: mockCreateInvite, isPending: false }),
  useRevokeInvite: () => ({ mutateAsync: mockRevokeInvite, isPending: false }),
  useUpdateTeamMember: () => ({ mutateAsync: mockUpdateTeamMember, isPending: false }),
  useRemoveTeamMember: () => ({ mutateAsync: mockRemoveTeamMember, isPending: false }),
  useSetMemberAccess: () => ({ mutateAsync: mockSetMemberAccess, isPending: false }),
}));

vi.mock("@/lib/api/hooks/projects", () => ({
  useProjects: () => ({
    data: projectsData,
    isLoading: false,
  }),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    currentUser = {
      id: "user-1",
      email: "owner@example.com",
      firstName: "Owner",
      lastName: "User",
      role: "Owner",
      accountId: "acc-1",
    };
    seedData();

    mockUpdateProfile.mockResolvedValue({
      firstName: "Avery",
      lastName: "Admin",
      dateFormat: "dmy",
      defaultProjectId: "project-2",
      showAuditMetadata: false,
    });
    mockUpdateAccount.mockResolvedValue(accountData);
    mockCreateInvite.mockResolvedValue({
      joinUrl: "http://localhost:3000/register?invite=invite-token-1234",
    });
    mockDeleteCurrentUser.mockResolvedValue(undefined);
    mockLogout.mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mockClipboardWriteText },
    });
  });

  it("shows owner-only settings sections", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Workspace settings")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Team access")).toBeInTheDocument();
    expect(screen.getByText("Data management")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete workspace/i })).toBeInTheDocument();
  });

  it("hides admin-only sections for regular members", () => {
    currentUser = {
      id: "user-2",
      email: "member@example.com",
      firstName: "Morgan",
      lastName: "Member",
      role: "Member",
      accountId: "acc-1",
    };
    seedData();

    render(<SettingsPage />);

    expect(screen.queryByText("Workspace settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Team access")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete workspace/i })).not.toBeInTheDocument();
    expect(screen.getByText("Data management")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete my account/i })).toBeInTheDocument();
  });

  it("updates the current user profile and local auth state", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.clear(screen.getByLabelText(/first name/i));
    await user.type(screen.getByLabelText(/first name/i), "Avery");
    await user.clear(screen.getByLabelText(/last name/i));
    await user.type(screen.getByLabelText(/last name/i), "Admin");
    await user.click(screen.getByRole("combobox", { name: /date format/i }));
    // The select renders its options into a portal on open, so this must be the retrying query —
    // the synchronous one races the mount and fails intermittently under load.
    await user.click(await screen.findByRole("option", { name: "DD/MM/YYYY" }));
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        firstName: "Avery",
        lastName: "Admin",
        dateFormat: "dmy",
        defaultProjectId: "project-1",
        defaultLandingPage: "tracker",
        showAuditMetadata: true,
      });
    });

    expect(mockUpdateUser).toHaveBeenCalledWith({
      firstName: "Avery",
      lastName: "Admin",
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Profile updated.");
  });

  it("includes defaultLandingPage when saving profile", async () => {
    const user = userEvent.setup();
    mockUpdateProfile.mockResolvedValue({
      ...profileData,
      defaultLandingPage: "dashboard",
    });

    render(<SettingsPage />);

    const landingPageSelect = screen.getByRole("combobox", { name: /default landing page/i });
    await user.click(landingPageSelect);

    const dashboardOption = await screen.findByRole("option", { name: /dashboard/i });
    await user.click(dashboardOption);

    await user.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultLandingPage: "dashboard",
        }),
      );
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Profile updated.");
  });

  it("updates workspace audit retention settings", async () => {
    const user = userEvent.setup();
    mockUpdateAccount.mockResolvedValueOnce({
      ...accountData,
      auditRetentionDays: 730,
    });

    render(<SettingsPage />);

    fireEvent.change(screen.getByLabelText(/audit retention/i), { target: { value: "730" } });
    await user.click(screen.getByRole("button", { name: /save workspace settings/i }));

    await waitFor(() => {
      expect(mockUpdateAccount).toHaveBeenCalledWith({
        name: "TempoBase",
        timezone: "UTC",
        currency: "USD",
        auditRetentionDays: 730,
      });
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Workspace settings updated.");
  });

  it("blocks password changes when confirmation does not match", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(screen.getByLabelText("Current password", { selector: "#current-password" }), "old-password");
    await user.type(screen.getByLabelText("New password", { selector: "#new-password" }), "new-password-123");
    await user.type(screen.getByLabelText("Confirm new password", { selector: "#confirm-password" }), "different-password");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(mockChangePassword).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith("Could not update password.", {
      description: "New password confirmation does not match.",
    });
  });

  it("creates invite links and copies the join URL", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: /generate invite link/i }));

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith({});
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Invite link created.", {
      description: "The join URL was copied to your clipboard.",
    });
  });

  it("deletes a member account and redirects to login after logout", async () => {
    currentUser = {
      id: "user-2",
      email: "member@example.com",
      firstName: "Morgan",
      lastName: "Member",
      role: "Member",
      accountId: "acc-1",
    };
    seedData();

    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(screen.getByLabelText(/type delete my account/i), "DELETE MY ACCOUNT");
    await user.type(screen.getByLabelText(/^current password$/i, { selector: "#self-delete-password" }), "pw-123456");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    await waitFor(() => {
      expect(mockDeleteCurrentUser).toHaveBeenCalledWith({
        confirmationText: "DELETE MY ACCOUNT",
        currentPassword: "pw-123456",
      });
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Account deleted.", {
      description: "You will be redirected to sign in.",
    });
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("toggles canViewAmounts for a team member and calls updateTeamMember", async () => {
    const user = userEvent.setup();
    mockUpdateTeamMember.mockResolvedValue({ ...teamMembersData[1], canViewAmounts: false });

    render(<SettingsPage />);

    const switches = screen.getAllByRole("switch");
    // The "View amounts" switch for the non-self member (Morgan Member)
    const viewAmountsSwitch = switches.find((s) =>
      s.closest("[data-testid]") === null &&
      s.getAttribute("aria-checked") === "true"
    ) ?? switches[switches.length - 1];

    await user.click(viewAmountsSwitch);

    await waitFor(() => {
      expect(mockUpdateTeamMember).toHaveBeenCalledWith({
        memberId: "user-2",
        data: { canViewAmounts: false },
      });
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Member can no longer view amounts.");
  });

  it("shows parsed API validation errors in a toast for workspace deletion", async () => {
    mockDeleteWorkspace.mockRejectedValueOnce(
      new ApiError(400, "Confirmation text must be DELETE WORKSPACE.", ["Confirmation text must be DELETE WORKSPACE."]),
    );

    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(screen.getByLabelText(/type delete workspace/i), "WRONG");
    await user.type(screen.getByLabelText(/^current password$/i, { selector: "#workspace-delete-password" }), "pw-123456");
    await user.click(screen.getByRole("button", { name: /^delete workspace$/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Could not delete workspace.", {
        description: "Confirmation text must be DELETE WORKSPACE.",
      });
    });
  });
});
