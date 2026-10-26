/**
 * Delete Workspace Endpoint
 *
 * POST /api/account/purge/workspace - Hard delete entire workspace (Owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { getCurrentTenantId, getCurrentUserId, requireOwner, authErrorResponse } from "@/lib/auth/helpers";

const DeleteWorkspaceSchema = z.object({
  confirmationText: z.string().min(1),
  currentPassword: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    await requireOwner();
    const accountId = await getCurrentTenantId();
    const userId = await getCurrentUserId();

    const body = await request.json();
    const validated = DeleteWorkspaceSchema.parse(body);

    // Verify confirmation text
    if (validated.confirmationText !== "DELETE WORKSPACE") {
      return NextResponse.json(
        { error: "Confirmation text must be exactly 'DELETE WORKSPACE'" },
        { status: 400 }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(
      validated.currentPassword,
      user.passwordHash
    );

    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Password is incorrect" },
        { status: 400 }
      );
    }

    // Soft delete the entire workspace (all entities belong to this account)
    await prisma.$transaction(async (tx) => {
      // Delete time entry tags
      await tx.timeEntryTag.deleteMany({
        where: {
          timeEntry: {
            accountId,
          },
        },
      });

      // Soft delete time entries
      await tx.timeEntry.updateMany({
        where: { accountId },
        data: { isDeleted: true, updatedAt: new Date() },
      });

      // Soft delete tasks
      await tx.projectTask.updateMany({
        where: {
          project: {
            accountId,
          },
        },
        data: { isDeleted: true, updatedAt: new Date() },
      });

      // Soft delete projects
      await tx.project.updateMany({
        where: { accountId },
        data: { isDeleted: true, updatedAt: new Date() },
      });

      // Soft delete clients
      await tx.client.updateMany({
        where: { accountId },
        data: { isDeleted: true, updatedAt: new Date() },
      });

      // Soft delete tags
      await tx.tag.updateMany({
        where: { accountId },
        data: { isDeleted: true, updatedAt: new Date() },
      });

      // Soft delete invites
      await tx.accountInvite.updateMany({
        where: { accountId },
        data: { isDeleted: true, updatedAt: new Date() },
      });

      // Soft delete users
      await tx.user.updateMany({
        where: { accountId },
        data: { isDeleted: true, isActive: false, updatedAt: new Date() },
      });

      // Soft delete account
      await tx.account.update({
        where: { id: accountId },
        data: { isDeleted: true, updatedAt: new Date() },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Delete workspace error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to delete workspace" },
      { status: 500 }
    );
  }
}
