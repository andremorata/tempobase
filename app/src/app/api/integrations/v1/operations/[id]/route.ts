/**
 * GET /api/integrations/v1/operations/[id] - Status of an operation the token owner prepared,
 * with the entry id once confirmed.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateIntegration } from "@/lib/auth/integration-tokens";
import { confirmPath, findOwnOperation, OPERATION_NOT_FOUND, toOperationView } from "@/lib/integrations/operations";
import { integrationErrorResponse } from "../../shared";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await authenticateIntegration(request, "create");
    const op = await findOwnOperation({ accountId: caller.accountId, id: caller.userId }, (await params).id);
    if (!op) return NextResponse.json(OPERATION_NOT_FOUND, { status: 404 });

    return NextResponse.json({
      ...(await toOperationView(op)),
      confirmUrl: new URL(confirmPath(op.id), request.url).toString(),
    });
  } catch (error) {
    return integrationErrorResponse(error, "get operation");
  }
}
