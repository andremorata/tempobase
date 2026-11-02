/** Budget use for the projects screen. `percent` passes 100 when the project is over budget. */
export function getBudgetProgress(loggedHours: number, budgetHours: number | null | undefined) {
  if (!budgetHours || budgetHours <= 0) return null;
  return {
    percent: Math.round((loggedHours / budgetHours) * 100),
    remainingHours: budgetHours - loggedHours,
  };
}
