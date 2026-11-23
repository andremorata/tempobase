"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, CalendarClock, Check, CheckCircle2, Clock, KeyRound, Plug, TimerOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ApiError, getApiErrorMessage } from "@/lib/api/client";
import { useCurrentUserProfile } from "@/lib/api/hooks/account";
import {
  useCancelIntegrationOperation,
  useConfirmIntegrationOperation,
  useIntegrationOperation,
} from "@/lib/api/hooks/integration-operations";
import type { IntegrationOperation, IntegrationOperationStatus } from "@/lib/api/types";
import { formatDateByPreference, formatTime, type DateFormatPreference } from "@/lib/format";
import { cn } from "@/lib/utils";

const TTL_MS = 15 * 60_000;
const WARN_MS = 2 * 60_000;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function formatHours(hours: number) {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatCountdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "Sao Paulo time (GMT-3)" for the browser's zone, which the times are shown in. */
function timeZoneLabel(at: Date) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const city = zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
  const short = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return short ? `${city} time (${short})` : `${city} time`;
}

type ViewState = Exclude<IntegrationOperationStatus, "pending"> | "blocked";

const STATES: Record<ViewState, { icon: typeof Ban; badge: string; title: string; body: string; className: string }> = {
  confirmed: {
    icon: CheckCircle2,
    badge: "Confirmed",
    title: "Entry created",
    body: "Entry saved to your timesheet.",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  },
  cancelled: {
    icon: Ban,
    badge: "Cancelled",
    title: "Cancelled",
    body: "Nothing was saved. Ask the integration to create it again if you still need it.",
    className: "border-border bg-muted/50 text-foreground",
  },
  expired: {
    icon: TimerOff,
    badge: "Expired",
    title: "Expired",
    body: "This preview was not confirmed within 15 minutes, so nothing was saved. Ask the integration to create it again.",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  blocked: {
    icon: KeyRound,
    badge: "Blocked",
    title: "Token no longer valid",
    body: "The integration token that prepared this was revoked or expired. Ask the integration to create it again.",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

function Detail({ label, children, muted }: { label: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-2.5 text-sm sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words font-medium", muted && "font-normal text-muted-foreground")}>{children}</dd>
    </div>
  );
}

function RequestedBy({ op }: { op: IntegrationOperation }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Requested by</span>
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium">
        <Plug className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span className="truncate">{op.integration.name}</span>
        <code className="font-mono font-normal text-muted-foreground">{op.integration.tokenPrefix}…</code>
      </span>
    </div>
  );
}

const footerLink = cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto");

function OperationCard({ op, dateFormat }: { op: IntegrationOperation; dateFormat?: DateFormatPreference }) {
  const confirm = useConfirmIntegrationOperation(op.id);
  const cancel = useCancelIntegrationOperation(op.id);
  const now = useNow(op.status === "pending");
  const remainingMs = new Date(op.expiresAt).getTime() - now;
  const status: IntegrationOperationStatus = op.status === "pending" && remainingMs <= 0 ? "expired" : op.status;
  const blocked = status === "pending" && !op.integration.tokenUsable;
  const confirmable = status === "pending" && !blocked;
  const viewState: ViewState | null = blocked ? "blocked" : status === "pending" ? null : status;
  const dimmed = viewState !== null && viewState !== "confirmed";
  const busy = confirm.isPending || cancel.isPending;
  const { entry } = op;
  const start = new Date(entry.startTime);
  const weekday = start.toLocaleDateString(undefined, { weekday: "long" });
  const sameDay = start.toDateString() === new Date(entry.endTime).toDateString();
  const state = viewState ? STATES[viewState] : null;

  const run = async (action: typeof confirm, failure: string) => {
    try {
      await action.mutateAsync();
    } catch (err) {
      toast.error(failure, { description: getApiErrorMessage(err, failure) });
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4">
        <RequestedBy op={op} />
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{confirmable ? "Confirm new time entry" : "New time entry"}</h1>
            {state && dimmed && <Badge variant="outline">{state.badge}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {confirmable
              ? "Nothing is saved until you confirm. Check every field."
              : blocked
                ? "This request can no longer be confirmed. You can still cancel it."
                : "This request is closed. Nothing else will be saved from it."}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {state && (
          <div role="status" className={cn("flex gap-3 rounded-xl border p-4", state.className)}>
            <state.icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{state.title}</p>
              <p className="text-sm opacity-90">
                {viewState === "confirmed" && op.entryDeleted
                  ? "This entry was saved and later deleted from your timesheet."
                  : state.body}
              </p>
            </div>
          </div>
        )}

        <div className={cn("space-y-5", dimmed && "opacity-70")}>
          <div className="rounded-xl border border-border/70 bg-muted/30 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              <span className="capitalize">{weekday}</span>
              <span aria-hidden>·</span>
              <span>{formatDateByPreference(entry.startTime, dateFormat)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
                {formatTime(entry.startTime)}
                <span className="px-2 text-muted-foreground">–</span>
                {formatTime(entry.endTime)}
              </p>
              {!sameDay && <Badge variant="outline">ends next day</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatHours(entry.durationHours)} · {timeZoneLabel(start)}
            </p>
          </div>

          <dl className="divide-y divide-border/60">
            <Detail label="Description" muted={!entry.description}>
              {entry.description ?? "No description"}
            </Detail>
            <Detail label="Project" muted={!entry.project}>
              {entry.project?.name ?? "No project"}
            </Detail>
            <Detail label="Task" muted={!entry.task}>
              {entry.task?.name ?? "No task"}
            </Detail>
            <Detail label="Billable">
              <Badge variant={entry.isBillable && !dimmed ? "default" : "secondary"}>
                {entry.isBillable ? "Billable" : "Non-billable"}
              </Badge>
            </Detail>
          </dl>
        </div>

        {confirmable && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Expires in <span className="font-mono tabular-nums text-foreground">{formatCountdown(remainingMs)}</span>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Time left to confirm"
              aria-valuemin={0}
              aria-valuemax={TTL_MS / 1000}
              aria-valuenow={Math.max(0, Math.round(remainingMs / 1000))}
              aria-valuetext={`${formatCountdown(remainingMs)} left`}
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-1000 ease-linear",
                  remainingMs < WARN_MS ? "bg-amber-500" : "bg-emerald-500",
                )}
                style={{ width: `${Math.max(0, Math.min(100, (remainingMs / TTL_MS) * 100))}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col-reverse gap-2 border-t sm:flex-row sm:justify-end">
        {status === "pending" ? (
          <>
            <Button variant="outline" disabled={busy} onClick={() => void run(cancel, "Could not cancel.")} className="w-full sm:w-auto">
              {cancel.isPending ? "Cancelling…" : "Cancel"}
            </Button>
            {confirmable && (
              <Button disabled={busy} onClick={() => void run(confirm, "Could not create the entry.")} className="w-full sm:w-auto">
                <Check className="mr-2 h-4 w-4" />
                {confirm.isPending ? "Saving…" : "Confirm and save"}
              </Button>
            )}
          </>
        ) : status === "confirmed" ? (
          <Link href="/tracker" className={footerLink}>
            Open time entries
          </Link>
        ) : (
          <Link href="/tracker" className={footerLink}>
            Go to tracker
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}

function UnavailableCard({ error }: { error: unknown }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4" />
          <span>{notFound ? "Not available to this account" : "Something went wrong"}</span>
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {notFound ? "Entry request not found" : "Could not load this request"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {notFound
              ? "This link is wrong, or it belongs to another account. Sign in with the account that created the token."
              : getApiErrorMessage(error, "Try again in a moment.")}
          </p>
        </div>
      </CardHeader>
      <CardFooter className="flex flex-col gap-2 border-t sm:flex-row sm:justify-end">
        <Link href="/tracker" className={footerLink}>
          Go to tracker
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function IntegrationOperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: op, isLoading, isError, error } = useIntegrationOperation(id);
  const { data: profile } = useCurrentUserProfile();

  return (
    <div className="mx-auto max-w-xl space-y-6 py-2 md:py-6">
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <UnavailableCard error={error} />}
      {op && <OperationCard op={op} dateFormat={profile?.dateFormat as DateFormatPreference | undefined} />}
    </div>
  );
}
