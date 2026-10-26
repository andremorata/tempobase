"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveX, ChevronDown, Copy, Download, FolderOpen, KeyRound, Link2, ListTodo, Shield, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import {
  useAccount,
  useChangePassword,
  useCurrentUserProfile,
  useDeleteCurrentUser,
  useDeleteWorkspace,
  useExportAccount,
  usePurgeTimeEntries,
  useUpdateAccount,
  useUpdateMyProfile,
} from "@/lib/api/hooks/account";
import { useProjects } from "@/lib/api/hooks/projects";
import {
  useCreateInvite,
  useInvites,
  useRemoveTeamMember,
  useRevokeInvite,
  useSetMemberAccess,
  useTeamMembers,
  useUpdateTeamMember,
} from "@/lib/api/hooks/team";
import { getApiErrorMessage } from "@/lib/api/client";
import type { TeamMember } from "@/lib/api/types";

const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Lisbon",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

const CURRENCIES = ["USD", "EUR", "GBP", "BRL", "CAD", "AUD", "JPY"] as const;
const MANAGED_TEAM_ROLES = ["Admin", "Manager", "Member", "Viewer"] as const;
const DATE_FORMATS = [
  { value: "system", label: "System locale" },
  { value: "ymd", label: "YYYY-MM-DD" },
  { value: "dmy", label: "DD/MM/YYYY" },
  { value: "mdy", label: "MM/DD/YYYY" },
] as const;

const LANDING_PAGES = [
  { value: "tracker", label: "Tracker" },
  { value: "dashboard", label: "Dashboard" },
  { value: "timesheet", label: "Timesheet" },
] as const;

interface AccountDraft {
  name: string;
  timezone: string;
  currency: string;
  auditRetentionDays: number;
}

interface ProfileDraft {
  firstName: string;
  lastName: string;
  dateFormat: "system" | "ymd" | "dmy" | "mdy";
  defaultProjectId: string | null;
  defaultLandingPage: "dashboard" | "tracker" | "timesheet";
  showAuditMetadata: boolean;
}

