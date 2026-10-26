/**
 * Bulk Time Entry Delete Operation
 *
 * POST /api/time-entries/bulk-delete - Bulk soft delete (matches frontend contract)
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireTracker, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess, MANAGER_ROLES } from "@/lib/auth/access";

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export async function POST(request: NextRequest) {
  try {
    await requireTracker();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

    const body = await request.json();
    const validated = BulkDeleteSchema.parse(body);

    // Build the where clause — restrict to accessible projects if the user is scoped
    const where: Prisma.TimeEntryWhereInput = {
      id: { in: validated.ids },
      accountId,
      isDeleted: false,
      ...(access.projectIds !== null ? { projectId: { in: access.projectIds } } : {}),
      // Only managers act on other users' entries
      ...(MANAGER_ROLES.includes(currentUser.role) ? {} : { userId: currentUser.id }),
    };

    // Soft delete all entries
    await prisma.timeEntry.updateMany({
      where,
      data: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    });

    // Return 204 No Content for successful delete operations
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Bulk delete error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to delete time entries" },
      { status: 500 }
    );
  }
}
