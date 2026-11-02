import { describe, expect, it } from "vitest";
import { getBudgetProgress } from "../budget";

describe("getBudgetProgress", () => {
  it("returns the hours left and the percent used", () => {
    expect(getBudgetProgress(12.5, 50)).toEqual({ percent: 25, remainingHours: 37.5 });
  });

  it("lets the percent pass 100 and the balance go negative when over budget", () => {
    expect(getBudgetProgress(55, 50)).toEqual({ percent: 110, remainingHours: -5 });
  });

  it("returns null when the project has no budget", () => {
    expect(getBudgetProgress(10, null)).toBeNull();
    expect(getBudgetProgress(10, undefined)).toBeNull();
    expect(getBudgetProgress(10, 0)).toBeNull();
  });
});
