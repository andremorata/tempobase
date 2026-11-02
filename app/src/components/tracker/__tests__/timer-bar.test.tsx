import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TimerBar } from "../timer-bar";

const { mockToastError, mockStartMutate, mockStopMutate, mockCancelMutate, mockAdjustStartMutate, mockUseRunningEntry, mockData } = vi.hoisted(() => ({
  mockData: {
    projects: [] as Array<Record<string, unknown>>,
    entries: [] as Array<Record<string, unknown>>,
    profile: undefined as Record<string, unknown> | undefined,
  },
  mockToastError: vi.fn(),
  mockAdjustStartMutate: vi.fn(),
  mockStartMutate: vi.fn(),
  mockStopMutate: vi.fn(),
  mockCancelMutate: vi.fn(),
  mockUseRunningEntry: vi.fn(),
}));

// ─── Mock all API hooks ───────────────────────────────────────────────────────

vi.mock("@/lib/api/hooks/time-entries", () => ({
  useStartTimer: () => ({ mutate: mockStartMutate, isPending: false }),
  useStopTimer: () => ({ mutate: mockStopMutate, isPending: false }),
  useRunningEntry: mockUseRunningEntry,
  useUpdateTimeEntry: () => ({ mutate: vi.fn(), isPending: false }),
  useAdjustTimerStart: () => ({ mutate: mockAdjustStartMutate, isPending: false }),
  useTimeEntries: () => ({ data: mockData.entries }),
  useCancelTimer: () => ({ mutate: mockCancelMutate, isPending: false }),
}));

vi.mock("@/lib/api/hooks/account", () => ({
  useCurrentUserProfile: () => ({ data: mockData.profile }),
}));

vi.mock("@/lib/api/hooks/projects", () => ({
  useProjects: () => ({ data: mockData.projects }),
}));

vi.mock("@/lib/api/hooks/tasks", () => ({
  useProjectTasks: () => ({ data: [] }),
}));

vi.mock("@/lib/api/hooks/tags", () => ({
  useTags: () => ({ data: [] }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
  },
}));

import { useRunningEntry } from "@/lib/api/hooks/time-entries";

function makeRunningEntry(overrides: Partial<NonNullable<ReturnType<typeof useRunningEntry>["data"]>> = {}) {
  const startTime = overrides.startTime ?? new Date().toISOString();

  return {
    id: "entry-1",
    accountId: "acc-1",
    userId: "user-1",
    startTime,
    entryDate: "2026-03-21",
    description: null,
    projectId: null,
    taskId: null,
    endTime: null,
    duration: null,
    isRunning: true,
    isBillable: true,
    tagIds: [],
    createdAt: startTime,
    updatedAt: startTime,
    ...overrides,
  };
}

