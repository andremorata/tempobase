/**
 * Parse Time Entries CSV Endpoint
 *
 * POST /api/imports/time-entries/parse - Parse CSV and return preview rows
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireOwnerOrAdmin, getCurrentTenantId, getCurrentUserId, authErrorResponse } from "@/lib/auth/helpers";

const DateFormatSchema = z.enum(["ymd", "dmy", "mdy"]).default("ymd");

type ParsedImportRow = {
  rowIndex: number;
  rawClientName: string | null;
  rawProjectName: string | null;
  rawTaskName: string | null;
  description: string | null;
  isBillable: boolean;
  startTime: string;
  endTime: string;
  durationDecimal: number;
  suggestedProjectId: string | null;
  suggestedTaskId: string | null;
  errors: string[];
};

export async function POST(request: NextRequest) {
  try {
    await requireOwnerOrAdmin();
    const accountId = await getCurrentTenantId();
    const userId = await getCurrentUserId();

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const dateFormatRaw = formData.get("dateFormat") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No CSV file attached. Send a multipart/form-data request with the file in field 'file'." },
        { status: 400 }
      );
    }

    const dateFormat = DateFormatSchema.parse(dateFormatRaw || "ymd");

    // Read file content
    const fileContent = await file.text();
    const fileHash = createHash("sha256").update(fileContent, "utf8").digest("hex");
    const lines = fileContent.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return NextResponse.json({
        importSessionId: null,
        rows: [],
        totalRows: 0,
        parseErrors: ["CSV file appears to be empty or has no header row."],
      });
    }

    // Parse header
    const headerLine = lines[0];
    const headers = parseCsvLine(headerLine);
    const colMap = buildColumnMap(headers);

    const knownColumns = [
      "client",
      "project",
      "task",
      "description",
      "billable",
      "startdate",
      "starttime",
      "enddate",
      "endtime",
     ];
    const unmappedColumns = headers.filter(
       (h) => !knownColumns.includes(normaliseHeader(h))
      );

    const requiredCols = ["startdate", "starttime", "enddate", "endtime"];
    const missingCols = requiredCols.filter((col) => !colMap.has(col));

    if (missingCols.length > 0) {
      return NextResponse.json({
        importSessionId: null,
        rows: [],
        totalRows: 0,
        parseErrors: [
           "Missing required columns: 'Start Date', 'Start Time', 'End Date', 'End Time'. " +
             "Ensure your time-entry CSV includes these columns before importing.",
          ],
        });
      }

    const previousCompletedImport = await prisma.importSession.findFirst({
      where: {
        accountId,
        userId,
        fileHash,
        dateFormat,
        status: "completed",
      },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        completedAt: true,
      },
    });

    // Load projects and tasks for fuzzy matching
    const projects = await prisma.project.findMany({
      where: {
        accountId,
        status: "Active",
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        clientId: true,
      },
    });

    const tasks = await prisma.projectTask.findMany({
      where: {
        accountId,
        isActive: true,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        projectId: true,
      },
    });

    const projectByName = new Map<string, { id: string; name: string; clientId: string | null }>();
    for (const proj of projects) {
      const key = proj.name.trim().toLowerCase();
      projectByName.set(key, proj);
    }

    const rows: ParsedImportRow[] = [];
    const parseErrors: string[] = [];

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) continue;

      const fields = parseCsvLine(line);
      const rowErrors: string[] = [];
      const rowIndex = i - 1;

      const rawClient = getField(fields, colMap, "client");
      const rawProject = getField(fields, colMap, "project");
      const rawTask = getField(fields, colMap, "task");
      const description = getField(fields, colMap, "description");
      const billableStr = getField(fields, colMap, "billable");
      const startDateStr = getField(fields, colMap, "startdate");
      const startTimeStr = getField(fields, colMap, "starttime");
      const endDateStr = getField(fields, colMap, "enddate");
      const endTimeStr = getField(fields, colMap, "endtime");

      const isBillable = isTruthy(billableStr);

      // Parse start/end times
      const startTimeResult = tryParseDateTime(startDateStr, startTimeStr, dateFormat);
      const endTimeResult = tryParseDateTime(endDateStr, endTimeStr, dateFormat);

      let startTime: Date;
      let endTime: Date;

      if (!startTimeResult.success) {
        rowErrors.push(`Cannot parse start date/time: '${startDateStr} ${startTimeStr}'`);
        startTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
      } else {
        startTime = startTimeResult.value!;
      }

      if (!endTimeResult.success) {
        rowErrors.push(`Cannot parse end date/time: '${endDateStr} ${endTimeStr}'`);
        endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1 hour
      } else {
        endTime = endTimeResult.value!;
      }

      if (endTime <= startTime) {
        rowErrors.push("End time must be after start time.");
      }

      const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      if (durationHours > 24) {
        rowErrors.push("Entry duration exceeds 24 hours.");
      }

      const durationDecimal = Math.round(durationHours * 10000) / 10000;

      // Fuzzy match project and task
      let suggestedProjectId: string | null = null;
      let suggestedTaskId: string | null = null;

      if (rawProject) {
        const key = rawProject.trim().toLowerCase();
        const matched = projectByName.get(key);
        if (matched) {
          suggestedProjectId = matched.id;

          // Match task within project
          if (rawTask) {
            const matchedTask = tasks.find(
              (t) =>
                t.projectId === matched.id &&
                t.name.trim().toLowerCase() === rawTask.trim().toLowerCase()
            );
            if (matchedTask) {
              suggestedTaskId = matchedTask.id;
            }
          }
        }
      }

      rows.push({
        rowIndex,
        rawClientName: rawClient || null,
        rawProjectName: rawProject || null,
        rawTaskName: rawTask || null,
        description: description || null,
        isBillable,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationDecimal,
        suggestedProjectId,
        suggestedTaskId,
        errors: rowErrors,
      });
    }

    const importSession = await prisma.importSession.create({
      data: {
        accountId,
        userId,
        fileName: file.name || null,
        fileHash,
        dateFormat,
        status: "pending",
        rowCount: rows.length,
        parseErrorsJson: JSON.stringify(parseErrors),
        previewRowsJson: JSON.stringify(rows),
      },
      select: { id: true },
     });

    const parseWarnings = unmappedColumns.length > 0
         ? [`Unrecognized column(s): ${unmappedColumns.map((h) => `'${h}'`).join(", ")}. Expected columns are: Client, Project, Task, Description, Billable, Start Date, Start Time, End Date, End Time.`]
         : [];

    return NextResponse.json({
      importSessionId: importSession.id,
      rows,
      totalRows: rows.length,
      parseErrors,
      parseWarnings,
      duplicateOfImportSessionId: previousCompletedImport?.id ?? null,
      previouslyImportedAt: previousCompletedImport?.completedAt?.toISOString() ?? null,
     });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("Parse CSV error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid date format. Use one of: ymd, dmy, mdy.", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to parse CSV file" },
      { status: 500 }
    );
  }
}

// CSV parsing helpers

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }

  fields.push(current);
  return fields;
}

function buildColumnMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const key = normaliseHeader(headers[i]);
    if (!map.has(key)) {
      map.set(key, i);
    }
  }
  return map;
}

function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getField(fields: string[], colMap: Map<string, number>, normalisedKey: string): string | null {
  const idx = colMap.get(normalisedKey);
  if (idx === undefined || idx >= fields.length) {
    return null;
  }
  const val = fields[idx].trim();
  return val.length === 0 ? null : val;
}

function isTruthy(value: string | null): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower === "yes" || lower === "true" || lower === "1";
}

function tryParseDateTime(
  datePart: string | null,
  timePart: string | null,
  dateFormat: "ymd" | "dmy" | "mdy"
): { success: boolean; value?: Date } {
  if (!datePart) return { success: false };

  const combined = timePart ? `${datePart} ${timePart}` : datePart;

  const slashDateFormat =
    dateFormat === "ymd" ? "yyyy/MM/dd" : dateFormat === "dmy" ? "dd/MM/yyyy" : "MM/dd/yyyy";

  const formats = [
    "yyyy-MM-dd HH:mm:ss",
    "yyyy-MM-dd H:mm:ss",
    "yyyy-MM-dd HH:mm",
    "yyyy-MM-dd H:mm",
    `${slashDateFormat} HH:mm:ss`,
    `${slashDateFormat} H:mm:ss`,
    `${slashDateFormat} HH:mm`,
    `${slashDateFormat} H:mm`,
    "yyyy-MM-dd",
    slashDateFormat,
  ];

  for (const format of formats) {
    const parsed = parseWithFormat(combined, format);
    if (parsed) {
      return { success: true, value: parsed };
    }
  }

  return { success: false };
}

function parseWithFormat(dateStr: string, format: string): Date | null {
  try {
    // Split all separators (space, slash, dash, colon) into numeric parts
    const parts = dateStr.split(/[\s/:\-]+/);
    if (parts.length < 3) return null;

    let year: number, month: number, day: number;

    if (format.startsWith("yyyy-MM-dd") || format.startsWith("yyyy/MM/dd")) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2], 10);
    } else if (format.startsWith("dd/MM/yyyy")) {
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else if (format.startsWith("MM/dd/yyyy")) {
      month = parseInt(parts[0], 10);
      day = parseInt(parts[1], 10);
      year = parseInt(parts[2], 10);
    } else {
      return null;
    }

    // Reject nonsensical values — prevents overflow dates from wrong format match
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const hour = parts.length > 3 ? parseInt(parts[3], 10) : 0;
    const minute = parts.length > 4 ? parseInt(parts[4], 10) : 0;
    const second = parts.length > 5 ? parseInt(parts[5], 10) : 0;

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (isNaN(date.getTime())) return null;

    // Verify the date didn't overflow (e.g. Feb 31 → Mar 3)
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }

    return date;
  } catch {
    return null;
  }
}
