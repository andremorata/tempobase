/**
 * Bulk Tag Assignment
 *
 * PUT /api/time-entries/bulk-tag
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireTracker, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { getMemberAccess, MANAGER_ROLES } from "@/lib/auth/access";

const BulkTagSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1),
  tagIds: z.array(z.string().uuid()).min(1),
});

export async function PUT(request: NextRequest) {
  try {
    await requireTracker();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const access = await getMemberAccess(currentUser.id, accountId, currentUser.role);

    const body = await request.json();
    const validated = BulkTagSchema.parse(body);

    // Verify all entries belong to this account, scoped to accessible projects
    const entryWhere: Prisma.TimeEntryWhereInput = {
      id: { in: validated.entryIds },
      accountId,
      isDeleted: false,
      ...(access.projectIds !== null ? { projectId: { in: access.projectIds } } : {}),
      // Only managers act on other users' entries
      ...(MANAGER_ROLES.includes(currentUser.role) ? {} : { userId: currentUser.id }),
    };

    const entries = await prisma.timeEntry.findMany({
      where: entryWhere,
      select: { id: true },
    });

    if (entries.length !== validated.entryIds.length) {
      return NextResponse.json(
        { error: "One or more time entries not found" },
        { status: 404 }
      );
    }

    // Verify all tags belong to this account
    const tags = await prisma.tag.findMany({
      where: {
        id: { in: validated.tagIds },
        accountId,
        isDeleted: false,
      },
      select: { id: true },
    });

    if (tags.length !== validated.tagIds.length) {
      return NextResponse.json(
        { error: "One or more tags not found" },
        { status: 404 }
      );
    }

    // Create tag associations in transaction
    await prisma.$transaction(async (tx) => {
      // Remove existing tags for these entries
      await tx.timeEntryTag.deleteMany({
        where: {
          timeEntryId: { in: validated.entryIds },
        },
      });

      // Create new associations
      const associations = validated.entryIds.flatMap((entryId) =>
        validated.tagIds.map((tagId) => ({
          timeEntryId: entryId,
          tagId,
        }))
      );

      await tx.timeEntryTag.createMany({
        data: associations,
        skipDuplicates: true,
      });

      // Update timestamps
      await tx.timeEntry.updateMany({
        where: {
          id: { in: validated.entryIds },
        },
        data: {
          updatedAt: new Date(),
        },
      });
    });

    return NextResponse.json({
      success: true,
      updatedCount: validated.entryIds.length,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Bulk tag error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to tag time entries" },
      { status: 500 }
    );
  }
}
