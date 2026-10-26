# TempoBase

Time tracking product. This glossary captures domain terms whose meaning is not obvious from the code alone.

## Language

### Reporting

**Granularity**:
The time bucket size used to aggregate tracked hours in a report chart — one of Day, Week, Month, or Year. Weeks start on Monday, matching the Weekly report.
_Avoid_: interval, aggregator, grouping (the last collides with "group by entity").

**Group by**:
Aggregation of report rows by an *entity* dimension (Project, Client, Task, Tag, User). Distinct from **Granularity**, which buckets by *time*.

**Period / Date range**:
The from–to window a report covers, set via presets ("this month", "last 90 days") or a custom range. Independent of **Granularity** — the same period can be viewed at Day, Month, or Year granularity.

**Saved view**:
A named, server-stored set of report filters (period, entity filters, display options) a user can reload. Carries **Granularity** as part of its persisted filters.

**Shared report**:
A **Saved view** exposed via a public token link. Same persisted filters, including **Granularity**.

## Relationships

- A **Report** is rendered over one **Period** at one **Granularity**.
- **Granularity** only affects the Summary bar chart; the Distribution donut and the hierarchical table remain month-based.
- A **Saved view** and a **Shared report** each persist one **Granularity** value (default: Month).

## Flagged ambiguities

- "aggregator" (user's word) was used for time bucketing — resolved to **Granularity**, kept distinct from entity-level **Group by**.
