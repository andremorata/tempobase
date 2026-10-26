/**
 * Team Invites Endpoints
 *
 * GET /api/team/invites - List all invites
 * POST /api/team/invites - Create new invite
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { getCurrentTenantId, requireOwnerOrAdmin, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";

// ─── List Invites ─────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Invite tokens let anyone join the workspace, so only inviters may read them
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();

    const invites = await prisma.accountInvite.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Build join URLs
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const invitesWithUrls = invites.map((invite) => ({
      ...invite,
      joinUrl: `${baseUrl}/register?invite=${encodeURIComponent(invite.token)}`,
    }));

    return NextResponse.json(invitesWithUrls);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List invites error:", error);
    return NextResponse.json(
      { error: "Failed to fetch invites" },
      { status: 500 }
    );
  }
}

// ─── Create Invite ────────────────────────────────────────────────────────

const CreateInviteSchema = z.object({
  expiresAt: z.string().datetime().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const userId = await getCurrentUserId();

    const body = await request.json();
    const validated = CreateInviteSchema.parse(body);

    // Generate secure random token
    const token = randomBytes(32).toString("base64url");

    // Default expiration: 7 days from now
    const expiresAt = validated.expiresAt
      ? new Date(validated.expiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Validate expiration is in the future
    if (expiresAt <= new Date()) {
      return NextResponse.json(
        { error: "Expiration date must be in the future" },
        { status: 400 }
      );
    }

    const invite = await prisma.accountInvite.create({
      data: {
        accountId,
        createdByUserId: userId,
        token,
        expiresAt,
      },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const inviteWithUrl = {
      ...invite,
      joinUrl: `${baseUrl}/register?invite=${encodeURIComponent(invite.token)}`,
    };

    return NextResponse.json(inviteWithUrl, { status: 201 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Create invite error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create invite" },
      { status: 500 }
    );
  }
}
