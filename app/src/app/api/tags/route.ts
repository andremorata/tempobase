/**
 * Tags API Routes
 *
 * GET /api/tags - List tags
 * POST /api/tags - Create tag
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireTracker, requireAuth, getCurrentTenantId, authErrorResponse } from "@/lib/auth/helpers";

// ─── List Tags ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();

    const tags = await prisma.tag.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json(
      tags.map((t) => ({
        id: t.id,
        accountId: t.accountId,
        name: t.name,
        color: t.color,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }))
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List tags error:", error);
    return NextResponse.json(
      { error: "Failed to fetch tags" },
      { status: 500 }
    );
  }
}

// ─── Create Tag ───────────────────────────────────────────────────────────

const CreateTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(20).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireTracker();
    const accountId = await getCurrentTenantId();

    const body = await request.json();
    const validated = CreateTagSchema.parse(body);

    const tag = await prisma.tag.create({
      data: {
        accountId,
        name: validated.name,
        color: validated.color ?? null,
      },
    });

    return NextResponse.json(
      {
        id: tag.id,
        accountId: tag.accountId,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Create tag error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create tag" },
      { status: 500 }
    );
  }
}
