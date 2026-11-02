"use client";

import { useProjects } from "@/lib/api/hooks/projects";
import { useProjectTasks } from "@/lib/api/hooks/tasks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProjectSelectorProps {
  projectId: string | null;
  taskId: string | null;
  onProjectChange: (projectId: string | null) => void;
  onTaskChange: (taskId: string | null) => void;
}

export function ProjectSelector({
  projectId,
  taskId,
  onProjectChange,
  onTaskChange,
}: ProjectSelectorProps) {
  const { data: projects } = useProjects();
  const { data: tasks } = useProjectTasks(projectId ?? "");

  const activeProjects = projects?.filter((p) => p.status === "Active") ?? [];

  return (
    <div className="flex items-center gap-2">
      <Select
        value={projectId ?? ""}
        onValueChange={(v) => {
          onProjectChange(v || null);
          onTaskChange(null);
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="No project">
            {projectId
              ? (projects?.find((p) => p.id === projectId)?.name ?? projectId)
              : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">No project</SelectItem>
          {activeProjects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {projectId && tasks && tasks.length > 0 && (
        <Select
          value={taskId ?? ""}
          onValueChange={(v) => onTaskChange(v || null)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="No task">
              {taskId
                ? (tasks?.find((t) => t.id === taskId)?.name ?? taskId)
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No task</SelectItem>
            {tasks
              .filter((t) => t.isActive)
              .map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
