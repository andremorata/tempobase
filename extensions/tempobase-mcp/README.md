# TempoBase MCP

Local `stdio` MCP server that reads your own TempoBase hours and time entries. It runs on your Mac, reads a personal token from the macOS Keychain, and calls the TempoBase API over HTTPS. It never reads browser cookies and cannot write entries.

## Tools

| Tool | What it returns |
| --- | --- |
| `get_my_hours` | Total and billable hours for a period, per project. The server computes them with the Summary report logic. Filters: `projectId`, `taskId`, `description`, `roundUp` (off by default). |
| `search_projects` | Projects and registered tasks you can access, matched by name. Use the ids in the other tools. |
| `list_my_time_entries` | Your own entries, newest first and paginated: id, date, start/end, description, project, task, billable, running. |

Periods take a `preset` (`today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`; weeks start on Monday) or `from`/`to` dates (`YYYY-MM-DD`). Presets resolve in `TEMPOBASE_TIMEZONE`, or the Mac's timezone when unset.

The `description` filter matches free text in the entry description. It is not a registered task. To filter by task, find its id with `search_projects` and pass `taskId`.

Only your own entries are returned, also for Owner and Admin. Amounts and rates are never returned.

## 1. Issue a token

In TempoBase, open **Settings > Integrations**, name the token (for example `Raycast`), pick an expiration (at most 90 days) and select **Create read token**. Copy the token: it is shown once.

Changing your password revokes all your tokens. Revoke a single token from the same screen.

## 2. Store it in the Keychain

```bash
security add-generic-password -U -a "$USER" -s tempobase-mcp -w
```

The command prompts for the token, so it stays out of your shell history. Use another service name with `TEMPOBASE_KEYCHAIN_SERVICE` if you keep several tokens.

## 3. Build

Requires Node.js 22.18 or newer.

```bash
cd extensions/tempobase-mcp
pnpm install
pnpm build
pnpm test
```

The entry point is `dist/index.js`.

## 4. Install in Raycast

Open Raycast, run **Install Server** (MCP extension) and fill in:

| Field | Value |
| --- | --- |
| Name | `TempoBase` |
| Transport | `stdio` |
| Command | `node` (or the absolute path from `which node` if Raycast cannot find it) |
| Arguments | `/absolute/path/to/tempobase/extensions/tempobase-mcp/dist/index.js` |
| Environment | `TEMPOBASE_URL=https://your-tempobase-host` |
| | `TEMPOBASE_TIMEZONE=America/Sao_Paulo` (optional) |
| | `TEMPOBASE_KEYCHAIN_SERVICE=tempobase-mcp` (optional) |

The same settings as JSON, for clients that take an `mcpServers` config:

```json
{
  "mcpServers": {
    "tempobase": {
      "command": "node",
      "args": ["/absolute/path/to/tempobase/extensions/tempobase-mcp/dist/index.js"],
      "env": { "TEMPOBASE_URL": "https://your-tempobase-host", "TEMPOBASE_TIMEZONE": "America/Sao_Paulo" }
    }
  }
}
```

`TEMPOBASE_URL` must use `https`; plain `http` works only for `localhost`. The first call may show a macOS prompt asking to let `security` read the Keychain item.

## Check the result

Ask "How many hours did I log last week?" and compare with **Reports > Summary** for the same period and filters. With **Round up** on in the report, pass `roundUp: true`.

The Reports page shows a Member only their own entries, so the numbers match directly. For Owner, Admin and Manager it shows the whole team and has no user filter; compare with `GET /api/reports/summary?userId=<your user id>` instead.

## Errors

- `401`: the token is invalid, expired or revoked. Create a new one and replace the Keychain item.
- `404`: the project or task does not exist or is outside your access.
