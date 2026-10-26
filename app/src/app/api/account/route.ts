/**
 * Account Management Endpoints
 *
 * GET /api/account - Get current account settings
 * PUT /api/account - Update account settings (Owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentTenantId, requireOwner, authErrorResponse } from "@/lib/auth/helpers";

// ─── Get Account ──────────────────────────────────────────────────────────

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        currency: true,
        auditRetentionDays: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(account);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Get account error:", error);
    return NextResponse.json(
      { error: "Failed to fetch account" },
      { status: 500 }
    );
  }
}

// ─── Update Account ───────────────────────────────────────────────────────

const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(100),
  currency: z.string().min(3).max(10),
  auditRetentionDays: z.number().int().min(30).max(3650),
});

export async function PUT(request: NextRequest) {
  try {
    await requireOwner();
    const accountId = await getCurrentTenantId();

    const body = await request.json();
    const validated = UpdateAccountSchema.parse(body);

    // Generate slug from name (lowercase, replace spaces with hyphens)
    const slug = validated.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const account = await prisma.account.update({
      where: { id: accountId },
      data: {
        name: validated.name,
        slug,
        timezone: validated.timezone,
        currency: validated.currency,
        auditRetentionDays: validated.auditRetentionDays,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        currency: true,
        auditRetentionDays: true,
      },
    });

    return NextResponse.json(account);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Update account error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 500 }
    );
  }
}
