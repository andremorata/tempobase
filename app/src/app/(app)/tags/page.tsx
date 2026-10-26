"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
} from "@/lib/api/hooks/tags";
import { formatDate } from "@/lib/format";
import type { Tag, CreateTagRequest } from "@/lib/api/types";
import { useAuth } from "@/contexts/auth-context";
import { hasRole, TRACKER_ROLES } from "@/lib/auth/roles";

export default function TagsPage() {
  const { user } = useAuth();
  const canManage = hasRole(TRACKER_ROLES, user?.role);
  const { data: tags, isLoading } = useTags();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  const [formOpen, setFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");

  const openCreate = () => {
    setEditingTag(null);
    setName("");
    setColor("#6366f1");
    setFormOpen(true);
  };

  const openEdit = (tag: Tag) => {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color ?? "#6366f1");
    setFormOpen(true);
  };

  const handleSubmit = () => {
    const data: CreateTagRequest = {
      name,
      color: color || null,
    };

    if (editingTag) {
      updateTag.mutate(
        { id: editingTag.id, data },
        { onSuccess: () => setFormOpen(false) },
      );
    } else {
      createTag.mutate(data, { onSuccess: () => setFormOpen(false) });
    }
  };

  const columns: ColumnDef<Tag>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: row.original.color ?? "#71717a" }}
          />
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "color",
      header: "Color",
      cell: ({ row }) => (
        <code className="text-xs text-muted-foreground">
          {row.original.color ?? "–"}
        </code>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => canManage && (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => openEdit(row.original)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setDeleteId(row.original.id)}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tags</h1>
        {canManage && (
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Add tag
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={tags ?? []}
        isLoading={isLoading}
        emptyMessage="No tags yet. Create your first tag to categorize time entries."
      />

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTag ? "Edit tag" : "New tag"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Name *</Label>
              <Input
                id="tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tag name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tag-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-16 p-1"
                />
                <code className="text-xs text-muted-foreground">{color}</code>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !name.trim() || createTag.isPending || updateTag.isPending
              }
            >
              {editingTag ? "Save changes" : "Create tag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete tag"
        description="This tag will be permanently deleted."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteTag.isPending}
        onConfirm={() => {
          if (deleteId)
            deleteTag.mutate(deleteId, {
              onSuccess: () => setDeleteId(null),
            });
        }}
      />
    </div>
  );
}
