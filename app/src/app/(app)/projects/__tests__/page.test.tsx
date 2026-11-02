import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "Owner",
  canViewAmounts: true,
  projects: [] as Array<Record<string, unknown>>,
  hours: [] as Array<{ groupId: string; totalHours: number }>,
  duplicate: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
}));

const mutation = (mutateAsync = vi.fn()) => ({ mutateAsync, isPending: false });

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", role: state.role } }),
}));
vi.mock("@/lib/api/hooks/projects", () => ({
  useProjects: () => ({ data: state.projects, isLoading: false }),
  useCreateProject: () => mutation(),
  useUpdateProject: () => mutation(state.update),
  useDeleteProject: () => mutation(),
  useArchiveProject: () => mutation(state.archive),
  useDuplicateProject: () => mutation(state.duplicate),
}));
vi.mock("@/lib/api/hooks/clients", () => ({ useClients: () => ({ data: [] }) }));
vi.mock("@/lib/api/hooks/account", () => ({
  useCurrentUserProfile: () => ({ data: { canViewAmounts: state.canViewAmounts } }),
}));
vi.mock("@/lib/api/hooks/reports", () => ({
  useSummaryReport: () => ({ data: { groups: state.hours } }),
}));
vi.mock("@/lib/api/hooks/tasks", () => ({
  useProjectTasks: () => ({
    data: [{ id: "t1", name: "Design", hourlyRate: 90, isActive: true }],
  }),
  useCreateTask: () => mutation(),
  useUpdateTask: () => mutation(),
  useDeleteTask: () => mutation(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ProjectsPage from "../page";

const project = (id: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: id,
  status,
  color: "#123456",
  billingType: "Hourly",
  budgetHours: null,
  hourlyRate: null,
  clientId: null,
  ...overrides,
});

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.role = "Owner";
    state.canViewAmounts = true;
    state.hours = [];
    state.projects = [
      project("Archived one", "Archived"),
      project("Inactive one", "Inactive"),
      project("Active one", "Active"),
    ];
  });

  it("orders the groups Active, Inactive, Archived and keeps Archived collapsed", () => {
    const { container } = render(<ProjectsPage />);

    const text = container.textContent ?? "";
    expect(text.indexOf("Active (1)")).toBeLessThan(text.indexOf("Inactive (1)"));
    expect(text.indexOf("Inactive (1)")).toBeLessThan(text.indexOf("Archived (1)"));

    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText("Archived one")).toBeDefined();
  });

  it("offers the status actions that fit each group", () => {
    render(<ProjectsPage />);

    expect(screen.getByRole("button", { name: "Deactivate Active one", hidden: true })).toBeDefined();
    expect(screen.getByRole("button", { name: "Activate Inactive one", hidden: true })).toBeDefined();
    expect(screen.getByRole("button", { name: "Restore Archived one", hidden: true })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Deactivate Archived one", hidden: true })).toBeNull();
  });

  it("deactivates a project through a status update", () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate Active one" }));

    expect(state.update).toHaveBeenCalledWith({ id: "Active one", data: { status: "Inactive" } });
  });

  it("hides task rates until the user asks for them", () => {
    render(<ProjectsPage />);
    const row = screen.getByText("Active one").parentElement as HTMLElement;
    fireEvent.click(within(row).getAllByRole("button")[0]);

    expect(screen.getByText("Design")).toBeDefined();
    expect(screen.queryByText("$90/hr")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show values" }));
    expect(screen.getByText("$90/hr")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Hide values" }));
    expect(screen.queryByText("$90/hr")).toBeNull();
  });

  it("does not offer the values button to users who cannot see rates", () => {
    state.role = "Member";
    state.canViewAmounts = false;

    render(<ProjectsPage />);

    expect(screen.queryByRole("button", { name: "Show values" })).toBeNull();
  });

  it("shows the hours left and puts the percent inside the fill", () => {
    state.projects = [project("Budgeted", "Active", { budgetHours: 50 })];
    state.hours = [{ groupId: "Budgeted", totalHours: 20 }];

    render(<ProjectsPage />);

    expect(screen.getByText("20.0 hrs logged")).toBeDefined();
    expect(screen.getByText("30.0 hrs left")).toBeDefined();
    const bar = screen.getByRole("progressbar");
    const fill = bar.firstElementChild as HTMLElement;
    expect(within(fill).getByText("40%")).toBeDefined();
  });

  it("moves the percent out of a fill too short to hold it", () => {
    state.projects = [project("Budgeted", "Active", { budgetHours: 100 })];
    state.hours = [{ groupId: "Budgeted", totalHours: 5 }];

    render(<ProjectsPage />);

    const fill = screen.getByRole("progressbar").firstElementChild as HTMLElement;
    expect(within(fill).queryByText("5%")).toBeNull();
    expect(screen.getByText("5%")).toBeDefined();
  });

  it("shows the real percent and the excess when over budget", () => {
    state.projects = [project("Budgeted", "Active", { budgetHours: 50 })];
    state.hours = [{ groupId: "Budgeted", totalHours: 55 }];

    render(<ProjectsPage />);

    expect(screen.getByText("5.0 hrs over")).toBeDefined();
    expect(screen.getByText("110%")).toBeDefined();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("shows Members only their own hours, without a balance or bar", () => {
    state.role = "Member";
    state.projects = [project("Budgeted", "Active", { budgetHours: 50 })];
    state.hours = [{ groupId: "Budgeted", totalHours: 20 }];

    render(<ProjectsPage />);

    expect(screen.getByText("20.0 hrs logged by you")).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/hrs left/)).toBeNull();
  });

  it("opens the edit form on the copy after duplicating", async () => {
    state.duplicate.mockResolvedValue(project("Active one (copy)", "Inactive"));
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Active one" }));

    expect(state.duplicate).toHaveBeenCalledWith("Active one");
    expect(await screen.findByText("Edit project")).toBeDefined();
    expect(screen.getByDisplayValue("Active one (copy)")).toBeDefined();
  });
});
