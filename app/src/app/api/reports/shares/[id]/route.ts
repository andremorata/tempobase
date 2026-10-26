/**
 * Shared Report (Single) Endpoint
 *
 * DELETE /api/reports/shares/[id] - Delete a shared report
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentTenantId, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { MANAGER_ROLES } from "@/lib/auth/access";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const currentUser = await getCurrentUser();
    const { id } = await params;

    // Check if report exists
    const existingReport = await prisma.sharedReport.findUnique({
      where: { id },
      select: { accountId: true, createdByUserId: true },
    });

    if (
      !existingReport ||
      existingReport.accountId !== accountId ||
      (existingReport.createdByUserId !== currentUser.id && !MANAGER_ROLES.includes(currentUser.role))
    ) {
      return NextResponse.json(
        { error: "Shared report not found" },
        { status: 404 }
      );
    }

    // Hard delete for public shares
    await prisma.sharedReport.delete({
      where: { id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Delete shared report error:", error);
    return NextResponse.json(
      { error: "Failed to delete shared report" },
      { status: 500 }
    );
  }
}
