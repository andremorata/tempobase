import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProjectSelector } from "../project-selector";

vi.mock("@/lib/api/hooks/projects", () => ({
  useProjects: vi.fn(),
}));

vi.mock("@/lib/api/hooks/tasks", () => ({
  useProjectTasks: () => ({ data: [] }),
}));

import { useProjects } from "@/lib/api/hooks/projects";

const mockProjects = [
  { id: "proj-1", name: "TempoBase", status: "Active", color: "#10b981", accountId: "acc-1", billingType: "Hourly", createdAt: "" },
  { id: "proj-2", name: "Client Work", status: "Active", color: "#475569", accountId: "acc-1", billingType: "Fixed", createdAt: "" },
  { id: "proj-3", name: "Archived Proj", status: "Archived", color: "#aaa", accountId: "acc-1", billingType: "Hourly", createdAt: "" },
];

describe("ProjectSelector", () => {
  it("renders project names (not GUIDs) when project is selected", () => {
    vi.mocked(useProjects).mockReturnValue({
      data: mockProjects,
    } as unknown as ReturnType<typeof useProjects>);

    render(
      <ProjectSelector
        projectId="proj-1"
        taskId={null}
        onProjectChange={vi.fn()}
        onTaskChange={vi.fn()}
      />,
    );

    // The trigger should show "TempoBase", not "proj-1"
    expect(screen.getByText("TempoBase")).toBeDefined();
    expect(screen.queryByText("proj-1")).toBeNull();
  });

  it("shows placeholder when no project is selected", () => {
    vi.mocked(useProjects).mockReturnValue({
      data: mockProjects,
    } as unknown as ReturnType<typeof useProjects>);

    render(
      <ProjectSelector
        projectId={null}
        taskId={null}
        onProjectChange={vi.fn()}
        onTaskChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No project")).toBeDefined();
  });

  it("shows the name of a selected project that is no longer active", () => {
    vi.mocked(useProjects).mockReturnValue({
      data: mockProjects,
    } as unknown as ReturnType<typeof useProjects>);

    render(
      <ProjectSelector
        projectId="proj-3"
        taskId={null}
        onProjectChange={vi.fn()}
        onTaskChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Archived Proj")).toBeDefined();
    expect(screen.queryByText("proj-3")).toBeNull();
  });

  it("only shows Active projects, not archived ones", () => {
    vi.mocked(useProjects).mockReturnValue({
      data: mockProjects,
    } as unknown as ReturnType<typeof useProjects>);

    render(
      <ProjectSelector
        projectId={null}
        taskId={null}
        onProjectChange={vi.fn()}
        onTaskChange={vi.fn()}
      />,
    );

    // "Archived Proj" should not be available as an option
    expect(screen.queryByText("Archived Proj")).toBeNull();
  });

  it("falls back to showing GUID only when project is not in the list", () => {
    // This documents what currently happens when the project is no longer available
    vi.mocked(useProjects).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useProjects>);

    render(
      <ProjectSelector
        projectId="proj-unknown"
        taskId={null}
        onProjectChange={vi.fn()}
        onTaskChange={vi.fn()}
      />,
    );

    // Falls back to showing the raw ID when not found
    expect(screen.getByText("proj-unknown")).toBeDefined();
  });
});
