#!/usr/bin/env node
import { execFile } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiGet, apiPost, loadConfig } from "./client.ts";
import { buildEntryPayload, idempotencyKeyFor } from "./entries.ts";
import { formatLocal, PRESETS, resolvePeriod } from "./period.ts";

const config = loadConfig();
const openBrowser = process.env.TEMPOBASE_OPEN_BROWSER !== "0";
const server = new McpServer({ name: "tempobase", version: "0.2.0" });

const period = {
  preset: z.enum(PRESETS).optional().describe(`Relative period in ${config.timeZone}. Weeks start on Monday.`),
  from: z.string().optional().describe("Start date, YYYY-MM-DD. Use instead of preset."),
  to: z.string().optional().describe("End date, YYYY-MM-DD, inclusive. Defaults to from."),
};
const filters = {
  projectId: z.string().uuid().optional().describe("Project id from search_projects."),
  taskId: z.string().uuid().optional().describe("Registered task id from search_projects."),
  description: z
    .string()
    .optional()
    .describe(
      "Free text matched inside the entry description (case-insensitive). This is NOT a registered task: to filter by a task, resolve it with search_projects and pass taskId.",
    ),
};

async function run(fn: () => Promise<unknown>) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await fn(), null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
  }
}

server.registerTool(
  "get_my_hours",
  {
    title: "Get my hours",
    description:
      "Total hours of your own TempoBase time entries for a period, computed by the server exactly like the Summary report. Running timers are not counted. Optional filters: project, registered task (taskId) and description text; description text is not a registered task. roundUp applies the report's round-up (each entry up to 10 minutes) and is off by default.",
    inputSchema: {
      ...period,
      ...filters,
      roundUp: z.boolean().default(false).describe("Round each entry up to 10 minutes, like the report's Round up toggle."),
    },
  },
  (args) =>
    run(async () => {
      const range = resolvePeriod(args, new Date(), config.timeZone);
      const result = await apiGet(config, "hours", { ...range, projectId: args.projectId, taskId: args.taskId, description: args.description, roundUp: args.roundUp });
      return { timeZone: config.timeZone, ...(result as object) };
    }),
);

server.registerTool(
  "search_projects",
  {
    title: "Search projects and tasks",
    description:
      "Find projects and their registered tasks you can access, matching the project or task name. Use the returned ids as projectId/taskId in the other tools. Ask the user when more than one candidate matches.",
    inputSchema: {
      query: z.string().optional().describe("Part of a project or task name. Omit to list all accessible projects."),
      limit: z.number().int().positive().max(100).default(50).describe("Maximum projects to return. hasMore says whether more exist; narrow the query."),
    },
  },
  (args) => run(() => apiGet(config, "projects", { q: args.query, limit: args.limit })),
);

server.registerTool(
  "list_my_time_entries",
  {
    title: "List my time entries",
    description:
      "List your own time entries, newest first, with id, date, start/end time (UTC startTime/endTime and local startLocal/endLocal in the configured timezone), description, project, registered task and billable status. Use it to identify an entry; when several match, show them and ask the user which one. Description text is not a registered task.",
    inputSchema: {
      ...period,
      ...filters,
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(25),
    },
  },
  (args) =>
    run(async () => {
      const range = args.preset || args.from || args.to ? resolvePeriod(args, new Date(), config.timeZone) : {};
      const result = (await apiGet(config, "time-entries", {
        ...range,
        projectId: args.projectId,
        taskId: args.taskId,
        description: args.description,
        page: args.page,
        pageSize: args.pageSize,
      })) as { entries: Array<{ startTime: string; endTime: string | null }> };
      const entries = result.entries.map((e) => ({
        ...e,
        startLocal: formatLocal(e.startTime, config.timeZone),
        endLocal: formatLocal(e.endTime, config.timeZone),
      }));
      return { timeZone: config.timeZone, ...result, entries };
    }),
);

interface Operation {
  id: string;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  entryId: string | null;
  confirmUrl: string;
  entry: { startTime: string; endTime: string };
}

const NEXT_STEP: Record<Operation["status"], string> = {
  pending:
    "Nothing is saved yet. Tell the user to review the preview in TempoBase and select Confirm or Cancel, then call get_operation_status with this id.",
  confirmed: "The entry exists; entryId is its id. Do not prepare it again.",
  cancelled: "The user cancelled; nothing was saved. If the user asks again, call prepare_time_entry with the same entry: it re-opens the preview.",
  expired: "The preview expired after 15 minutes; nothing was saved. If the user still wants it, call prepare_time_entry with the same entry: it re-opens the preview.",
};

/** Local times for the agent, and a confirm link on the configured host only. */
function describeOperation(op: Operation) {
  const confirmUrl = new URL(new URL(op.confirmUrl).pathname, config.baseUrl).toString();
  return {
    timeZone: config.timeZone,
    ...op,
    confirmUrl,
    entry: { ...op.entry, startLocal: formatLocal(op.entry.startTime, config.timeZone), endLocal: formatLocal(op.entry.endTime, config.timeZone) },
    nextStep: NEXT_STEP[op.status],
  };
}

server.registerTool(
  "prepare_time_entry",
  {
    title: "Prepare a time entry",
    description:
      "Prepare a new manual time entry for the user to confirm in TempoBase. Nothing is saved until the user selects Confirm on the preview page, which this tool opens in the browser. " +
      `Times are wall-clock HH:mm in ${config.timeZone}. Ask the user for the date, start time and end time when any is missing; never derive the start from a duration or invent times. ` +
      "Resolve project and task ids with search_projects; when more than one matches, show the options and ask. Description text is not a registered task. " +
      "billable defaults to true, and the preview shows it. Calling again with the same entry returns the same operation instead of a duplicate, and re-opens it when it was cancelled or expired.",
    inputSchema: {
      date: z.string().describe("Day of the start time, YYYY-MM-DD."),
      startTime: z.string().describe(`Start time, HH:mm (24 h) in ${config.timeZone}.`),
      endTime: z.string().describe(`End time, HH:mm (24 h) in ${config.timeZone}. Must be after startTime.`),
      endDate: z.string().optional().describe("Day of the end time, YYYY-MM-DD, only when the entry crosses midnight. Defaults to date."),
      description: z.string().max(1000).optional().describe("Free-text description of the work."),
      projectId: z.string().uuid().optional().describe("Project id from search_projects."),
      taskId: z.string().uuid().optional().describe("Registered task id from search_projects. Requires its projectId."),
      billable: z.boolean().optional().describe("Billable status. Defaults to true, like new entries in the app."),
      idempotencyKey: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe("Omit normally: it is derived from the entry. Pass a new value only to prepare the same entry twice on purpose."),
    },
  },
  (args) =>
    run(async () => {
      const payload = buildEntryPayload(args, config.timeZone);
      const idempotencyKey = args.idempotencyKey ?? idempotencyKeyFor(payload);
      const op = describeOperation((await apiPost(config, "operations", { idempotencyKey, ...payload })) as Operation);
      if (op.status === "pending" && openBrowser) execFile("/usr/bin/open", [op.confirmUrl], () => undefined);
      return op;
    }),
);

server.registerTool(
  "get_operation_status",
  {
    title: "Get operation status",
    description:
      "Status of an entry prepared with prepare_time_entry: pending, confirmed (with entryId), cancelled or expired. Use it after the user says they confirmed or cancelled.",
    inputSchema: { operationId: z.string().uuid().describe("id returned by prepare_time_entry.") },
  },
  (args) => run(async () => describeOperation((await apiGet(config, `operations/${args.operationId}`, {})) as Operation)),
);

await server.connect(new StdioServerTransport());
