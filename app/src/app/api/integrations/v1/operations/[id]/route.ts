/**
 * GET /api/integrations/v1/operations/[id] - Status of an operation the token owner prepared,
 * with the entry id once confirmed.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateIntegration } from "@/lib/auth/integration-tokens";
import { prisma } from "@/lib/db/prisma";
import { confirmPath, operationInclude, toOperationView } from "@/lib/integrations/operations";
import { integrationErrorResponse } from "../../shared";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await authenticateIntegration(request, "create");
    const { id } = await params;

    const op = z.string().uuid().safeParse(id).success
      ? await prisma.integrationOperation.findFirst({
          where: { id, accountId: caller.accountId, userId: caller.userId },
          include: operationInclude,
        })
      : null;
    if (!op) return NextResponse.json({ error: "Operation not found" }, { status: 404 });

    return NextResponse.json({
      ...(await toOperationView(op)),
      confirmUrl: new URL(confirmPath(op.id), request.url).toString(),
    });
  } catch (error) {
    return integrationErrorResponse(error, "get operation");
  }
}
