/**
 * Delete Current User Endpoint
 *
 * POST /api/account/purge/me - Self-delete account (soft delete current user)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";

const DeleteCurrentUserSchema = z.object({
  confirmationText: z.string().min(1),
  currentPassword: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const userId = await getCurrentUserId();

    const body = await request.json();
    const validated = DeleteCurrentUserSchema.parse(body);

    // Verify confirmation text
    if (validated.confirmationText !== "DELETE MY ACCOUNT") {
      return NextResponse.json(
        { error: "Confirmation text must be exactly 'DELETE MY ACCOUNT'" },
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

    // Soft delete user
    await prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: true,
        isActive: false,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Delete current user error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}
