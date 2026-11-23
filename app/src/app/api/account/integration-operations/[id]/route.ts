/**
 * GET /api/account/integration-operations/[id] - Preview of the signed-in user's own operation.
 */

import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, getCurrentUser } from "@/lib/auth/helpers";
import { findOwnOperation, OPERATION_NOT_FOUND, toOperationView } from "@/lib/integrations/operations";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const op = await findOwnOperation(user, (await params).id);
    if (!op) return NextResponse.json(OPERATION_NOT_FOUND, { status: 404 });
    return NextResponse.json(await toOperationView(op));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Get integration operation error:", error);
    return NextResponse.json({ error: "Failed to fetch operation" }, { status: 500 });
  }
}
