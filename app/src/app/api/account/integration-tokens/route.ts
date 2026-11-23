/**
 * Personal integration tokens of the signed-in user.
 *
 * GET  /api/account/integration-tokens - List active (non-revoked) tokens
 * POST /api/account/integration-tokens - Issue a read token; the plain token is returned once
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAuth, getCurrentUser, authErrorResponse } from "@/lib/auth/helpers";
import { generateIntegrationToken, INTEGRATION_TOKEN_MAX_DAYS } from "@/lib/auth/integration-tokens";
import { createAuditLog } from "@/lib/audit/logger";

const tokenSelect = {
  id: true,
  name: true,
  tokenPrefix: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

export async function GET() {
  try {
    await requireAuth();
    const user = await getCurrentUser();

    const tokens = await prisma.integrationToken.findMany({
      where: { accountId: user.accountId, userId: user.id, revokedAt: null },
      select: tokenSelect,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(tokens);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("List integration tokens error:", error);
    return NextResponse.json({ error: "Failed to fetch integration tokens" }, { status: 500 });
  }
}

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(INTEGRATION_TOKEN_MAX_DAYS).default(30),
});

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const user = await getCurrentUser();
    const validated = CreateTokenSchema.parse(await request.json());

    const { token, tokenHash, tokenPrefix } = generateIntegrationToken();
    const created = await prisma.integrationToken.create({
      data: {
        accountId: user.accountId,
        userId: user.id,
        name: validated.name,
        tokenHash,
        tokenPrefix,
        scopes: ["read"],
        expiresAt: new Date(Date.now() + validated.expiresInDays * 86_400_000),
      },
      select: tokenSelect,
    });

    await createAuditLog({
      accountId: user.accountId,
      actorUserId: user.id,
      actorEmail: user.email ?? "",
      actorName: user.name ?? "",
      actorRole: user.role,
      action: "create",
      entityType: "IntegrationToken",
      entityId: created.id,
      summary: `Issued integration token "${created.name}" (${created.scopes.join(", ")})`,
      changesJson: { name: created.name, scopes: created.scopes, expiresAt: created.expiresAt.toISOString() },
    });

    return NextResponse.json({ ...created, token }, { status: 201 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }

    console.error("Create integration token error:", error);
    return NextResponse.json({ error: "Failed to create integration token" }, { status: 500 });
  }
}
