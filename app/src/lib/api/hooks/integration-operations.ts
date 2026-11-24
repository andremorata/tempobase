import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../client";
import type { IntegrationOperation, IntegrationOperationConflict } from "../types";
import { TIME_ENTRIES_KEY } from "./time-entries";

const operationKey = (id: string) => ["integration-operations", id] as const;

export function useIntegrationOperation(id: string) {
  return useQuery({
    queryKey: operationKey(id),
    queryFn: () => apiFetch<IntegrationOperation>(`/account/integration-operations/${id}`),
    retry: false,
  });
}

function useOperationAction(id: string, action: "confirm" | "cancel") {
  const qc = useQueryClient();
  return useMutation({
    // Confirm sends the preview version the user saw; the server refuses a stale one.
    mutationFn: (body?: { previewVersion: string }) =>
      apiFetch<IntegrationOperation>(`/account/integration-operations/${id}/${action}`, {
        method: "POST",
        body,
      }),
    onSuccess: (op) => {
      qc.setQueryData(operationKey(id), op);
      if (action === "confirm") void qc.invalidateQueries({ queryKey: TIME_ENTRIES_KEY });
    },
    onError: (error) => {
      // A correction whose entry changed comes back with its refreshed preview.
      const conflict = error instanceof ApiError ? (error.data as Partial<IntegrationOperationConflict> | undefined) : undefined;
      if (conflict?.code === "entry_changed" && conflict.operation) qc.setQueryData(operationKey(id), conflict.operation);
      else void qc.invalidateQueries({ queryKey: operationKey(id) });
    },
  });
}

export const useConfirmIntegrationOperation = (id: string) => useOperationAction(id, "confirm");
export const useCancelIntegrationOperation = (id: string) => useOperationAction(id, "cancel");
