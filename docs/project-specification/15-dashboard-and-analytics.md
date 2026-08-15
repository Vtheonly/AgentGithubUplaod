# 15 — Dashboard and Analytics

The Business Intelligence module: revenue metrics, departmental breakdown, demographic visualizations, debt concentration metrics, and the expandable "See Details" modal on the main Dashboard.

---

## Revenue Metrics Engine

Real-time metrics across custom date ranges (Monthly / Quarterly / Annual).

### Tracked metrics

| Metric | Description |
| :--- | :--- |
| Gross Monthly Revenue | Total collected in a month |
| Gross Annual Revenue | Total collected in a year |
| Collection Rate | % Billed vs. % Collected |
| Cumulative Outstanding Debt | Total owed to the school at a point in time |

> **Critical rule:** Only `PAID` payments count as collected revenue. Never count `PENDING` payments. A pending check might bounce; counting it as revenue inflates the numbers and misleads decision-makers.

---

## Departmental Breakdown

Granular income tracking per operational unit:

| Department | Examples |
| :--- | :--- |
| Core Academics (Scolarite) | Tuition fees |
| Therapy Services | Speech Therapy (Orthophonie), Psychology |
| Extracurricular Clubs | Chess, English, Sports |
| Auxiliary Services | Transport, Canteen |

> **Critical rule:** Never mix departmental revenue in a single "Other" bucket. Every dollar must be attributable to a specific department. An "Other" category hides revenue trends and makes it impossible to identify which departments are growing or shrinking.

---

## Demographic Visualizations

| Chart | Type | What it shows |
| :--- | :--- | :--- |
| Grade Level Distribution | Bar chart | Enrollment count per grade (1AP, 2AP, …, 3ème Année) |
| Gender Distribution | Pie chart | Male / Female / Unspecified ratio |
| Age Distribution | Histogram | Student age buckets |
| Capacity vs. Enrollment | Gauge | Enrollment as % of max capacity per class |

> **Critical rule:** Use the right chart type per metric. Never use a single chart for all demographic data — a pie chart cannot show a distribution over 15 grade levels, and a bar chart cannot show a ratio.

---

## Debt Concentration Metrics

Total institutional debt grouped by aging tiers:

| Tier | Meaning |
| :--- | :--- |
| 0–30 days | Recent debt |
| 31–60 days | Aging |
| 61–90+ days | Severely overdue |

Aging tiers are surfaced both on the Debt Dashboard (Hub 2) AND on the main analytics "See Details" modal so executives see the trend alongside other metrics.

---

## See Details Modal

An expandable modal overlaying the Dashboard (not a separate route) with 4 tabs:

| Tab | Content |
| :--- | :--- |
| **Revenue** | Monthly / Annual trends, Collection Rates |
| **Departments** | Scolarite / Therapy / Clubs / Auxiliary revenue breakdown |
| **Demographics** | Grade / Gender / Age / Capacity visualizations |
| **Debt** | Aging Tiers, Top Debtors |

The modal is a drill-down view — the Dashboard shows the top-level KPIs, and the modal lets an executive drill into any KPI for details without navigating away from the Dashboard.
