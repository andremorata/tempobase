/**
 * Minimal in-memory stand-in for the Prisma calls the integration routes make, so tests
 * assert real isolation outcomes instead of where-clause shapes.
 */

import { hashIntegrationToken } from "@/lib/auth/integration-tokens";

type Filter = string | boolean | null | { in?: string[]; gte?: Date; lte?: Date; contains?: string };
type Where = Record<string, unknown>;

function matches(value: unknown, filter: Filter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter === null || typeof filter !== "object") return value === filter;
  if (filter.in && !filter.in.includes(value as string)) return false;
  if (filter.gte && (value as Date) < filter.gte) return false;
  if (filter.lte && (value as Date) > filter.lte) return false;
  if (filter.contains !== undefined && !String(value ?? "").toLowerCase().includes(filter.contains.toLowerCase())) return false;
  return true;
}

const SCALAR_KEYS = ["id", "accountId", "userId", "projectId", "taskId", "isDeleted", "isRunning", "isBillable", "entryDate", "description", "name"];

function matchesWhere(row: Record<string, unknown>, where: Where): boolean {
  return SCALAR_KEYS.every((key) => matches(row[key], where[key] as Filter | undefined));
}

export const ids = {
  acctA: "aaaaaaaa-0000-4000-8000-000000000001",
  acctB: "bbbbbbbb-0000-4000-8000-000000000001",
  adminA: "aaaaaaaa-1111-4000-8000-000000000001",
  memberA: "aaaaaaaa-1111-4000-8000-000000000002",
  memberA2: "aaaaaaaa-1111-4000-8000-000000000003",
  memberTaskA: "aaaaaaaa-1111-4000-8000-000000000004",
  ownerB: "bbbbbbbb-1111-4000-8000-000000000001",
  projectA1: "aaaaaaaa-2222-4000-8000-000000000001",
  projectA2: "aaaaaaaa-2222-4000-8000-000000000002",
  projectB: "bbbbbbbb-2222-4000-8000-000000000001",
  taskA1: "aaaaaaaa-3333-4000-8000-000000000001",
  taskA2: "aaaaaaaa-3333-4000-8000-000000000002",
  taskB: "bbbbbbbb-3333-4000-8000-000000000001",
  missing: "99999999-9999-4999-8999-999999999999",
};

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export function createFakeDb(now: Date) {
  const accounts = [
    { id: ids.acctA, isDeleted: false },
    { id: ids.acctB, isDeleted: false },
  ];
  const users = [
    { id: ids.adminA, accountId: ids.acctA, role: "Admin", isActive: true, isDeleted: false, canViewAmounts: true },
    { id: ids.memberA, accountId: ids.acctA, role: "Member", isActive: true, isDeleted: false, canViewAmounts: false },
    { id: ids.memberA2, accountId: ids.acctA, role: "Member", isActive: true, isDeleted: false, canViewAmounts: false },
    { id: ids.memberTaskA, accountId: ids.acctA, role: "Member", isActive: true, isDeleted: false, canViewAmounts: false },
    { id: ids.ownerB, accountId: ids.acctB, role: "Owner", isActive: true, isDeleted: false, canViewAmounts: true },
  ];
  const projects = [
    { id: ids.projectA1, accountId: ids.acctA, name: "Alpha", color: "#111111", status: "Active", hourlyRate: 100, isDeleted: false, client: { id: "c1", name: "Acme" } },
    { id: ids.projectA2, accountId: ids.acctA, name: "Beta", color: "#222222", status: "Inactive", hourlyRate: 50, isDeleted: false, client: null },
    { id: ids.projectB, accountId: ids.acctB, name: "Other tenant", color: "#333333", status: "Active", hourlyRate: 999, isDeleted: false, client: null },
  ];
  const tasks = [
    { id: ids.taskA1, accountId: ids.acctA, projectId: ids.projectA1, name: "Code review", isActive: true, hourlyRate: 120, isDeleted: false },
    { id: ids.taskA2, accountId: ids.acctA, projectId: ids.projectA2, name: "Planning", isActive: true, hourlyRate: null, isDeleted: false },
    { id: ids.taskB, accountId: ids.acctB, projectId: ids.projectB, name: "Code review B", isActive: true, hourlyRate: 999, isDeleted: false },
  ];
  // memberA: restricted by project, no task rows. memberTaskA: restricted by task only.
  const projectAccess = [{ userId: ids.memberA, accountId: ids.acctA, projectId: ids.projectA1 }];
  const taskAccess = [{ userId: ids.memberTaskA, accountId: ids.acctA, taskId: ids.taskA1 }];

  let n = 0;
  const entry = (userId: string, accountId: string, date: string, hours: number, extra: Record<string, unknown> = {}) => ({
    id: `eeeeeeee-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    accountId,
    userId,
    projectId: null as string | null,
    taskId: null as string | null,
    description: null as string | null,
    entryDate: day(date),
    startTime: new Date(`${date}T09:00:00.000Z`),
    endTime: new Date(`${date}T10:00:00.000Z`) as Date | null,
    durationDecimal: hours as number | null,
    isBillable: false,
    isRunning: false,
    isDeleted: false,
    ...extra,
  });

  const timeEntries = [
    entry(ids.adminA, ids.acctA, "2026-11-20", 1.5, { projectId: ids.projectA1, taskId: ids.taskA1, description: "Review PR #42", isBillable: true }),
    entry(ids.adminA, ids.acctA, "2026-11-20", 0.05, { projectId: ids.projectA1, description: "standup" }),
    entry(ids.adminA, ids.acctA, "2026-11-21", 0.05, { projectId: ids.projectA2, description: "review notes" }),
    entry(ids.adminA, ids.acctA, "2026-11-19", 2, { projectId: ids.projectA2, isDeleted: true }),
    entry(ids.adminA, ids.acctA, "2026-11-21", 0, { projectId: ids.projectA2, isRunning: true, endTime: null, durationDecimal: null }),
    entry(ids.memberA, ids.acctA, "2026-11-20", 2, { projectId: ids.projectA1 }),
    entry(ids.memberA2, ids.acctA, "2026-11-20", 3, { projectId: ids.projectA2 }),
    entry(ids.memberTaskA, ids.acctA, "2026-11-20", 1, { projectId: ids.projectA1, taskId: ids.taskA1 }),
    entry(ids.ownerB, ids.acctB, "2026-11-20", 4, { projectId: ids.projectB, taskId: ids.taskB, description: "Review PR #42" }),
  ];

  const tokens: Array<Record<string, unknown>> = [];
  const addToken = (userId: string, overrides: Record<string, unknown> = {}) => {
    const user = users.find((u) => u.id === userId)!;
    const token = `tbp_${String(tokens.length).padStart(43, "x")}`;
    tokens.push({
      id: `token-${tokens.length}`,
      accountId: user.accountId,
      userId,
      scopes: ["read"],
      expiresAt: new Date(now.getTime() + 86_400_000),
      revokedAt: null,
      tokenHash: hashIntegrationToken(token),
      ...overrides,
    });
    return token;
  };

  const withRelations = (e: (typeof timeEntries)[number]) => ({
    ...e,
    project: projects.find((p) => p.id === e.projectId) ?? null,
    task: tasks.find((t) => t.id === e.taskId) ?? null,
  });

  const filterTasks = (projectId: string, where: Where = {}) =>
    tasks.filter((t) => t.projectId === projectId && matchesWhere(t, where));

  const prisma = {
    integrationToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = tokens.find((t) => t.tokenHash === where.tokenHash);
        if (!row) return null;
        const user = users.find((u) => u.id === row.userId)!;
        return { ...row, user: { ...user, account: accounts.find((a) => a.id === user.accountId)! } };
      },
      update: async () => ({}),
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.find((u) => u.id === where.id) ?? null,
    },
    userProjectAccess: {
      findMany: async ({ where }: { where: { userId: string; accountId: string } }) =>
        projectAccess.filter((a) => a.userId === where.userId && a.accountId === where.accountId),
    },
    userTaskAccess: {
      findMany: async ({ where }: { where: { userId: string; accountId: string } }) =>
        taskAccess.filter((a) => a.userId === where.userId && a.accountId === where.accountId),
    },
    project: {
      count: async ({ where }: { where: Where }) => projects.filter((p) => matchesWhere(p, where)).length,
      findMany: async ({
        where,
        take,
        select,
      }: {
        where: Where & { OR?: Where[] };
        take?: number;
        select: { tasks: { where: Where } };
      }) => {
        const q = (where.OR?.[0]?.name as { contains: string } | undefined)?.contains.toLowerCase();
        const taskWhere = (where.OR?.[1]?.tasks as { some: Where } | undefined)?.some;
        return projects
          .filter((p) => matchesWhere(p, where))
          .filter((p) => !q || p.name.toLowerCase().includes(q) || filterTasks(p.id, taskWhere).length > 0)
          .slice(0, take)
          .map((p) => ({ ...p, tasks: filterTasks(p.id, select.tasks.where).map(({ id, name, isActive }) => ({ id, name, isActive })) }));
      },
    },
    projectTask: {
      count: async ({ where }: { where: Where }) => tasks.filter((t) => matchesWhere(t, where)).length,
      findFirst: async ({ where }: { where: Where }) => tasks.find((t) => matchesWhere(t, where)) ?? null,
    },
    timeEntry: {
      findMany: async ({
        where,
        skip = 0,
        take,
        orderBy = [],
      }: {
        where: Where;
        skip?: number;
        take?: number;
        orderBy?: Array<Record<string, "asc" | "desc">>;
      }) =>
        timeEntries
          .filter((e) => matchesWhere(e, where))
          .sort((a, b) => {
            for (const rule of orderBy) {
              const [key, dir] = Object.entries(rule)[0]!;
              const [x, y] = [a[key as keyof typeof a], b[key as keyof typeof b]];
              const diff = x instanceof Date && y instanceof Date ? x.getTime() - y.getTime() : String(x).localeCompare(String(y));
              if (diff !== 0) return dir === "desc" ? -diff : diff;
            }
            return 0;
          })
          .slice(skip, take === undefined ? undefined : skip + take)
          .map(withRelations),
    },
  };

  return { prisma, users, accounts, addToken };
}
