/**
 * Execute Import Endpoint
 *
 * POST /api/imports/time-entries/execute - Create time entries from parsed rows
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireOwnerOrAdmin, getCurrentTenantId, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";

const ImportRowSchema = z.object({
  rowIndex: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
  description: z.string().nullable().optional(),
  isBillable: z.boolean(),
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  include: z.boolean(),
});

const ExecuteImportSchema = z.object({
  importSessionId: z.string().uuid(),
  rows: z.array(ImportRowSchema).min(1).max(5000),
});

type StoredImportPreviewRow = {
  rowIndex: number;
  startTime: string;
  endTime: string;
};

export async function POST(request: NextRequest) {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const userId = await getCurrentUserId();

    const body = await request.json();
    const validated = ExecuteImportSchema.parse(body);

    const session = await prisma.importSession.findFirst({
      where: {
        id: validated.importSessionId,
        accountId,
        userId,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Import session not found. Parse the CSV file again before importing." },
        { status: 404 }
      );
    }

    if (session.status === "completed") {
      return NextResponse.json({
        importedCount: session.importedCount,
        skippedCount: session.skippedCount,
        errors: [],
        skippedRows: [],
        alreadyImported: true,
      });
    }

    if (session.status !== "pending") {
      return NextResponse.json(
        { error: "Import session is no longer pending. Parse the CSV file again before importing." },
        { status: 409 }
      );
    }

    let previewRows: StoredImportPreviewRow[];
    try {
      previewRows = JSON.parse(session.previewRowsJson) as StoredImportPreviewRow[];
    } catch {
      await prisma.importSession.update({
        where: { id: session.id },
        data: { status: "failed", failedAt: new Date(), updatedAt: new Date() },
      });

      return NextResponse.json(
        { error: "Import session preview could not be restored. Parse the CSV file again before importing." },
        { status: 409 }
      );
    }

    const previewByRowIndex = new Map(previewRows.map((row) => [row.rowIndex, row]));

    let imported = 0;
    let skipped = 0;
    const errors: { rowIndex: number; message: string }[] = [];
    const skippedRows: { rowIndex: number; message: string }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const row of validated.rows) {
        const previewRow = previewByRowIndex.get(row.rowIndex);

        if (!previewRow) {
          errors.push({ rowIndex: row.rowIndex, message: "Row does not belong to the current import session." });
          continue;
        }

        if (!row.include) {
          skipped++;
          continue;
        }

        const startTime = new Date(row.startTime);
        const endTime = new Date(row.endTime);

        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
          errors.push({ rowIndex: row.rowIndex, message: "Start or end time is invalid." });
          continue;
        }

        // Validate time range
        if (endTime <= startTime) {
          errors.push({ rowIndex: row.rowIndex, message: "End time must be after start time." });
          continue;
        }

        const durationMs = endTime.getTime() - startTime.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);

        if (durationHours > 24) {
          errors.push({ rowIndex: row.rowIndex, message: "Entry duration exceeds 24 hours." });
          continue;
        }

        const durationDecimal = Math.round(durationHours * 10000) / 10000;

        // Extract entry date (date part of startTime in UTC)
        const entryDate = new Date(
          Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate())
        );

        const description = row.description?.trim() || null;
        const projectId = row.projectId || null;
        const taskId = row.taskId || null;

        const existingEntry = await tx.timeEntry.findFirst({
          where: {
            accountId,
            userId,
            projectId,
            taskId,
            description,
            startTime,
            endTime,
            isBillable: row.isBillable,
            isDeleted: false,
          },
          select: { id: true },
        });

        if (existingEntry) {
          skipped++;
          skippedRows.push({
            rowIndex: row.rowIndex,
            message: "Entry already exists for this import row.",
          });
          continue;
        }

        // Create time entry
        await tx.timeEntry.create({
          data: {
            accountId,
            userId,
            projectId,
            taskId,
            description,
            entryDate,
            startTime,
            endTime,
            duration: durationMs,
            durationDecimal,
            isBillable: row.isBillable,
            isRunning: false,
            isDeleted: false,
            importSessionId: session.id,
          },
        });

        imported++;
      }

      if (errors.length === 0) {
        await tx.importSession.update({
          where: { id: session.id },
          data: {
            status: "completed",
            importedCount: imported,
            skippedCount: skipped,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } else {
        await tx.importSession.update({
          where: { id: session.id },
          data: {
            importedCount: imported,
            skippedCount: skipped,
            updatedAt: new Date(),
          },
        });
      }
    });

    return NextResponse.json({
      importedCount: imported,
      skippedCount: skipped,
      errors,
      skippedRows,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Execute import error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to execute import" },
      { status: 500 }
    );
  }
}
