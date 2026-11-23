import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { summarizeEntries, type SummaryEntry } from "../summary";

function entry(overrides: Partial<SummaryEntry> & { hours: number }): SummaryEntry {
  const { hours, ...rest } = overrides;
  return {
    projectId: "p1",
    taskId: null,
    isBillable: false,
    durationDecimal: hours,
    project: { id: "p1", name: "Alpha", color: "#111111", hourlyRate: 100, client: null },
    task: null,
    ...rest,
  };
}

const beta = { id: "p2", name: "Beta", color: "#222222", hourlyRate: null, client: null };
const gamma = { id: "p3", name: "Gamma", color: "#333333", hourlyRate: null, client: null };

describe("summarizeEntries", () => {
  it("groups by project and sums hours, billable hours and amounts", () => {
    const result = summarizeEntries(
      [
        entry({ hours: 1.5, isBillable: true }),
        entry({ hours: 0.5 }),
        entry({ hours: 2, projectId: "p2", project: beta }),
      ],
      { groupBy: "Project", roundUp: false, canViewAmounts: true },
    );

    expect(result.totalHours).toBe(4);
    expect(result.billableHours).toBe(1.5);
    expect(result.totalBilledAmount).toBe(150);
    expect(result.totalEntries).toBe(3);
    expect(result.groups.map((g) => [g.groupName, g.totalHours])).toEqual([
      ["Alpha", 2],
      ["Beta", 2],
    ]);
  });

  it("hides amounts when the caller cannot view them", () => {
    const result = summarizeEntries([entry({ hours: 1, isBillable: true })], {
      groupBy: "Project",
      roundUp: false,
      canViewAmounts: false,
    });

    expect(result.totalBilledAmount).toBeNull();
    expect(result.groups[0]!.billedAmount).toBeNull();
  });

  it("rounds each entry up to 10 minutes, like the Reports page", () => {
    // Two 3-minute entries round to 10 minutes each: 20 minutes, not one rounded 6-minute group.
    const result = summarizeEntries([entry({ hours: 0.05 }), entry({ hours: 0.05 })], {
      groupBy: "Project",
      roundUp: true,
      canViewAmounts: true,
    });

    expect(result.totalHours).toBe(0.33);
    expect(result.groups[0]!.totalHours).toBe(0.33);
  });

  it("sums rounded entries before fixing totals to two decimals", () => {
    const result = summarizeEntries(
      [
        entry({ hours: 0.05, isBillable: true }),
        entry({ hours: 0.05, isBillable: true, projectId: "p2", project: beta }),
        entry({ hours: 0.05, isBillable: true, projectId: "p3", project: gamma }),
      ],
      { groupBy: "Project", roundUp: true, canViewAmounts: false },
    );

    // 3 x 10 min = 0.5 h; summing per-group 0.17 values would give 0.51.
    expect(result.totalHours).toBe(0.5);
    expect(result.billableHours).toBe(0.5);
  });

  it("keeps zero-length entries at zero when rounding", () => {
    const result = summarizeEntries([entry({ hours: 0 })], {
      groupBy: "Project",
      roundUp: true,
      canViewAmounts: true,
    });

    expect(result.totalHours).toBe(0);
    expect(result.totalEntries).toBe(1);
  });
});
