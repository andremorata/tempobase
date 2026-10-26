/**
 * Clients API Routes
 *
 * GET /api/clients - List clients
 * POST /api/clients - Create client
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireManager, requireAuth, getCurrentTenantId, authErrorResponse } from "@/lib/auth/helpers";

// ─── List Clients ─────────────────────────────────────────────────────────

export async function GET() {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();

    const clients = await prisma.client.findMany({
      where: {
        accountId,
        isDeleted: false,
      },
      include: {
        projects: {
          where: {
            isDeleted: false,
          },
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json(
      clients.map((c) => ({
        id: c.id,
        accountId: c.accountId,
        name: c.name,
        email: c.email,
        phone: c.phone,
        notes: c.notes,
        isArchived: c.isArchived,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        projects: c.projects,
      }))
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List clients error:", error);
    return NextResponse.json(
      { error: "Failed to fetch clients" },
      { status: 500 }
    );
  }
}

// ─── Create Client ────────────────────────────────────────────────────────

const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();

    const body = await request.json();
    const validated = CreateClientSchema.parse(body);

    const client = await prisma.client.create({
      data: {
        accountId,
        name: validated.name,
        email: validated.email ?? null,
        phone: validated.phone ?? null,
        notes: validated.notes ?? null,
        isArchived: false,
      },
    });

    return NextResponse.json(
      {
        id: client.id,
        accountId: client.accountId,
        name: client.name,
        email: client.email,
        phone: client.phone,
        notes: client.notes,
        isArchived: client.isArchived,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Create client error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create client" },
      { status: 500 }
    );
  }
}
