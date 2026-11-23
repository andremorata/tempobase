import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type {
  CreateIntegrationTokenRequest,
  CreatedIntegrationToken,
  IntegrationToken,
} from "../types";

export const INTEGRATION_TOKENS_KEY = ["integration-tokens"] as const;

export function useIntegrationTokens() {
  return useQuery({
    queryKey: INTEGRATION_TOKENS_KEY,
    queryFn: () => apiFetch<IntegrationToken[]>("/account/integration-tokens"),
  });
}

export function useCreateIntegrationToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIntegrationTokenRequest) =>
      apiFetch<CreatedIntegrationToken>("/account/integration-tokens", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INTEGRATION_TOKENS_KEY }),
  });
}

export function useRevokeIntegrationToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/account/integration-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: INTEGRATION_TOKENS_KEY }),
  });
}
