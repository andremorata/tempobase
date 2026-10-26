/**
 * Client Operations (Single)
 *
 * GET /api/clients/[id] - Get single client
 * PUT /api/clients/[id] - Update client
 * DELETE /api/clients/[id] - Soft delete client
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireManager, requireAuth, getCurrentTenantId, authErrorResponse } from "@/lib/auth/helpers";

const UpdateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isArchived: z.boolean().optional(),
});

// GET /api/clients/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const accountId = await getCurrentTenantId();
    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: {
        id,
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
    });

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: client.id,
      accountId: client.accountId,
      name: client.name,
      email: client.email,
      phone: client.phone,
      notes: client.notes,
      isArchived: client.isArchived,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      projects: client.projects,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Get client error:", error);
    return NextResponse.json(
      { error: "Failed to fetch client" },
      { status: 500 }
    );
  }
}

// PUT /api/clients/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();
    const { id } = await params;

    const body = await request.json();
    const validated = UpdateClientSchema.parse(body);

    // Check if client exists
    const existingClient = await prisma.client.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
    });

    if (!existingClient) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    const updateData: Prisma.ClientUpdateInput = {
      updatedAt: new Date(),
    };

    if (validated.name !== undefined) {
      updateData.name = validated.name;
    }
    if (validated.email !== undefined) {
      updateData.email = validated.email;
    }
    if (validated.phone !== undefined) {
      updateData.phone = validated.phone;
    }
    if (validated.notes !== undefined) {
      updateData.notes = validated.notes;
    }
    if (validated.isArchived !== undefined) {
      updateData.isArchived = validated.isArchived;
    }

    const client = await prisma.client.update({
      where: { id },
      data: updateData,
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
    });

    return NextResponse.json({
      id: client.id,
      accountId: client.accountId,
      name: client.name,
      email: client.email,
      phone: client.phone,
      notes: client.notes,
      isArchived: client.isArchived,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      projects: client.projects,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Update client error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update client" },
      { status: 500 }
    );
  }
}

// DELETE /api/clients/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const accountId = await getCurrentTenantId();
    const { id } = await params;

    // Check if client exists
    const client = await prisma.client.findFirst({
      where: {
        id,
        accountId,
        isDeleted: false,
      },
    });

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // Soft delete
    await prisma.client.update({
      where: { id },
      data: {
        isDeleted: true,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Delete client error:", error);
    return NextResponse.json(
      { error: "Failed to delete client" },
      { status: 500 }
    );
  }
}
