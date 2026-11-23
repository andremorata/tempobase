/**
 * POST /api/account/integration-operations/[id]/cancel - Discard a pending operation.
 */

import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, getCurrentUser } from "@/lib/auth/helpers";
import { createAuditLog } from "@/lib/audit/logger";
import { prisma } from "@/lib/db/prisma";
import { findOwnOperation, OPERATION_NOT_FOUND, operationStatus, toOperationView } from "@/lib/integrations/operations";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const op = await findOwnOperation(user, (await params).id);
    if (!op) return NextResponse.json(OPERATION_NOT_FOUND, { status: 404 });

    const now = new Date();
    const claimed = await prisma.integrationOperation.updateMany({
      where: { id: op.id, status: "pending", expiresAt: { gt: now } },
      data: { status: "cancelled", cancelledAt: now, updatedAt: now },
    });

    const current = (await findOwnOperation(user, op.id))!;
    const status = operationStatus(current, now);
    if (claimed.count === 0 && status !== "cancelled") {
      return NextResponse.json({ error: `This operation is ${status}` }, { status: 409 });
    }

    if (claimed.count > 0) {
      await createAuditLog({
        accountId: user.accountId,
        actorUserId: user.id,
        actorEmail: user.email ?? "",
        actorName: user.name ?? "",
        actorRole: user.role,
        action: "cancel",
        entityType: "IntegrationOperation",
        entityId: op.id,
        summary: `Cancelled time entry prepared by integration "${op.token.name}"`,
        changesJson: { kind: op.kind, integrationTokenId: op.token.id, integrationTokenName: op.token.name, payload: op.payload },
      });
    }

    return NextResponse.json(await toOperationView(current, now));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Cancel integration operation error:", error);
    return NextResponse.json({ error: "Failed to cancel operation" }, { status: 500 });
  }
}
