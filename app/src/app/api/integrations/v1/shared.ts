import { NextResponse } from "next/server";
import { z } from "zod";
import { isProjectAccessible, isTaskAccessible, refsBelongToAccount } from "@/lib/auth/access";
import { authErrorResponse } from "@/lib/auth/helpers";
import type { IntegrationCaller } from "@/lib/auth/integration-tokens";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** 404 unless every referenced project/task is in the caller's account and access scope. */
export async function refsOutOfScope(
  caller: IntegrationCaller,
  refs: { projectId?: string; taskId?: string },
): Promise<NextResponse | null> {
  const inScope =
    isProjectAccessible(caller.access, refs.projectId) &&
    isTaskAccessible(caller.access, refs.taskId) &&
    (await refsBelongToAccount(caller.accountId, { projectIds: [refs.projectId], taskIds: [refs.taskId] }));

  return inScope ? null : NextResponse.json({ error: "Project or task not found" }, { status: 404 });
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
