"use client";

import { useState } from "react";
import { AlertCircle, Check, Copy, Plug, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage } from "@/lib/api/client";
import { useCurrentUserProfile } from "@/lib/api/hooks/account";
import {
  useCreateIntegrationToken,
  useIntegrationTokens,
  useRevokeIntegrationToken,
} from "@/lib/api/hooks/integration-tokens";
import type { CreatedIntegrationToken, IntegrationToken } from "@/lib/api/types";
import { hasRole, TRACKER_ROLES } from "@/lib/auth/roles";
import { formatDateByPreference, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const EXPIRATIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

const KEYCHAIN_COMMAND = 'security add-generic-password -U -a "$USER" -s tempobase-mcp -w';

function CopyButton({ value, label, toastMessage }: { value: string; label: string; toastMessage: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(toastMessage);
  };
  return (
    <Button variant="outline" onClick={handleCopy} aria-label={label} className="shrink-0">
      {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function IntegrationTokensCard() {
  const { data: tokens, isLoading, isError, refetch } = useIntegrationTokens();
  const { data: profile } = useCurrentUserProfile();
  const createToken = useCreateIntegrationToken();
  const revokeToken = useRevokeIntegrationToken();

  const [name, setName] = useState("Raycast");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [allowCreate, setAllowCreate] = useState(false);
  const canCreateEntries = hasRole(TRACKER_ROLES, profile?.role);
  const [created, setCreated] = useState<CreatedIntegrationToken | null>(null);
  const [revoking, setRevoking] = useState<IntegrationToken | null>(null);

  const formatDay = (iso: string) => formatDateByPreference(iso, profile?.dateFormat);
  const now = new Date();
  const isExpired = (token: IntegrationToken) => new Date(token.expiresAt) <= now;
  const sortedTokens = [...(tokens ?? [])].sort((a, b) => Number(isExpired(a)) - Number(isExpired(b)));

  const handleCreate = async () => {
    try {
      setCreated(
        await createToken.mutateAsync({
          name: name.trim(),
          expiresInDays: Number(expiresInDays),
          scopes: allowCreate && canCreateEntries ? ["create"] : [],
        }),
      );
    } catch (err) {
      toast.error("Could not create token.", { description: getApiErrorMessage(err, "Failed to create token.") });
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    try {
      await revokeToken.mutateAsync(revoking.id);
      if (created?.id === revoking.id) setCreated(null);
      toast.success("Token revoked.");
    } catch (err) {
      toast.error("Could not revoke token.", { description: getApiErrorMessage(err, "Failed to revoke token.") });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-emerald-600" />
          <CardTitle>Integrations</CardTitle>
        </div>
        <CardDescription>
          Personal tokens let the local TempoBase MCP (for example in Raycast) read your own hours and entries, and
          optionally prepare new entries that you confirm here. Changing your password revokes them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/30 p-4 md:grid-cols-[1fr_160px] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="integration-token-name">Token name</Label>
            <Input
              id="integration-token-name"
              value={name}
              maxLength={100}
              disabled={createToken.isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Expires in</Label>
            <Select
              value={expiresInDays}
              onValueChange={(value) => setExpiresInDays(value ?? "30")}
              disabled={createToken.isPending}
            >
              <SelectTrigger aria-label="Expires in" className="w-full data-[size=default]:h-9">
                <SelectValue>{EXPIRATIONS.find((e) => e.value === expiresInDays)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EXPIRATIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canCreateEntries && (
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-4 md:col-span-2">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="integration-token-create">Allow creating entries</Label>
                  <p className="text-sm text-muted-foreground">
                    The MCP can prepare new time entries. Nothing is saved until you confirm each one in TempoBase.
                  </p>
                </div>
                <Switch
                  id="integration-token-create"
                  checked={allowCreate}
                  onCheckedChange={setAllowCreate}
                  disabled={createToken.isPending}
                />
              </div>
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                Write access. The token can propose entries; you still confirm each one.
              </p>
            </div>
          )}
          <Button
            size="lg"
            onClick={handleCreate}
            disabled={createToken.isPending || !name.trim()}
            className="md:col-span-2 md:justify-self-end"
          >
            {createToken.isPending ? "Creating…" : "Create token"}
          </Button>
        </div>

        {created && (
          <div role="status" className="space-y-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Token “{created.name}” is shown only once
                </p>
                <p className="text-sm text-muted-foreground">
                  Copy it now; you can&apos;t see it again. It disappears when you select Done.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <code
                aria-label="New integration token"
                className="flex-1 select-all break-all rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-5"
              >
                {created.token}
              </code>
              <CopyButton value={created.token} label="Copy token" toastMessage="Token copied." />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Store in macOS Keychain</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <pre
                  aria-label="Keychain command"
                  className="flex-1 overflow-x-auto rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-5"
                >
                  {KEYCHAIN_COMMAND}
                </pre>
                <CopyButton value={KEYCHAIN_COMMAND} label="Copy Keychain command" toastMessage="Command copied." />
              </div>
              <p className="text-xs text-muted-foreground">The command prompts for the token, so it stays out of your shell history.</p>
            </div>

            <Button variant="outline" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">Tokens</h2>
          <div className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading tokens…</p>}

            {isError && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 p-4">
                <p className="text-sm text-destructive">Couldn&apos;t load tokens.</p>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  Retry
                </Button>
              </div>
            )}

            {!isLoading && !isError && tokens?.length === 0 && (
              <p className="text-sm text-muted-foreground">No tokens yet. Create one above to connect Raycast.</p>
            )}

            {sortedTokens.map((token) => {
              const expired = isExpired(token);
              return (
                <div
                  key={token.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={expired ? "font-medium text-muted-foreground" : "font-medium"}>{token.name}</p>
                      <code className="font-mono text-xs text-muted-foreground">{token.tokenPrefix}…</code>
                      <span className="inline-flex shrink-0 gap-1">
                        {token.scopes.map((scope) => (
                          <Badge
                            key={scope}
                            variant={scope === "create" ? "outline" : "secondary"}
                            className={cn(
                              "capitalize",
                              scope === "create" && "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300",
                            )}
                          >
                            {scope}
                          </Badge>
                        ))}
                      </span>
                      {expired && <Badge variant="destructive">Expired</Badge>}
                    </div>
                    <dl className="grid gap-0.5 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:gap-x-4">
                      <div>
                        <dt className="inline">Created </dt>
                        <dd className="inline">{formatDay(token.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline">{expired ? "Expired " : "Expires "}</dt>
                        <dd className="inline">{formatDay(token.expiresAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline">Last used </dt>
                        <dd className="inline">
                          {token.lastUsedAt ? `${formatDay(token.lastUsedAt)} ${formatTime(token.lastUsedAt)}` : "never"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setRevoking(token)}
                    disabled={revokeToken.isPending}
                    className="sm:shrink-0"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Revoke
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke token"
        description={`"${revoking?.name ?? ""}" stops working immediately. Any MCP client using it gets 401 errors.`}
        confirmLabel="Revoke"
        variant="destructive"
        loading={revokeToken.isPending}
        onConfirm={() => void handleRevoke()}
      />
    </Card>
  );
}
