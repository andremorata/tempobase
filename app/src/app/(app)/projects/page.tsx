"use client";

import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Pause,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  useArchiveProject,
  useDuplicateProject,
} from "@/lib/api/hooks/projects";
import { useClients } from "@/lib/api/hooks/clients";
import { useCurrentUserProfile } from "@/lib/api/hooks/account";
import { useSummaryReport } from "@/lib/api/hooks/reports";
import { TaskList } from "@/components/projects/task-list";
import { getApiErrorMessage } from "@/lib/api/client";
import { getBudgetProgress } from "@/lib/projects/budget";
import type {
  Project,
  CreateProjectRequest,
  BillingType,
  ProjectStatus,
} from "@/lib/api/types";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { hasRole, MANAGER_ROLES } from "@/lib/auth/roles";

const STATUS_COLORS: Record<string, string> = {
  Active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Inactive: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Archived: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const MIN_PERCENT_INSIDE_BAR = 15;

export default function ProjectsPage() {
  const { user } = useAuth();
  const canManage = hasRole(MANAGER_ROLES, user?.role);
  const { data: projects, isLoading } = useProjects(true);
  const { data: clients } = useClients();
  const { data: profile } = useCurrentUserProfile();
  const canViewAmounts = profile?.canViewAmounts ?? true;
  // The summary report limits Members to their own entries, so a budget balance would be wrong.
  const seesOnlyOwnHours = user?.role === "Member";
  const { data: summaryReport } = useSummaryReport({ groupBy: "Project" });
  const projectHoursMap = new Map(
    summaryReport?.groups.map((g) => [g.groupId, g.totalHours]) ?? [],
  );
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const archiveProject = useArchiveProject();
  const duplicateProject = useDuplicateProject();

  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showValues, setShowValues] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [clientId, setClientId] = useState<string | null>(null);
  const [billingType, setBillingType] = useState<BillingType>("Hourly");
  const [hourlyRate, setHourlyRate] = useState("");
  const [budgetHours, setBudgetHours] = useState("");

  const openCreate = () => {
    setEditingProject(null);
    setName("");
    setColor("#6366f1");
    setClientId(null);
    setBillingType("Hourly");
    setHourlyRate("");
    setBudgetHours("");
    setFormOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setName(project.name);
    setColor(project.color);
    setClientId(project.clientId ?? null);
    setBillingType(project.billingType);
    setHourlyRate(project.hourlyRate?.toString() ?? "");
    setBudgetHours(project.budgetHours?.toString() ?? "");
    setFormOpen(true);
  };

  const showErrorToast = (title: string, error: unknown, fallback: string) => {
    toast.error(title, {
      description: getApiErrorMessage(error, fallback),
    });
  };

  const handleSubmit = async () => {
    const data: CreateProjectRequest = {
      name,
      color,
      clientId: clientId || null,
      billingType,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
      budgetHours: budgetHours ? parseFloat(budgetHours) : null,
    };

    try {
      if (editingProject) {
        await updateProject.mutateAsync({ id: editingProject.id, data });
        toast.success("Project updated.");
      } else {
        await createProject.mutateAsync(data);
        toast.success("Project created.");
      }

      setFormOpen(false);
    } catch (error) {
      showErrorToast(
        editingProject ? "Could not update project." : "Could not create project.",
        error,
        editingProject ? "Failed to update project." : "Failed to create project.",
      );
    }
  };

  const handleArchive = async (project: Project) => {
    const isRestore = project.status === "Archived";
    try {
      await archiveProject.mutateAsync(project.id);
      toast.success(isRestore ? "Project restored." : "Project archived.");
    } catch (error) {
      showErrorToast(
        isRestore ? "Could not restore project." : "Could not archive project.",
        error,
        isRestore ? "Failed to restore project." : "Failed to archive project.",
      );
    }
  };

  const handleStatusChange = async (projectId: string, status: ProjectStatus) => {
    const isActivating = status === "Active";
    try {
      await updateProject.mutateAsync({ id: projectId, data: { status } });
      toast.success(isActivating ? "Project activated." : "Project deactivated.");
    } catch (error) {
      showErrorToast(
        isActivating ? "Could not activate project." : "Could not deactivate project.",
        error,
        "Failed to update project.",
      );
    }
  };

  const handleDuplicate = async (projectId: string) => {
    try {
      const copy = await duplicateProject.mutateAsync(projectId);
      toast.success("Project duplicated. It stays inactive until you activate it.");
      openEdit(copy);
    } catch (error) {
      showErrorToast("Could not duplicate project.", error, "Failed to duplicate project.");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await deleteProject.mutateAsync(deleteId);
      setDeleteId(null);
      toast.success("Project deleted.");
    } catch (error) {
      showErrorToast("Could not delete project.", error, "Failed to delete project.");
    }
  };

  const clientMap = new Map(clients?.map((c) => [c.id, c.name]) ?? []);
  const activeProjects = projects?.filter((p) => p.status === "Active") ?? [];
  const inactiveProjects = projects?.filter((p) => p.status === "Inactive") ?? [];
  const archivedProjects = projects?.filter((p) => p.status === "Archived") ?? [];

  const renderProject = (project: Project) => {
    const isExpanded = expandedId === project.id;
    const loggedHours = projectHoursMap.get(project.id) ?? 0;
    const budget = getBudgetProgress(loggedHours, project.budgetHours);
    const isOverBudget = budget !== null && budget.remainingHours < 0;
    const isArchived = project.status === "Archived";
    return (
      <div key={project.id} className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setExpandedId(isExpanded ? null : project.id)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          <span
            className="inline-block h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: project.color }}
          />
          <span className="font-medium flex-1">{project.name}</span>
          {project.clientId && (
            <span className="text-xs text-muted-foreground">
              {clientMap.get(project.clientId) ?? ""}
            </span>
          )}
          <Badge
            variant="secondary"
            className={STATUS_COLORS[project.status] ?? ""}
          >
            {project.status}
          </Badge>
          <div className={canManage ? "ml-auto flex gap-1" : "hidden"}>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => openEdit(project)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={duplicateProject.isPending}
              onClick={() => void handleDuplicate(project.id)}
              title="Duplicate"
              aria-label={`Duplicate ${project.name}`}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {project.status === "Active" && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void handleStatusChange(project.id, "Inactive")}
                title="Deactivate"
                aria-label={`Deactivate ${project.name}`}
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            )}
            {project.status === "Inactive" && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void handleStatusChange(project.id, "Active")}
                title="Activate"
                aria-label={`Activate ${project.name}`}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void handleArchive(project)}
              title={isArchived ? "Restore" : "Archive"}
              aria-label={`${isArchived ? "Restore" : "Archive"} ${project.name}`}
            >
              {isArchived ? (
                <ArchiveRestore className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setDeleteId(project.id)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
        {budget !== null && seesOnlyOwnHours && (
          <p className="px-4 pb-2.5 pl-12 text-xs text-muted-foreground">
            {loggedHours.toFixed(1)} hrs logged by you
          </p>
        )}
        {budget !== null && !seesOnlyOwnHours && (
          <div className="px-4 pb-2.5 pl-12 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{loggedHours.toFixed(1)} hrs logged</span>
              <span className={isOverBudget ? "text-destructive font-medium" : ""}>
                {isOverBudget
                  ? `${Math.abs(budget.remainingHours).toFixed(1)} hrs over`
                  : `${budget.remainingHours.toFixed(1)} hrs left`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`Budget used by ${project.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(budget.percent, 100)}
              aria-valuetext={`${budget.percent}%`}
              className="flex h-5 w-full items-center overflow-hidden rounded-full bg-muted text-xs font-semibold tabular-nums"
            >
              <div
                className={`flex h-full items-center justify-end rounded-full transition-all ${
                  isOverBudget
                    ? "bg-destructive text-white dark:text-zinc-950"
                    : budget.percent > 80
                      ? "bg-amber-500 text-zinc-950"
                      : "bg-emerald-500 text-zinc-950"
                }`}
                style={{ width: `${Math.min(budget.percent, 100)}%` }}
              >
                {budget.percent >= MIN_PERCENT_INSIDE_BAR && (
                  <span className="px-2">{budget.percent}%</span>
                )}
              </div>
              {/* A short fill has no room for the label, so it sits right after the fill. */}
              {budget.percent < MIN_PERCENT_INSIDE_BAR && (
                <span className="px-1.5 text-muted-foreground">{budget.percent}%</span>
              )}
            </div>
          </div>
        )}
        {isExpanded && (
          <div className="border-t px-4 py-3 pl-12">
            <TaskList projectId={project.id} showRates={showValues} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <div className="flex items-center gap-2">
          {(canManage || canViewAmounts) && (
            <Button
              variant="outline"
              size="sm"
              aria-pressed={showValues}
              onClick={() => setShowValues((current) => !current)}
            >
              {showValues ? (
                <EyeOff className="mr-1.5 h-4 w-4" />
              ) : (
                <Eye className="mr-1.5 h-4 w-4" />
              )}
              {showValues ? "Hide values" : "Show values"}
            </Button>
          )}
          {canManage && (
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Add project
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-muted-foreground text-center py-8">Loading…</p>
      )}

      {!isLoading && projects?.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          No projects yet. Create your first project to get started.
        </p>
      )}

      {activeProjects.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Active ({activeProjects.length})
          </h2>
          {activeProjects.map(renderProject)}
        </section>
      )}

      {inactiveProjects.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Inactive ({inactiveProjects.length})
          </h2>
          {inactiveProjects.map(renderProject)}
        </section>
      )}

      {archivedProjects.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
            Archived ({archivedProjects.length})
          </summary>
          <div className="space-y-2 pt-2">{archivedProjects.map(renderProject)}</div>
        </details>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProject ? "Edit project" : "New project"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="proj-name">Name *</Label>
              <Input
                id="proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
              />
            </div>
            <div className="flex items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="proj-color">Color</Label>
                <Input
                  id="proj-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-16 p-1"
                />
              </div>
              <div className="space-y-2 flex-1">
                <Label>Client</Label>
                <Select
                  value={clientId ?? ""}
                  onValueChange={(v) => setClientId(v || null)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No client">
                      {clientId ? (clientMap.get(clientId) ?? "Unknown client") : "No client"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No client</SelectItem>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {canViewAmounts && (
              <div className="space-y-2">
                <Label>Billing type</Label>
                <div className="flex items-center gap-4">
                  <Select
                    value={billingType}
                    onValueChange={(v) => setBillingType(v as BillingType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Hourly">Hourly</SelectItem>
                      <SelectItem value="Fixed">Fixed</SelectItem>
                      <SelectItem value="NonBillable">Non-billable</SelectItem>
                    </SelectContent>
                  </Select>
                  {billingType === "Hourly" && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="proj-rate" className="whitespace-nowrap">
                        Rate/hr
                      </Label>
                      <div className="relative w-28">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                          $
                        </span>
                        <Input
                          id="proj-rate"
                          type="number"
                          min="0"
                          step="0.01"
                          value={hourlyRate}
                          onChange={(e) => setHourlyRate(e.target.value)}
                          className="pl-6"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="proj-budget">Budget (hours)</Label>
              <Input
                id="proj-budget"
                type="number"
                min="0"
                step="0.5"
                value={budgetHours}
                onChange={(e) => setBudgetHours(e.target.value)}
                placeholder="No budget"
              />
            </div>
          </div>
          <DialogFooter className="flex-col items-stretch gap-2 sm:items-center">
            <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !name.trim() ||
                createProject.isPending ||
                updateProject.isPending
              }
            >
              {editingProject ? "Save changes" : "Create project"}
            </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete project"
        description="This project and its tasks will be archived. Time entries will remain."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteProject.isPending}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
