import type { ChartGranularity } from "@/lib/reports/granularity";

// ─── Clients ────────────────────────────────────────────────────────────────

export interface Client {
  id: string;
  accountId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateClientRequest {
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface UpdateClientRequest {
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

// ─── Projects ───────────────────────────────────────────────────────────────

export type BillingType = "Hourly" | "Fixed" | "NonBillable";
export type ProjectStatus = "Active" | "Inactive" | "Archived";

export interface ProjectTaskSummary {
  id: string;
  name: string;
  hourlyRate?: number | null;
}

export interface Project {
  id: string;
  accountId: string;
  clientId?: string | null;
  name: string;
  color: string;
  status: ProjectStatus;
  billingType: BillingType;
  hourlyRate?: number | null;
  budgetHours?: number | null;
  createdAt: string;
  updatedAt?: string | null;
  tasks?: ProjectTaskSummary[];
}

export interface CreateProjectRequest {
  name: string;
  color?: string;
  clientId?: string | null;
  billingType?: BillingType;
  hourlyRate?: number | null;
  budgetHours?: number | null;
}

export interface UpdateProjectRequest {
  name?: string;
  status?: ProjectStatus;
  color?: string;
  clientId?: string | null;
  billingType?: BillingType;
  hourlyRate?: number | null;
  budgetHours?: number | null;
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export interface ProjectTask {
  id: string;
  accountId: string;
  projectId: string;
  name: string;
  hourlyRate?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateProjectTaskRequest {
  projectId: string;
  name: string;
  hourlyRate?: number | null;
}

export interface UpdateProjectTaskRequest {
  name: string;
  hourlyRate?: number | null;
}

// ─── Time Entries ───────────────────────────────────────────────────────────

export interface TimeEntry {
  id: string;
  accountId: string;
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
  description?: string | null;
  entryDate: string;
  startTime: string;
  endTime?: string | null;
  duration?: string | null;
  durationDecimal?: number | null;
  isBillable: boolean;
  isRunning: boolean;
  /** When the app was last open before it went away, for stale-timer recovery (null if never). */
  lastSessionEndAt?: string | null;
  tagIds: string[];
  taskName?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateTimeEntryRequest {
  startTime: string;
  endTime: string;
  description?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  isBillable?: boolean;
  tagIds?: string[];
}

export interface UpdateTimeEntryRequest {
  startTime: string;
  endTime: string;
  description?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  isBillable?: boolean;
  tagIds?: string[];
}

export interface StartTimerRequest {
  description?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  isBillable?: boolean;
}

export interface StopTimerRequest {
  timeEntryId: string;
}

// ─── Tags ───────────────────────────────────────────────────────────────────

export interface Tag {
  id: string;
  accountId: string;
  name: string;
  color?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateTagRequest {
  name: string;
  color?: string | null;
}

export interface UpdateTagRequest {
  name: string;
  color?: string | null;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export type SummaryGroupBy = "Project" | "Client" | "Task";
export type PersistedReportGroupBy = "project" | "client" | "user" | "task" | "tag";
export type ReportGroupByInput = SummaryGroupBy | PersistedReportGroupBy;

export interface ReportFilters {
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  userId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  description?: string | null;
  roundUp?: boolean | null;
}

export interface SummaryGroupRow {
  groupId: string;
  groupName: string;
  color?: string | null;
  totalHours: number;
  billableHours: number;
  billedAmount: number;
  entryCount: number;
}

export interface SummaryReportResponse {
  groups: SummaryGroupRow[];
  totalHours: number;
  billableHours: number;
  totalBilledAmount: number;
  totalEntries: number;
}

export interface DetailedEntryRow {
  id: string;
  projectName?: string | null;
  projectColor?: string | null;
  clientName?: string | null;
  taskName?: string | null;
  description?: string | null;
  entryDate: string;
  startTime: string;
  endTime?: string | null;
  durationDecimal?: number | null;
  isBillable: boolean;
  billedAmount?: number | null;
  tagNames: string[];
}

export interface DetailedReportResponse {
  entries: DetailedEntryRow[];
  totalHours: number;
  billableHours: number;
  totalBilledAmount: number;
  totalEntries: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface WeekRow {
  weekStart: string;
  weekEnd: string;
  dayTotals: number[];
  weekTotal: number;
}

export interface WeeklyReportResponse {
  weeks: WeekRow[];
  grandTotal: number;
}

export interface SharedReportResponse {
  id: string;
  name: string;
  token: string;
  reportType: string;
  from?: string | null;
  to?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

// ─── Account & Profile ─────────────────────────────────────────────────────

export interface AccountSettings {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  auditRetentionDays: number;
}

export interface UpdateAccountRequest {
  name: string;
  timezone: string;
  currency: string;
  auditRetentionDays: number;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  dateFormat: "system" | "ymd" | "dmy" | "mdy";
  defaultProjectId?: string | null;
  defaultLandingPage: "dashboard" | "tracker" | "timesheet";
  showAuditMetadata: boolean;
  canViewAmounts: boolean;
}

export interface UpdateUserProfileRequest {
  firstName: string;
  lastName: string;
  dateFormat: "system" | "ymd" | "dmy" | "mdy";
  defaultProjectId?: string | null;
  defaultLandingPage: "dashboard" | "tracker" | "timesheet";
  showAuditMetadata: boolean;
}

export interface AuditLogItem {
  id: string;
  occurredAt: string;
  accountId: string;
  actorUserId?: string | null;
  actorEmail: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  changesJson?: string | null;
}

export interface AuditLogListResponse {
  items: AuditLogItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface AuditLogListRequest {
  search?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface PurgeTimeEntriesRequest {
  from?: string | null;
  to?: string | null;
}

export interface PurgeTimeEntriesResponse {
  purgedCount: number;
  from?: string | null;
  to?: string | null;
  purgedAt: string;
}

export interface DeleteWorkspaceRequest {
  confirmationText: string;
  currentPassword: string;
}

export interface DeleteCurrentUserRequest {
  confirmationText: string;
  currentPassword: string;
}

export interface AccountExportMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface AccountExportClient {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface AccountExportProject {
  id: string;
  clientId?: string | null;
  name: string;
  color: string;
  status: string;
  billingType: string;
  hourlyRate?: number | null;
  budgetHours?: number | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface AccountExportTask {
  id: string;
  projectId: string;
  name: string;
  hourlyRate?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface AccountExportTag {
  id: string;
  name: string;
  color?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface AccountExportTimeEntry {
  id: string;
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
  description?: string | null;
  entryDate: string;
  startTime: string;
  endTime?: string | null;
  durationDecimal?: number | null;
  isBillable: boolean;
  isRunning: boolean;
  tagIds: string[];
  createdAt: string;
  updatedAt?: string | null;
}

export interface AccountExportResponse {
  account: AccountSettings;
  members: AccountExportMember[];
  clients: AccountExportClient[];
  projects: AccountExportProject[];
  tasks: AccountExportTask[];
  tags: AccountExportTag[];
  timeEntries: AccountExportTimeEntry[];
  exportedAt: string;
}

// ─── Team ──────────────────────────────────────────────────────────────────

export interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  canViewAmounts: boolean;
  createdAt: string;
  allowedProjectIds: string[];
  allowedTaskIds: string[];
}

export interface UpdateTeamMemberRequest {
  role?: "Admin" | "Manager" | "Member" | "Viewer";
  canViewAmounts?: boolean;
}

export interface AccountInvite {
  id: string;
  token: string;
  joinUrl: string;
  expiresAt: string;
  usedAt?: string | null;
  createdAt: string;
}

export interface CreateInviteRequest {
  expiresAt?: string | null;
}

export interface RegisterViaInviteRequest {
  inviteToken: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardKpis {
  totalHoursThisWeek: number;
  totalHoursToday: number;
  activeProjectsCount: number;
  billablePercentage: number;
}

export interface DayHoursRow {
  date: string;
  totalHours: number;
}

export interface ProjectHoursRow {
  projectId: string;
  projectName: string;
  projectColor?: string | null;
  totalHours: number;
}

export interface RecentEntryRow {
  id: string;
  description?: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  entryDate: string;
  startTime: string;
  endTime?: string | null;
  durationDecimal?: number | null;
  isRunning: boolean;
}

export interface DashboardResponse {
  kpis: DashboardKpis;
  hoursPerDay: DayHoursRow[];
  hoursByProject: ProjectHoursRow[];
  recentEntries: RecentEntryRow[];
}

// ─── Imports ─────────────────────────────────────────────────────────────────

export type ImportDateFormat = "ymd" | "dmy" | "mdy";

export interface ParseImportRequest {
  file: File;
  dateFormat: ImportDateFormat;
}

export interface ImportPreviewRow {
  rowIndex: number;
  rawClientName?: string | null;
  rawProjectName?: string | null;
  rawTaskName?: string | null;
  description?: string | null;
  isBillable: boolean;
  startTime: string;
  endTime: string;
  durationDecimal: number;
  suggestedProjectId?: string | null;
  suggestedTaskId?: string | null;
  errors: string[];
}

export interface ImportParseResponse {
  importSessionId?: string | null;
  rows: ImportPreviewRow[];
  totalRows: number;
  parseErrors: string[];
  parseWarnings?: string[];
  duplicateOfImportSessionId?: string | null;
  previouslyImportedAt?: string | null;
}

export interface ImportRowRequest {
  rowIndex: number;
  startTime: string;
  endTime: string;
  description?: string | null;
  isBillable: boolean;
  projectId?: string | null;
  taskId?: string | null;
  include: boolean;
}

export interface ImportExecuteRequest {
  importSessionId: string;
  rows: ImportRowRequest[];
}

export interface ImportRowError {
  rowIndex: number;
  message: string;
}

export interface ImportExecuteResponse {
  importedCount: number;
  skippedCount: number;
  errors: ImportRowError[];
  skippedRows?: ImportRowError[];
  alreadyImported?: boolean;
}

// ─── Saved reports ───────────────────────────────────────────────────────────

export interface SavedReportDto {
  id: string;
  name: string;
  reportType: string;
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  description?: string | null;
  groupBy: PersistedReportGroupBy;
  preset?: string | null;
  createdAt: string;
  roundUp?: boolean | null;
  chartGranularity?: ChartGranularity | null;
  updatedAt: string;
}

export interface CreateSavedReportRequest {
  name: string;
  reportType: string;
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  description?: string | null;
  groupBy?: PersistedReportGroupBy;
  preset?: string | null;
  roundUp?: boolean | null;
  chartGranularity?: ChartGranularity | null;
}

export interface UpdateSavedReportRequest {
  name: string;
  reportType: string;
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  description?: string | null;
  groupBy?: PersistedReportGroupBy;
  preset?: string | null;
  roundUp?: boolean | null;
  chartGranularity?: ChartGranularity | null;
}

export interface CreateSharedReportRequest {
  name: string;
  reportType: string;
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  description?: string | null;
  groupBy?: PersistedReportGroupBy;
  expiresAt?: string | null;
  showAmounts?: boolean;
  roundUp?: boolean | null;
  chartGranularity?: ChartGranularity | null;
  /** When true, replace an existing share with the same name instead of failing with 409. */
  overwrite?: boolean;
}