// ─── Test wrapper ─────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "QueryClientWrapper";
  return Wrapper;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TimerBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunningEntry.mockReturnValue({ data: undefined });
    mockData.projects = [];
    mockData.entries = [];
    mockData.profile = undefined;
  });

  it("suggests recent entries only from Active projects or without a project", () => {
    mockData.projects = [
      { id: "open", name: "Open", status: "Active", color: "#111111" },
      { id: "paused", name: "Paused", status: "Inactive", color: "#222222" },
      { id: "done", name: "Done", status: "Archived", color: "#333333" },
    ];
    mockData.entries = [
      { description: "On open", projectId: "open", tagIds: [] },
      { description: "On paused", projectId: "paused", tagIds: [] },
      { description: "On done", projectId: "done", tagIds: [] },
      { description: "No project", projectId: null, tagIds: [] },
    ];

    render(<TimerBar />, { wrapper: makeWrapper() });
    fireEvent.focus(screen.getByPlaceholderText("What are you working on?"));

    expect(screen.getByText("On open")).toBeDefined();
    expect(screen.getByText("No project", { selector: "span.truncate" })).toBeDefined();
    expect(screen.queryByText("On paused")).toBeNull();
    expect(screen.queryByText("On done")).toBeNull();
  });

  it("ignores a default project that is no longer Active", () => {
    mockData.profile = { defaultProjectId: "paused" };
    mockData.projects = [{ id: "paused", name: "Paused", status: "Inactive", color: "#222222" }];

    render(<TimerBar />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByTitle("Start timer (Ctrl+Shift+S)"));

    expect(mockStartMutate.mock.calls[0][0].projectId ?? null).toBeNull();
  });

  it("applies a default project that is Active", () => {
    mockData.profile = { defaultProjectId: "open" };
    mockData.projects = [{ id: "open", name: "Open", status: "Active", color: "#111111" }];

    render(<TimerBar />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByTitle("Start timer (Ctrl+Shift+S)"));

    expect(mockStartMutate.mock.calls[0][0].projectId).toBe("open");
  });

  it("shows play button when no timer is running", () => {
    vi.mocked(useRunningEntry).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useRunningEntry>);

    render(<TimerBar />, { wrapper: makeWrapper() });

    // Play button should be present (Start timer title)
    expect(screen.getByTitle("Start timer (Ctrl+Shift+S)")).toBeDefined();
    // Stop button should not be present
    expect(screen.queryByTitle("Stop timer (Ctrl+Shift+S)")).toBeNull();
  });

  it("shows stop button and elapsed timer when a timer is running", () => {
    const startTime = new Date(Date.now() - 90 * 1000).toISOString(); // 1m30s ago

    vi.mocked(useRunningEntry).mockReturnValue({
      data: makeRunningEntry({ startTime }),
    } as ReturnType<typeof useRunningEntry>);

    render(<TimerBar />, { wrapper: makeWrapper() });

    expect(screen.getByTitle("Discard timer")).toBeDefined();
    expect(screen.getByTitle("Stop timer (Ctrl+Shift+S)")).toBeDefined();
    expect(screen.queryByTitle("Start timer (Ctrl+Shift+S)")).toBeNull();
    // Elapsed timer is shown in green
    const timerDisplay = screen.getByText(/\d+:\d\d:\d\d/);
    expect(timerDisplay).toBeDefined();
  });

  it("calls startTimer.mutate with correct payload when start is clicked", () => {
    vi.mocked(useRunningEntry).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useRunningEntry>);

    render(<TimerBar />, { wrapper: makeWrapper() });

    const descInput = screen.getByPlaceholderText("What are you working on?");
    fireEvent.change(descInput, { target: { value: "coding" } });

    const startBtn = screen.getByTitle("Start timer (Ctrl+Shift+S)");
    fireEvent.click(startBtn);

    expect(mockStartMutate).toHaveBeenCalledOnce();
    const [payload] = mockStartMutate.mock.calls[0];
    expect(payload.description).toBe("coding");
    expect(payload.isBillable).toBe(true); // default is billable
  });

  it("calls stopTimer.mutate when stop button is clicked", () => {
    const startTime = new Date().toISOString();

    vi.mocked(useRunningEntry).mockReturnValue({
      data: makeRunningEntry({ id: "entry-2", startTime }),
    } as ReturnType<typeof useRunningEntry>);

    render(<TimerBar />, { wrapper: makeWrapper() });

    const stopBtn = screen.getByTitle("Stop timer (Ctrl+Shift+S)");
    fireEvent.click(stopBtn);

    expect(mockStopMutate).toHaveBeenCalledOnce();
  });

  it("calls cancelTimer.mutate with the running entry id when cancel is confirmed", () => {
    vi.mocked(useRunningEntry).mockReturnValue({
      data: makeRunningEntry({ id: "entry-cancel" }),
    } as ReturnType<typeof useRunningEntry>);

    render(<TimerBar />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByTitle("Discard timer"));
    fireEvent.click(screen.getByRole("button", { name: "Discard timer" }));

    expect(mockCancelMutate).toHaveBeenCalledOnce();
    expect(mockCancelMutate).toHaveBeenCalledWith(
      "entry-cancel",
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("description input is editable when no timer is running", () => {
    vi.mocked(useRunningEntry).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useRunningEntry>);

    render(<TimerBar />, { wrapper: makeWrapper() });

    const input = screen.getByPlaceholderText("What are you working on?");
    expect(input.hasAttribute("disabled")).toBe(false);
  });

  it("shows a toast when start fails", () => {
    vi.mocked(useRunningEntry).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useRunningEntry>);

    // Simulate mutate calling onError
    mockStartMutate.mockImplementation((_data: unknown, opts: { onError?: (e: Error) => void }) => {
      opts?.onError?.(new Error("A timer is already running"));
    });

    render(<TimerBar />, { wrapper: makeWrapper() });

    const startBtn = screen.getByTitle("Start timer (Ctrl+Shift+S)");
    fireEvent.click(startBtn);

    expect(mockToastError).toHaveBeenCalledWith("Could not start timer.", {
      description: "A timer is already running",
    });
    expect(screen.queryByText("A timer is already running")).toBeNull();
  });

  describe("start time edit", () => {
    // 15:00 local today, timer started at 14:00 local
    const now = new Date(2026, 2, 21, 15, 0, 0);
    const startTime = new Date(2026, 2, 21, 14, 0, 0).toISOString();

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      vi.mocked(useRunningEntry).mockReturnValue({
        data: makeRunningEntry({ id: "entry-edit", startTime }),
      } as ReturnType<typeof useRunningEntry>);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function openEditor() {
      render(<TimerBar />, { wrapper: makeWrapper() });
      fireEvent.click(screen.getByTitle("Click to adjust start time"));
      return screen.getByPlaceholderText("09:00") as HTMLInputElement;
    }

    it("saves the new start time when the field loses focus", () => {
      const input = openEditor();
      fireEvent.change(input, { target: { value: "13:30" } });
      fireEvent.blur(input);

      expect(mockAdjustStartMutate).toHaveBeenCalledOnce();
      expect(mockAdjustStartMutate.mock.calls[0][0]).toEqual({
        id: "entry-edit",
        startTime: new Date(2026, 2, 21, 13, 30, 0).toISOString(),
      });
    });

    it("saves once when Enter is pressed", () => {
      const input = openEditor();
      fireEvent.change(input, { target: { value: "13:30" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(mockAdjustStartMutate).toHaveBeenCalledOnce();
    });

    it("discards the edit when Escape is pressed", () => {
      const input = openEditor();
      fireEvent.change(input, { target: { value: "13:30" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(mockAdjustStartMutate).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText("09:00")).toBeNull();
    });

    it("does not save when the value is unchanged", () => {
      const input = openEditor();
      fireEvent.blur(input);

      expect(mockAdjustStartMutate).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText("09:00")).toBeNull();
    });
  });
});
