import { NextResponse } from "next/server";
import { z } from "zod";
import { isProjectAccessible, isTaskAccessible, refsBelongToAccount } from "@/lib/auth/access";
import { authErrorResponse } from "@/lib/auth/helpers";
import { prisma } from "@/lib/db/prisma";
import type { IntegrationCaller } from "@/lib/auth/integration-tokens";

export const isoDate = z.iso.date();

/**
 * 404 unless the project and task are in the caller's account and access scope. A task is
 * in scope only when its project is too, and it must belong to `projectId` when both are given.
 */
export async function refsOutOfScope(
  caller: IntegrationCaller,
  refs: { projectId?: string; taskId?: string },
): Promise<NextResponse | null> {
  const notFound = NextResponse.json({ error: "Project or task not found" }, { status: 404 });
  const { access, accountId } = caller;

  if (refs.projectId) {
    const inScope =
      isProjectAccessible(access, refs.projectId) &&
      (await refsBelongToAccount(accountId, { projectIds: [refs.projectId] }));
    if (!inScope) return notFound;
  }

  if (refs.taskId) {
    const task = await prisma.projectTask.findFirst({
      where: { id: refs.taskId, accountId, isDeleted: false },
      select: { projectId: true },
    });
    const inScope =
      task !== null &&
      isTaskAccessible(access, refs.taskId) &&
      isProjectAccessible(access, task.projectId) &&
      (!refs.projectId || task.projectId === refs.projectId);
    if (!inScope) return notFound;
  }

  return null;
}

export function integrationErrorResponse(error: unknown, label: string) {
  const authResponse = authErrorResponse(error);
  if (authResponse) return authResponse;

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Invalid query parameters", details: error.issues }, { status: 400 });
  }

  console.error(`${label} error:`, error);
  return NextResponse.json({ error: `Failed to ${label}` }, { status: 500 });
}
