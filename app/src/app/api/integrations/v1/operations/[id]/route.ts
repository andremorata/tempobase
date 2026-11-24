/**
 * GET /api/integrations/v1/operations/[id] - Status of an operation the token owner prepared,
 * with the entry id once confirmed (for a correction, the entry it targets).
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateIntegration } from "@/lib/auth/integration-tokens";
import {
  confirmPath,
  findOwnOperation,
  KIND_SCOPE,
  OPERATION_NOT_FOUND,
  toOperationView,
  type OperationKind,
} from "@/lib/integrations/operations";
import { integrationErrorResponse } from "../../shared";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await authenticateIntegration(request, ["create", "correct"]);
    const op = await findOwnOperation({ accountId: caller.accountId, id: caller.userId }, (await params).id);
    if (!op) return NextResponse.json(OPERATION_NOT_FOUND, { status: 404 });
    if (!caller.scopes.includes(KIND_SCOPE[op.kind as OperationKind])) {
      return NextResponse.json({ error: "Token lacks the required scope" }, { status: 403 });
    }

    return NextResponse.json({
      ...(await toOperationView(op)),
      confirmUrl: new URL(confirmPath(op.id), request.url).toString(),
    });
  } catch (error) {
    return integrationErrorResponse(error, "get operation");
  }
}
