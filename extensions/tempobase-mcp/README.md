# TempoBase MCP

Local `stdio` MCP server that reads your own TempoBase hours and time entries, prepares new entries and prepares corrections. It runs on your Mac, reads a personal token from the macOS Keychain, and calls the TempoBase API over HTTPS. It never reads browser cookies. It cannot save or change an entry on its own: you confirm each one in TempoBase.

## Tools

| Tool | What it returns |
| --- | --- |
| `get_my_hours` | Total and billable hours for a period, per project. The server computes them with the Summary report logic. Filters: `projectId`, `taskId`, `description`, `roundUp` (off by default). |
| `search_projects` | Projects and registered tasks you can access, matched by name. `limit` defaults to 50; `hasMore` says whether more matched. Use the ids in the other tools. |
| `list_my_time_entries` | Your own entries, newest first and paginated: id, date, start/end in UTC (`startTime`, `endTime`) and in your timezone (`startLocal`, `endLocal`, `YYYY-MM-DD HH:mm`), description, project, task, billable, running. |
| `prepare_time_entry` | Needs the `create` scope. Prepares a manual entry from `date`, `startTime`, `endTime` (`HH:mm` in your timezone), optional `endDate` (entries that cross midnight), `description`, `projectId`, `taskId` (needs its `projectId`) and `billable` (default `true`, like the app). Saves nothing. Returns the operation id, `status`, the preview and `confirmUrl`, and opens that URL in your browser. |
| `prepare_time_entry_correction` | Needs the `correct` scope. Prepares a change to one of your entries: `entryId` (from `list_my_time_entries`) and only the fields to change: `startTime`/`endTime` (`HH:mm`, with `date`, the entry's local start day, and `endDate` when it crosses midnight), `description`, `projectId`, `taskId` and `billable`. `null` clears description, project or task. Changes nothing. Returns `before` (the entry now), `entry` (after the change), `changedFields` and `confirmUrl`, and opens that URL. |
| `get_operation_status` | Needs the scope of the operation (`create` or `correct`). Status of a prepared entry or correction: `pending`, `confirmed` (with `entryId`), `cancelled` or `expired`. |

Periods take a `preset` (`today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`; weeks start on Monday) or `from`/`to` dates (`YYYY-MM-DD`). Presets resolve in `TEMPOBASE_TIMEZONE`, or the Mac's timezone when unset.

The `description` filter matches free text in the entry description. It is not a registered task. To filter by task, find its id with `search_projects` and pass `taskId`.

Only your own entries are returned, also for Owner and Admin. Amounts and rates are never returned.

## Creating an entry

1. Ask, for example, "Log Friday 14:00 to 15:30 on DVI2026, code review, 'Review PR 7'". The agent resolves the project and task with `search_projects` and asks when several match. It asks for missing times; it never derives a start time from a duration.
2. `prepare_time_entry` opens the preview in TempoBase. The link carries only the operation id; you must be signed in as the token's owner, or you get "not available".
3. Check the date, times, description, project, task and billable status, then select **Confirm and save** or **Cancel**. The preview expires after 15 minutes.
4. Ask the agent for the result. `get_operation_status` returns `confirmed` and the new entry id, or `cancelled` / `expired`.

Calling `prepare_time_entry` again with the same entry returns the same operation, also after a connection failure (the MCP retries once with the same key). It does not create a second entry. A cancelled or expired preview is re-opened for another 15 minutes, and you confirm it again.

On confirm, TempoBase checks again that the token is valid and still has `create`, and that you can still log time on the project and task. Revoking the token blocks pending confirmations.

## Correcting an entry

1. Ask, for example, "Show my entries from Friday on DVI2026. On the reviews one, change the end to 17:00". The agent lists them with `list_my_time_entries`. When more than one entry matches, it shows them and asks which one.
2. `prepare_time_entry_correction` opens the preview. It shows the entry now and after the change, and marks the fields that change. Everything else stays as it is.
3. Select **Confirm correction** or **Cancel**. The preview expires after 15 minutes.
4. If the entry was edited in TempoBase after the preview, confirming saves nothing. The page shows the entry's current values with your change applied, and you confirm again.
5. Ask the agent for the result. `get_operation_status` returns `confirmed`, or `cancelled` / `expired`.

Running timers, other users' entries, deletion and bulk changes are out of scope.

Set `TEMPOBASE_OPEN_BROWSER=0` to return the link without opening it.

## 1. Issue a token

In TempoBase, open **Settings > Integrations**, name the token (for example `Raycast`) and pick an expiration (at most 90 days). Turn on **Allow creating entries** to let the MCP prepare new entries, and **Allow correcting entries** to let it prepare changes to existing ones; leave both off for a read-only token. Select **Create token** and copy it: it is shown once. The token list shows each token's scopes.

Changing your password revokes all your tokens. Revoke a single token from the same screen.

## 2. Store it in the Keychain

```bash
security add-generic-password -U -a "$USER" -s tempobase-mcp -w
```

The command prompts for the token, so it stays out of your shell history. Use another service name with `TEMPOBASE_KEYCHAIN_SERVICE` if you keep several tokens.

## 3. Build

Requires Node.js 22.18 or newer. Requests time out after 15 seconds.

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
| | `TEMPOBASE_OPEN_BROWSER=0` (optional, do not open the preview) |

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
- `403` on `prepare_time_entry`: the token has no `create` scope (create a new one with **Allow creating entries**), or your role cannot log time.
- `403` on `prepare_time_entry_correction`: the token has no `correct` scope (create a new one with **Allow correcting entries**).
- `400` on a correction: nothing would change, the times are invalid, or the task does not belong to the entry's project (pass `taskId`, or `null`).
- `404`: the project or task does not exist or is outside your access.
- `409`: the project is not active, the entry is a running timer, or the `idempotencyKey` was used for a different entry.