interface MemberAccess {
  projectIds: string[];
  taskIds: string[];
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, updateUser, login, logout } = useAuth();
  const isOwner = user?.role === "Owner";
  const isAccountAdmin = user?.role === "Owner" || user?.role === "Admin";

  const { data: account, isLoading: isAccountLoading } = useAccount();
  const { data: profile, isLoading: isProfileLoading } = useCurrentUserProfile();
  const updateAccount = useUpdateAccount();
  const updateProfile = useUpdateMyProfile();
  const changePassword = useChangePassword();
  const deleteCurrentUser = useDeleteCurrentUser();
  const deleteWorkspace = useDeleteWorkspace();
  const exportAccount = useExportAccount();
  const purgeTimeEntries = usePurgeTimeEntries();

  const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, string>>({});
  const [memberAmountDrafts, setMemberAmountDrafts] = useState<Record<string, boolean>>({});
  const [memberAccessDrafts, setMemberAccessDrafts] = useState<Record<string, MemberAccess>>({});
  const [purgeFrom, setPurgeFrom] = useState("");
  const [purgeTo, setPurgeTo] = useState("");
  const [selfDeletePassword, setSelfDeletePassword] = useState("");
  const [selfDeleteConfirmation, setSelfDeleteConfirmation] = useState("");
  const [workspaceDeletePassword, setWorkspaceDeletePassword] = useState("");
  const [workspaceDeleteConfirmation, setWorkspaceDeleteConfirmation] = useState("");

  const { data: teamMembers, isLoading: isTeamLoading } = useTeamMembers();
  const { data: invites, isLoading: isInvitesLoading } = useInvites(isAccountAdmin);
  const { data: projects } = useProjects();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const updateTeamMember = useUpdateTeamMember();
  const removeTeamMember = useRemoveTeamMember();
  const setMemberAccess = useSetMemberAccess();

  const accountName = accountDraft?.name ?? account?.name ?? "";
  const timezone = accountDraft?.timezone ?? account?.timezone ?? "UTC";
  const currency = accountDraft?.currency ?? account?.currency ?? "USD";
  const auditRetentionDays = accountDraft?.auditRetentionDays ?? account?.auditRetentionDays ?? 365;
  const firstName = profileDraft?.firstName ?? profile?.firstName ?? "";
  const lastName = profileDraft?.lastName ?? profile?.lastName ?? "";
  const dateFormat = profileDraft?.dateFormat ?? profile?.dateFormat ?? "system";
  const defaultProjectId = profileDraft?.defaultProjectId ?? profile?.defaultProjectId ?? null;
  const defaultLandingPage = profileDraft?.defaultLandingPage ?? profile?.defaultLandingPage ?? "tracker";
  const showAuditMetadata = profileDraft?.showAuditMetadata ?? profile?.showAuditMetadata ?? true;
  const activeProjects = (projects ?? []).filter((project) => project.status === "Active");

  const allTasks = useMemo(
    () =>
      (projects ?? []).flatMap((p) =>
        (p.tasks ?? []).map((t) => ({
          ...t,
          projectName: p.name,
          projectColor: p.color,
        }))
      ),
    [projects]
  );

  const getMemberAccess = (member: TeamMember): MemberAccess =>
    memberAccessDrafts[member.id] ?? {
      projectIds: member.allowedProjectIds,
      taskIds: member.allowedTaskIds,
    };

  const updateAccountDraft = (patch: Partial<AccountDraft>) => {
    setAccountDraft((current) => ({
      name: patch.name ?? current?.name ?? account?.name ?? "",
      timezone: patch.timezone ?? current?.timezone ?? account?.timezone ?? "UTC",
      currency: patch.currency ?? current?.currency ?? account?.currency ?? "USD",
      auditRetentionDays: patch.auditRetentionDays ?? current?.auditRetentionDays ?? account?.auditRetentionDays ?? 365,
    }));
  };

  const updateProfileDraft = (patch: Partial<ProfileDraft>) => {
    setProfileDraft((current) => ({
      firstName: patch.firstName ?? current?.firstName ?? profile?.firstName ?? "",
      lastName: patch.lastName ?? current?.lastName ?? profile?.lastName ?? "",
      dateFormat: patch.dateFormat ?? current?.dateFormat ?? profile?.dateFormat ?? "system",
      defaultProjectId: patch.defaultProjectId ?? current?.defaultProjectId ?? profile?.defaultProjectId ?? null,
      defaultLandingPage: patch.defaultLandingPage ?? current?.defaultLandingPage ?? profile?.defaultLandingPage ?? "tracker",
      showAuditMetadata: patch.showAuditMetadata ?? current?.showAuditMetadata ?? profile?.showAuditMetadata ?? true,
    }));
  };

  const showErrorToast = (title: string, error: unknown, fallback: string) => {
    const message = getApiErrorMessage(error, fallback);
    toast.error(title, {
      description: message === title ? undefined : message,
    });
  };

  const handleSaveAccount = async () => {
    try {
      const updated = await updateAccount.mutateAsync({
        name: accountName,
        timezone,
        currency,
        auditRetentionDays,
      });
      setAccountDraft({
        name: updated.name,
        timezone: updated.timezone,
        currency: updated.currency,
        auditRetentionDays: updated.auditRetentionDays,
      });
      toast.success("Workspace settings updated.");
    } catch (error) {
      showErrorToast("Could not update workspace settings.", error, "Failed to update account settings.");
    }
  };

  const handleSaveProfile = async () => {
    try {
      const updated = await updateProfile.mutateAsync({
        firstName,
        lastName,
        dateFormat,
        defaultProjectId,
        defaultLandingPage,
        showAuditMetadata,
      });
      setProfileDraft({
        firstName: updated.firstName,
        lastName: updated.lastName,
        dateFormat: updated.dateFormat,
        defaultProjectId: updated.defaultProjectId ?? null,
        defaultLandingPage: updated.defaultLandingPage,
        showAuditMetadata: updated.showAuditMetadata,
      });
      updateUser({ firstName: updated.firstName, lastName: updated.lastName });
      toast.success("Profile updated.");
    } catch (error) {
      showErrorToast("Could not update profile.", error, "Failed to update profile.");
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Could not update password.", {
        description: "New password confirmation does not match.",
      });
      return;
    }

    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      // A password change revokes every existing session, this one included; sign back in here.
      if (user?.email) {
        await login({ email: user.email, password: newPassword });
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated.");
    } catch (error) {
      showErrorToast("Could not update password.", error, "Failed to change password.");
    }
  };

  const handleCreateInvite = async () => {
    try {
      const invite = await createInvite.mutateAsync({});
      await navigator.clipboard.writeText(invite.joinUrl);
      toast.success("Invite link created.", {
        description: "The join URL was copied to your clipboard.",
      });
    } catch (error) {
      showErrorToast("Could not create invite link.", error, "Failed to create invite link.");
    }
  };

  const handleCopyInvite = async (joinUrl: string) => {
    await navigator.clipboard.writeText(joinUrl);
    toast.success("Invite link copied.");
  };

  const handleRevokeInvite = async (token: string) => {
    try {
      await revokeInvite.mutateAsync(token);
      toast.success("Invite link revoked.");
    } catch (error) {
      showErrorToast("Could not revoke invite link.", error, "Failed to revoke invite link.");
    }
  };

  const handleUpdateMemberRole = async (memberId: string) => {
    const nextRole = memberRoleDrafts[memberId];
    if (!nextRole) return;

    try {
      await updateTeamMember.mutateAsync({
        memberId,
        data: { role: nextRole as (typeof MANAGED_TEAM_ROLES)[number] },
      });
      toast.success("Member role updated.");
    } catch (error) {
      showErrorToast("Could not update member role.", error, "Failed to update member role.");
    }
  };

  const handleToggleCanViewAmounts = async (memberId: string, checked: boolean) => {
    setMemberAmountDrafts((current) => ({ ...current, [memberId]: checked }));
    try {
      await updateTeamMember.mutateAsync({
        memberId,
        data: { canViewAmounts: checked },
      });
      toast.success(checked ? "Member can now view amounts." : "Member can no longer view amounts.");
    } catch (error) {
      // Revert optimistic update on failure
      setMemberAmountDrafts((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      showErrorToast("Could not update amount visibility.", error, "Failed to update amount visibility.");
    }
  };

  const handleAccessChange = async (memberId: string, projectIds: string[], taskIds: string[]) => {
    setMemberAccessDrafts((prev) => ({ ...prev, [memberId]: { projectIds, taskIds } }));
    try {
      await setMemberAccess.mutateAsync({ memberId, projectIds, taskIds });
    } catch (error) {
      setMemberAccessDrafts((prev) => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
      showErrorToast("Could not update member access.", error, "Failed to update member access.");
    }
  };

  const toggleMemberProject = (member: TeamMember, projectId: string) => {
    const current = getMemberAccess(member);
    const projectIds = current.projectIds.includes(projectId)
      ? current.projectIds.filter((id) => id !== projectId)
      : [...current.projectIds, projectId];
    void handleAccessChange(member.id, projectIds, current.taskIds);
  };

  const toggleMemberTask = (member: TeamMember, taskId: string) => {
    const current = getMemberAccess(member);
    const taskIds = current.taskIds.includes(taskId)
      ? current.taskIds.filter((id) => id !== taskId)
      : [...current.taskIds, taskId];
    void handleAccessChange(member.id, current.projectIds, taskIds);
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeTeamMember.mutateAsync(memberId);
      toast.success("Member removed from the workspace.");
    } catch (error) {
      showErrorToast("Could not remove member.", error, "Failed to remove member.");
    }
  };

  const handleExportAccount = async () => {
    try {
      const data = await exportAccount.mutateAsync();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.account.slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Workspace export downloaded.");
    } catch (error) {
      showErrorToast("Could not export workspace data.", error, "Failed to export workspace data.");
    }
  };

  const handlePurgeTimeEntries = async () => {
    if (!purgeFrom && !purgeTo) {
      toast.error("Could not purge time entries.", {
        description: "Choose at least one boundary date before purging.",
      });
      return;
    }

    try {
      const result = await purgeTimeEntries.mutateAsync({
        from: purgeFrom || null,
        to: purgeTo || null,
      });
      toast.success("Time entries purged.", {
        description: `Purged ${result.purgedCount} time entr${result.purgedCount === 1 ? "y" : "ies"}.`,
      });
    } catch (error) {
      showErrorToast("Could not purge time entries.", error, "Failed to purge time entries.");
    }
  };

  const handleDeleteCurrentUser = async () => {
    try {
      await deleteCurrentUser.mutateAsync({
        confirmationText: selfDeleteConfirmation,
        currentPassword: selfDeletePassword,
      });
      toast.success("Account deleted.", {
        description: isOwner ? "The workspace is being removed and you will be redirected." : "You will be redirected to sign in.",
      });
      await logout();
      router.replace(isOwner ? "/register" : "/login");
    } catch (error) {
      showErrorToast("Could not delete your account.", error, "Failed to purge your account.");
    }
  };

  const handleDeleteWorkspace = async () => {
    try {
      await deleteWorkspace.mutateAsync({
        confirmationText: workspaceDeleteConfirmation,
        currentPassword: workspaceDeletePassword,
      });
      toast.success("Workspace deleted.", {
        description: "You will be redirected to create a new workspace.",
      });
      await logout();
      router.replace("/register");
    } catch (error) {
      showErrorToast("Could not delete workspace.", error, "Failed to delete the workspace.");
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your workspace, your profile, and your account security.
        </p>
      </div>

      {isOwner && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-600" />
              <CardTitle>Workspace settings</CardTitle>
            </div>
            <CardDescription>
                Control workspace identity, reporting defaults, and audit retention.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="account-name">Workspace name</Label>
                <Input
                  id="account-name"
                  value={accountName}
                  disabled={isAccountLoading || updateAccount.isPending}
                  onChange={(event) => updateAccountDraft({ name: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select
                  value={timezone}
                  onValueChange={(value) => updateAccountDraft({ timezone: value ?? "UTC" })}
                  disabled={isAccountLoading || updateAccount.isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={currency}
                  onValueChange={(value) => updateAccountDraft({ currency: value ?? "USD" })}
                  disabled={isAccountLoading || updateAccount.isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="audit-retention-days">Audit retention (days)</Label>
                <Input
                  id="audit-retention-days"
                  type="number"
                  min={30}
                  max={3650}
                  value={auditRetentionDays}
                  disabled={isAccountLoading || updateAccount.isPending}
                  onChange={(event) => updateAccountDraft({ auditRetentionDays: Number(event.target.value || 365) })}
                />
              </div>
            </div>

            <Button onClick={handleSaveAccount} disabled={updateAccount.isPending || isAccountLoading}>
              {updateAccount.isPending ? "Saving…" : "Save workspace settings"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-emerald-600" />
            <CardTitle>Profile</CardTitle>
          </div>
          <CardDescription>
              Update the name other people in your workspace will see and your personal working defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first-name">First name</Label>
              <Input
                id="first-name"
                value={firstName}
                disabled={isProfileLoading || updateProfile.isPending}
                onChange={(event) => updateProfileDraft({ firstName: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="last-name">Last name</Label>
              <Input
                id="last-name"
                value={lastName}
                disabled={isProfileLoading || updateProfile.isPending}
                onChange={(event) => updateProfileDraft({ lastName: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Date format</Label>
              <Select
                value={dateFormat}
                onValueChange={(value) => updateProfileDraft({ dateFormat: value as ProfileDraft["dateFormat"] })}
                disabled={isProfileLoading || updateProfile.isPending}
              >
                <SelectTrigger aria-label="Date format">
                  <SelectValue placeholder="Select a date format">
                    {DATE_FORMATS.find((f) => f.value === dateFormat)?.label ?? "Select a date format"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Default project</Label>
              <Select
                value={defaultProjectId ?? "none"}
                onValueChange={(value) => updateProfileDraft({ defaultProjectId: value === "none" ? null : value })}
                disabled={isProfileLoading || updateProfile.isPending}
              >
                <SelectTrigger aria-label="Default project">
                  <SelectValue placeholder="Select a default project">
                    {defaultProjectId
                      ? activeProjects.find((p) => p.id === defaultProjectId)?.name ?? "Select a default project"
                      : "No default project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No default project</SelectItem>
                  {activeProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Default landing page</Label>
              <Select
                value={defaultLandingPage}
                onValueChange={(value) => updateProfileDraft({ defaultLandingPage: value as ProfileDraft["defaultLandingPage"] })}
                disabled={isProfileLoading || updateProfile.isPending}
              >
                <SelectTrigger aria-label="Default landing page">
                  <SelectValue placeholder="Select a landing page">
                    {LANDING_PAGES.find((p) => p.value === defaultLandingPage)?.label ?? "Select a landing page"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LANDING_PAGES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="email-address">Email address</Label>
              <Input id="email-address" value={profile?.email ?? user?.email ?? ""} disabled />
            </div>

            <div data-testid="profile-audit-metadata" className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 p-4 md:col-span-2">
              <div className="space-y-1">
                <Label htmlFor="show-audit-metadata">Show audit field changes</Label>
                <p className="text-sm text-muted-foreground">
                  Display the detailed field-level change payload on the audit page.
                </p>
              </div>
              <Switch
                id="show-audit-metadata"
                checked={showAuditMetadata}
                onCheckedChange={(checked) => updateProfileDraft({ showAuditMetadata: checked })}
                disabled={isProfileLoading || updateProfile.isPending}
              />
            </div>
          </div>

          <Button onClick={handleSaveProfile} disabled={updateProfile.isPending || isProfileLoading}>
            {updateProfile.isPending ? "Saving…" : "Save profile"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-600" />
            <CardTitle>Password</CardTitle>
          </div>
          <CardDescription>
            Change your password without leaving the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                disabled={changePassword.isPending}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                disabled={changePassword.isPending}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                disabled={changePassword.isPending}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
          </div>

          <Button onClick={handleChangePassword} disabled={changePassword.isPending}>
            {changePassword.isPending ? "Updating…" : "Update password"}
          </Button>
        </CardContent>
      </Card>

      {isAccountAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-600" />
              <CardTitle>Team access</CardTitle>
            </div>
            <CardDescription>
              Review current workspace members and generate invite links for new people.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Invite someone new</p>
                <p className="text-sm text-muted-foreground">
                  Generate a shareable registration link for a new member.
                </p>
              </div>
              <Button onClick={handleCreateInvite} disabled={createInvite.isPending}>
                <Link2 className="mr-2 h-4 w-4" />
                {createInvite.isPending ? "Generating…" : "Generate invite link"}
              </Button>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Members
              </h2>
              <div className="space-y-2">
                {isTeamLoading && <p className="text-sm text-muted-foreground">Loading team members…</p>}

                {teamMembers?.map((member) => (
                  <div key={member.id} className="rounded-xl border border-border/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {member.firstName} {member.lastName}
                          </p>
                          <Badge variant="secondary">{member.role}</Badge>
                          {member.id === user?.id && <Badge variant="outline">You</Badge>}
                          {!member.isActive && <Badge variant="outline">Inactive</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">{member.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Joined {new Date(member.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      {member.id !== user?.id && member.role !== "Owner" && (
                        <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[320px]">
                          <div className="flex flex-col gap-2 md:flex-row">
                            <Select
                              value={memberRoleDrafts[member.id] ?? member.role}
                              onValueChange={(value) =>
                                setMemberRoleDrafts((current) => ({
                                  ...current,
                                  [member.id]: value ?? member.role,
                                }))
                              }
                              disabled={
                                updateTeamMember.isPending ||
                                removeTeamMember.isPending ||
                                (user?.role === "Admin" && member.role === "Admin")
                              }
                            >
                              <SelectTrigger className="w-full md:w-45">
                                <SelectValue placeholder="Select a role" />
                              </SelectTrigger>
                              <SelectContent>
                                {MANAGED_TEAM_ROLES.filter(
                                  (role) => !(user?.role === "Admin" && role === "Admin"),
                                ).map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {role}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Button
                              variant="outline"
                              onClick={() => handleUpdateMemberRole(member.id)}
                              disabled={
                                updateTeamMember.isPending ||
                                removeTeamMember.isPending ||
                                (memberRoleDrafts[member.id] ?? member.role) === member.role ||
                                (user?.role === "Admin" && member.role === "Admin")
                              }
                            >
                              Save role
                            </Button>
                          </div>

                          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium">View amounts</p>
                              <p className="text-xs text-muted-foreground">Allow this member to see monetary values</p>
                            </div>
                            <Switch
                              checked={memberAmountDrafts[member.id] ?? member.canViewAmounts}
                              onCheckedChange={(checked) => handleToggleCanViewAmounts(member.id, checked)}
                              disabled={
                                updateTeamMember.isPending ||
                                removeTeamMember.isPending ||
                                (user?.role === "Admin" && member.role === "Admin")
                              }
                            />
                          </div>

                          <div className="rounded-lg border border-border/60 px-3 py-2 space-y-2">
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium">Project &amp; task access</p>
                              <p className="text-xs text-muted-foreground">
                                Restrict which projects and tasks this member can interact with. Empty means full access.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {/* Project multi-select */}
                              <Popover>
                                <PopoverTrigger
                                  className={cn(
                                    buttonVariants({ variant: "outline", size: "sm" }),
                                    "gap-1.5 h-8"
                                  )}
                                >
                                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                                  {getMemberAccess(member).projectIds.length === 0
                                    ? "All projects"
                                    : getMemberAccess(member).projectIds.length === 1
                                      ? "1 project"
                                      : `${getMemberAccess(member).projectIds.length} projects`}
                                  <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                                </PopoverTrigger>
                                <PopoverContent side="bottom" align="start" className="w-64 p-0">
                                  <Command>
                                    <CommandInput placeholder="Search projects…" />
                                    <CommandList>
                                      <CommandEmpty>No projects found.</CommandEmpty>
                                      {(projects ?? []).map((p) => (
                                        <CommandItem
                                          key={p.id}
                                          value={p.name}
                                          data-checked={getMemberAccess(member).projectIds.includes(p.id)}
                                          onSelect={() => toggleMemberProject(member, p.id)}
                                        >
                                          <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ background: p.color }}
                                          />
                                          {p.name}
                                        </CommandItem>
                                      ))}
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>

                              {/* Task multi-select */}
                              <Popover>
                                <PopoverTrigger
                                  className={cn(
                                    buttonVariants({ variant: "outline", size: "sm" }),
                                    "gap-1.5 h-8"
                                  )}
                                >
                                  <ListTodo className="h-3.5 w-3.5 shrink-0" />
                                  {getMemberAccess(member).taskIds.length === 0
                                    ? "All tasks"
                                    : getMemberAccess(member).taskIds.length === 1
                                      ? "1 task"
                                      : `${getMemberAccess(member).taskIds.length} tasks`}
                                  <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                                </PopoverTrigger>
                                <PopoverContent side="bottom" align="start" className="w-64 p-0">
                                  <Command>
                                    <CommandInput placeholder="Search tasks…" />
                                    <CommandList>
                                      <CommandEmpty>No tasks found.</CommandEmpty>
                                      {allTasks.map((t) => (
                                        <CommandItem
                                          key={t.id}
                                          value={t.name}
                                          data-checked={getMemberAccess(member).taskIds.includes(t.id)}
                                          onSelect={() => toggleMemberTask(member, t.id)}
                                        >
                                          <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ background: t.projectColor ?? "#6366f1" }}
                                          />
                                          <span className="flex-1 truncate">{t.name}</span>
                                          <span className="ml-auto text-xs text-muted-foreground shrink-0">
                                            {t.projectName}
                                          </span>
                                        </CommandItem>
                                      ))}
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>

                          <Button
                            variant="destructive"
                            onClick={() => handleRemoveMember(member.id)}
                            disabled={
                              updateTeamMember.isPending ||
                              removeTeamMember.isPending ||
                              (user?.role === "Admin" && member.role === "Admin")
                            }
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove member
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {!isTeamLoading && (!teamMembers || teamMembers.length === 0) && (
                  <p className="text-sm text-muted-foreground">No members found for this workspace.</p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Active invites
              </h2>
              <div className="space-y-2">
                {isInvitesLoading && <p className="text-sm text-muted-foreground">Loading invite links…</p>}

                {!isInvitesLoading && (!invites || invites.length === 0) && (
                  <p className="text-sm text-muted-foreground">No active invite links yet.</p>
                )}

                {invites?.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-col gap-3 rounded-xl border border-border/60 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">Invite token: {invite.token.slice(0, 8)}…</p>
                      <p className="text-xs text-muted-foreground">
                        Expires {new Date(invite.expiresAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input value={invite.joinUrl} readOnly className="flex-1" />
                      <Button variant="outline" onClick={() => handleCopyInvite(invite.joinUrl)}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleRevokeInvite(invite.token)}
                        disabled={revokeInvite.isPending}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {user && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArchiveX className="h-4 w-4 text-emerald-600" />
              <CardTitle>Data management</CardTitle>
            </div>
            <CardDescription>
              Export, purge, or delete data with explicit confirmation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isAccountAdmin && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Full workspace export</p>
                    <p className="text-sm text-muted-foreground">
                      Download account settings, members, clients, projects, tasks, tags, and time entries as JSON.
                    </p>
                  </div>
                  <Button onClick={handleExportAccount} disabled={exportAccount.isPending}>
                    <Download className="mr-2 h-4 w-4" />
                    {exportAccount.isPending ? "Exporting…" : "Export workspace"}
                  </Button>
                </div>

                <div className="space-y-4 rounded-xl border border-border/70 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Purge time entries by date</p>
                    <p className="text-sm text-muted-foreground">
                      This removes time entries inside the selected date window from the workspace.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="purge-from">From</Label>
                      <Input
                        id="purge-from"
                        type="date"
                        value={purgeFrom}
                        disabled={purgeTimeEntries.isPending}
                        onChange={(event) => setPurgeFrom(event.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="purge-to">To</Label>
                      <Input
                        id="purge-to"
                        type="date"
                        value={purgeTo}
                        disabled={purgeTimeEntries.isPending}
                        onChange={(event) => setPurgeTo(event.target.value)}
                      />
                    </div>
                  </div>

                  <Button
                    variant="destructive"
                    onClick={handlePurgeTimeEntries}
                    disabled={purgeTimeEntries.isPending}
                  >
                    <ArchiveX className="mr-2 h-4 w-4" />
                    {purgeTimeEntries.isPending ? "Purging…" : "Purge matching time entries"}
                  </Button>
                </div>
              </>
            )}

            <div className="space-y-4 rounded-xl border border-border/70 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Delete your account</p>
                <p className="text-sm text-muted-foreground">
                  This permanently removes your membership and personal data. If you are the owner, this deletes the full workspace.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="self-delete-confirmation">Type DELETE MY ACCOUNT</Label>
                  <Input
                    id="self-delete-confirmation"
                    value={selfDeleteConfirmation}
                    disabled={deleteCurrentUser.isPending}
                    onChange={(event) => setSelfDeleteConfirmation(event.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="self-delete-password">Current password</Label>
                  <Input
                    id="self-delete-password"
                    type="password"
                    value={selfDeletePassword}
                    disabled={deleteCurrentUser.isPending}
                    onChange={(event) => setSelfDeletePassword(event.target.value)}
                  />
                </div>
              </div>

              <Button
                variant="destructive"
                onClick={handleDeleteCurrentUser}
                disabled={deleteCurrentUser.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {deleteCurrentUser.isPending ? "Deleting…" : "Delete my account"}
              </Button>
            </div>

            {isOwner && (
              <div className="space-y-4 rounded-xl border border-destructive/30 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">Delete workspace</p>
                  <p className="text-sm text-muted-foreground">
                    This permanently deletes the workspace and every associated member, client, project, task, tag, report, and time entry.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="workspace-delete-confirmation">Type DELETE WORKSPACE</Label>
                    <Input
                      id="workspace-delete-confirmation"
                      value={workspaceDeleteConfirmation}
                      disabled={deleteWorkspace.isPending}
                      onChange={(event) => setWorkspaceDeleteConfirmation(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="workspace-delete-password">Current password</Label>
                    <Input
                      id="workspace-delete-password"
                      type="password"
                      value={workspaceDeletePassword}
                      disabled={deleteWorkspace.isPending}
                      onChange={(event) => setWorkspaceDeletePassword(event.target.value)}
                    />
                  </div>
                </div>

                <Button
                  variant="destructive"
                  onClick={handleDeleteWorkspace}
                  disabled={deleteWorkspace.isPending}
                >
                  <ArchiveX className="mr-2 h-4 w-4" />
                  {deleteWorkspace.isPending ? "Deleting workspace…" : "Delete workspace"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
