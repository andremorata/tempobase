import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { IntegrationOperation } from "../types";
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
    mutationFn: () => apiFetch<IntegrationOperation>(`/account/integration-operations/${id}/${action}`, { method: "POST" }),
    onSuccess: (op) => {
      qc.setQueryData(operationKey(id), op);
      if (action === "confirm") void qc.invalidateQueries({ queryKey: TIME_ENTRIES_KEY });
    },
    onError: () => qc.invalidateQueries({ queryKey: operationKey(id) }),
  });
}

export const useConfirmIntegrationOperation = (id: string) => useOperationAction(id, "confirm");
export const useCancelIntegrationOperation = (id: string) => useOperationAction(id, "cancel");
