"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useProjectTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
} from "@/lib/api/hooks/tasks";
import type { ProjectTask } from "@/lib/api/types";
import { useAuth } from "@/contexts/auth-context";
import { hasRole, MANAGER_ROLES } from "@/lib/auth/roles";

interface TaskListProps {
  projectId: string;
}

export function TaskList({ projectId }: TaskListProps) {
  const { user } = useAuth();
  const canManage = hasRole(MANAGER_ROLES, user?.role);
  const { data: tasks } = useProjectTasks(projectId);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRate, setEditRate] = useState("");

  const handleAdd = () => {
    if (!newName.trim()) return;
    createTask.mutate(
      {
        projectId,
        name: newName.trim(),
        hourlyRate: newRate ? parseFloat(newRate) : null,
      },
      {
        onSuccess: () => {
          setNewName("");
          setNewRate("");
          setIsAdding(false);
        },
      },
    );
  };

  const startEdit = (task: ProjectTask) => {
    setEditingId(task.id);
    setEditName(task.name);
    setEditRate(task.hourlyRate?.toString() ?? "");
  };

  const handleEdit = () => {
    if (!editingId || !editName.trim()) return;
    updateTask.mutate(
      {
        id: editingId,
        projectId,
        data: {
          name: editName.trim(),
          hourlyRate: editRate ? parseFloat(editRate) : null,
        },
      },
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">Tasks</h4>
        <Button
          variant="ghost"
          size="xs"
          className={canManage ? undefined : "hidden"}
          onClick={() => setIsAdding(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isAdding && (
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Task name"
            className="h-7 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") setIsAdding(false);
            }}
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            value={newRate}
            onChange={(e) => setNewRate(e.target.value)}
            placeholder="$/hr"
            className="h-7 w-20 text-sm"
          />
          <Button
            variant="ghost"
            size="xs"
            onClick={handleAdd}
            disabled={createTask.isPending}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => { setIsAdding(false); setNewRate(""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {tasks?.map((task) => (
        <div
          key={task.id}
          className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
        >
          {editingId === task.id ? (
            <div className="flex flex-1 items-center gap-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-7 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editRate}
                onChange={(e) => setEditRate(e.target.value)}
                placeholder="$/hr"
                className="h-7 w-20 text-sm"
              />
              <Button variant="ghost" size="xs" onClick={handleEdit}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditingId(null)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span className={task.isActive ? "" : "text-muted-foreground line-through"}>
                  {task.name}
                </span>
                {task.hourlyRate != null && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    ${task.hourlyRate}/hr
                  </span>
                )}
              </div>
              <div className={canManage ? "flex gap-1" : "hidden"}>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => startEdit(task)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => deleteTask.mutate({ id: task.id, projectId })}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </>
          )}
        </div>
      ))}

      {tasks?.length === 0 && !isAdding && (
        <p className="text-xs text-muted-foreground">No tasks yet.</p>
      )}
    </div>
  );
}
