#!/usr/bin/env node
import { execFile } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiGet, apiPost, loadConfig } from "./client.ts";
import {
  buildCorrectionChanges,
  buildEntryPayload,
  confirmUrlFor,
  correctionKeyFor,
  idempotencyKeyFor,
  nextStepFor,
  type OperationKind,
  type OperationStatus,
} from "./entries.ts";
import { formatLocal, PRESETS, resolvePeriod } from "./period.ts";

const config = loadConfig();
const openBrowser = process.env.TEMPOBASE_OPEN_BROWSER !== "0";
const server = new McpServer({ name: "tempobase", version: "0.3.0" });

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

interface OperationEntry {
  startTime: string;
  endTime: string;
}

interface Operation {
  id: string;
  kind: OperationKind;
  status: OperationStatus;
  entryId: string | null;
  entryDeleted: boolean;
  confirmUrl: string;
  entry: OperationEntry;
  before: OperationEntry | null;
}

const withLocal = (entry: OperationEntry) => ({
  ...entry,
  startLocal: formatLocal(entry.startTime, config.timeZone),
  endLocal: formatLocal(entry.endTime, config.timeZone),
});

/** Local times for the agent, and a confirm link on the configured host only. */
function describeOperation(op: Operation) {
  return {
    timeZone: config.timeZone,
    ...op,
    confirmUrl: confirmUrlFor(config.baseUrl, op.id),
    entry: withLocal(op.entry),
    before: op.before ? withLocal(op.before) : null,
    nextStep: nextStepFor(op),
  };
}

async function prepareAndOpen(body: object) {
  const op = describeOperation((await apiPost(config, "operations", body)) as Operation);
  if (op.status === "pending" && openBrowser) execFile("/usr/bin/open", [op.confirmUrl], () => undefined);
  return op;
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
        .describe("Omit normally: it is derived from the entry. Pass a new value only to prepare the same entry twice on purpose, or to create again an entry that was confirmed and later deleted."),
    },
  },
  (args) =>
    run(async () => {
      const payload = buildEntryPayload(args, config.timeZone);
      return prepareAndOpen({ idempotencyKey: args.idempotencyKey ?? idempotencyKeyFor(payload), ...payload });
    }),
);

server.registerTool(
  "prepare_time_entry_correction",
  {
    title: "Prepare a time entry correction",
    description:
      "Prepare a change to one of your own existing time entries for the user to confirm in TempoBase. Nothing changes until the user selects Confirm on the preview page, which this tool opens in the browser; the preview shows the entry now and after the change. " +
      "First find the entry with list_my_time_entries; when more than one entry matches what the user said, show the candidates (date, times, description, project) and ask which one. Never pick one yourself. " +
      "Pass only the fields the user asked to change; every other field stays as it is. Never invent values: when the user's request is ambiguous or a value is missing, ask. " +
      `Times are wall-clock HH:mm in ${config.timeZone}. Running timers, other users' entries, deletion and bulk changes are not supported. ` +
      "If the entry changes in TempoBase before the user confirms, the correction is not applied over it: TempoBase shows the new values and asks to confirm again. " +
      "Calling again with the same changes returns the same operation, and re-opens it when it was cancelled or expired.",
    inputSchema: {
      entryId: z.string().uuid().describe("id of the entry, from list_my_time_entries."),
      date: z
        .string()
        .optional()
        .describe("Local day of the entry's start, YYYY-MM-DD (the date in startLocal). Required when startTime or endTime is given; otherwise ignored."),
      startTime: z.string().optional().describe(`New start time, HH:mm (24 h) in ${config.timeZone}.`),
      endTime: z.string().optional().describe(`New end time, HH:mm (24 h) in ${config.timeZone}.`),
      endDate: z.string().optional().describe("Local day of the end time, YYYY-MM-DD, only when the entry crosses midnight. Defaults to date."),
      description: z.string().max(1000).nullable().optional().describe("New description. null clears it."),
      projectId: z.string().uuid().nullable().optional().describe("New project id from search_projects. null removes the project."),
      taskId: z
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe("New registered task id from search_projects; it must belong to the entry's project (pass projectId too when moving). null removes the task."),
      billable: z.boolean().optional().describe("New billable status."),
      idempotencyKey: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe("Omit normally: it is derived from the entry and the changes. Pass a new value only to apply the same change again after it was confirmed and later undone in TempoBase."),
    },
  },
  (args) =>
    run(async () => {
      const changes = buildCorrectionChanges(args, config.timeZone);
      return prepareAndOpen({
        kind: "correct_entry",
        idempotencyKey: args.idempotencyKey ?? correctionKeyFor(args.entryId, changes),
        entryId: args.entryId,
        ...changes,
      });
    }),
);

server.registerTool(
  "get_operation_status",
  {
    title: "Get operation status",
    description:
      "Status of an operation prepared with prepare_time_entry or prepare_time_entry_correction: pending, confirmed (with entryId), cancelled or expired. For a correction, before is the entry now and entry is the result. Use it after the user says they confirmed or cancelled.",
    inputSchema: { operationId: z.string().uuid().describe("id returned by prepare_time_entry or prepare_time_entry_correction.") },
  },
  (args) => run(async () => describeOperation((await apiGet(config, `operations/${args.operationId}`, {})) as Operation)),
);

await server.connect(new StdioServerTransport());
