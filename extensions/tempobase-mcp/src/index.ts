#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiGet, loadConfig } from "./client.ts";
import { formatLocal, PRESETS, resolvePeriod } from "./period.ts";

const config = loadConfig();
const server = new McpServer({ name: "tempobase", version: "0.1.0" });

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

await server.connect(new StdioServerTransport());
