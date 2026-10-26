/**
 * Invite Registration Endpoint
 *
 * Creates user from invite token.
 * POST /api/auth/register-invite
 */

import { NextRequest, NextResponse } from "next/server";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const InviteRegisterSchema = z.object({
  inviteToken: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = InviteRegisterSchema.parse(body);

    const emailLower = validated.email.toLowerCase();

    // Find invite
    const invite = await prisma.accountInvite.findFirst({
      where: {
        token: validated.inviteToken,
        isDeleted: false,
      },
      include: {
        account: true,
      },
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invalid or expired invite token" },
        { status: 404 }
      );
    }

    // Check if invite is expired
    if (invite.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "Invite token has expired" },
        { status: 410 }
      );
    }

    // Check if invite already used
    if (invite.usedAt) {
      return NextResponse.json(
        { error: "Invite token has already been used" },
        { status: 410 }
      );
    }

    // Emails are unique across workspaces, same as /api/auth/register. A duplicate in
    // another workspace would make sign-in ambiguous for the original owner of the email.
    const existingUser = await prisma.user.findFirst({
      where: {
        email: emailLower,
        isDeleted: false,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(validated.password, 10);

    // Create user and mark invite as used in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Claim the invite atomically so two concurrent requests cannot both use it
      const claimed = await tx.accountInvite.updateMany({
        where: { id: invite.id, usedAt: null, isDeleted: false },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        return null;
      }

      const user = await tx.user.create({
        data: {
          accountId: invite.accountId,
          email: emailLower,
          firstName: validated.firstName.trim(),
          lastName: validated.lastName.trim(),
          passwordHash,
          role: "Member", // Default role for invited users
          isActive: true,
        },
      });

      return { user };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Invite token has already been used" },
        { status: 410 }
      );
    }

    return NextResponse.json(
      {
        message: "Registration successful",
        userId: result.user.id,
        accountId: invite.accountId,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    // A concurrent registration with the same email hit the unique index
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    console.error("Invite registration error:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}
