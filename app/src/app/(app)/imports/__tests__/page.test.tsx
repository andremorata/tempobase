import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportsPage from "../page";

const importsMock = vi.hoisted(() => ({
  parseMutateAsync: vi.fn(),
  executeMutateAsync: vi.fn(),
}));

vi.mock("@/lib/api/hooks/imports", () => ({
  useParseCsvImport: () => ({
    mutateAsync: importsMock.parseMutateAsync,
    isPending: false,
  }),
  useExecuteImport: () => ({
    mutateAsync: importsMock.executeMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { role: "Member" } }),
}));

vi.mock("@/lib/api/hooks/projects", () => ({
  useProjects: () => ({ data: [] }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

function buildParseResponse(description: string, importSessionId: string) {
  return {
    importSessionId,
    rows: [
      {
        rowIndex: 0,
        rawClientName: null,
        rawProjectName: null,
        rawTaskName: null,
        description,
        isBillable: true,
        startTime: "2026-04-01T09:00:00.000Z",
        endTime: "2026-04-01T10:00:00.000Z",
        durationDecimal: 1,
        suggestedProjectId: null,
        suggestedTaskId: null,
        errors: [],
      },
    ],
    totalRows: 1,
    parseErrors: [],
    duplicateOfImportSessionId: null,
    previouslyImportedAt: null,
  };
}

describe("ImportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importsMock.executeMutateAsync.mockResolvedValue({
      importedCount: 1,
      skippedCount: 0,
      errors: [],
      skippedRows: [],
    });
  });

  it("keeps the newest parse result when same-name files resolve out of order", async () => {
    const user = userEvent.setup();
    let resolveFirstParse: (value: ReturnType<typeof buildParseResponse>) => void = () => {};

    importsMock.parseMutateAsync
      .mockImplementationOnce(
        () => new Promise<ReturnType<typeof buildParseResponse>>((resolve) => {
          resolveFirstParse = resolve;
        }),
      )
      .mockResolvedValueOnce(buildParseResponse("May work", "22222222-2222-4222-8222-222222222222"));

    render(<ImportsPage />);

    const fileInput = screen.getByLabelText(/csv file input/i);
    await user.upload(fileInput, new File(["old"], "timesheet.csv", { type: "text/csv" }));
    await user.upload(fileInput, new File(["new"], "timesheet.csv", { type: "text/csv" }));

    await screen.findByDisplayValue("May work");

    resolveFirstParse(buildParseResponse("April work", "11111111-1111-4111-8111-111111111111"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("May work")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("April work")).not.toBeInTheDocument();
    expect(importsMock.parseMutateAsync).toHaveBeenCalledTimes(2);
  });
});
