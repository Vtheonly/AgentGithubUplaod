# 03 — UI and UX Design

The El-Imtiyaz platform uses a **dark-first** visual identity with a single shared color-token palette across all three frontends. The design philosophy prioritizes high-contrast readability, numeric precision via monospace fonts, and consistent status-color mapping.

---

## Color Palette and Design Tokens

All colors are exposed as CSS variables. **Never hard-code hex strings in components** — always reference the token (e.g. `var(--color-primary-blue)`).

| Token | Hex | Use |
| :--- | :--- | :--- |
| Primary Blue | `#349BD4` | Primary buttons, active nav |
| Deep Blue | `#2B7FB0` | Hover / pressed states |
| Light Blue / Cyan Glow | `#6EC1E4` | Highlights, focus rings, `LATE` status |
| Slate Gray | `#3B464C` | Secondary text, dividers |
| Warm Gold Accent | `#C8A98C` | Highlights, KPIs, badges, `PENDING` status |
| Muted Brown | `#836C68` | Tertiary accents |
| Dark Background | `#242526` | App background |
| Panel Background | `#1E1F20` | Cards, sidebars |
| Elevated Surface | `#2A2B2D` | Modals, popovers |
| Off-White Text | `#EFF2F3` | Primary text |
| Success Green | `#3FA66E` | `PAID`, `PRESENT`, confirmed |
| Warning Gold | `#C8A98C` | `PENDING`, partial balance |
| Danger Red | `#C0504D` | `UNPAID`, `ABSENT`, errors |

### Status → color mapping

| Status | Color |
| :--- | :--- |
| `PAID` / `PRESENT` | Success Green |
| `UNPAID` / `ABSENT` | Danger Red |
| `PENDING` / `EXCUSED` | Warning Gold |
| `LATE` | Light Blue |

---

## Typography and Visual Identity

| Role | Font | Fallback |
| :--- | :--- | :--- |
| Primary text (Latin) | `Inter` | system sans-serif |
| Arabic script | `Noto Sans Arabic` | `Inter` |
| Monospace (IDs, currency, audit JSON diffs) | `JetBrains Mono` | `Consolas` |

**Philosophy:** dark-first, high-contrast (off-white `#EFF2F3` on `#1E1F20`), numeric precision via monospace. Currency amounts, receipt numbers, student codes, and audit `before_json`/`after_json` diffs always render in `JetBrains Mono` so digit alignment is preserved.

---

## Desktop UI Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Topbar: Global Search (Cmd+K) │ Alerts │ Backup │ Profile  │
├──────────┬──────────────────────────────────────────────────┤
│          │  Tabbed Workspace                                 │
│ Permanent│  ┌──────────────────────────────────────────────┐ │
│ Sidebar  │  │ Tab 1 │ Tab 2 │ Tab 3 │ …                   │ │
│          │  ├──────────────────────────────────────────────┤ │
│ 4 Hubs   │  │                                              │ │
│ + Settings│ │  Workspace Canvas                            │ │
│          │  │  (data grids, split-views, modals)           │ │
│          │  │                                              │ │
│          │  └──────────────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────────┘
```

- **Permanent left sidebar** — the 4 Hubs + System Settings.
- **Topbar** — Global Search (Cmd+K), Alerts, Quick Backup, Profile.
- **Tabbed Workspace** — each tab retains its own scroll position and filter state. Users can open multiple contexts side by side.
- **Workspace Canvas** — data grids, split-views, and modals.

**Master-detail split-view:** 35% master (list) / 65% detail (selected record). This applies to parent lists, student lists, payment ledgers, and audit logs.

**Modal policy:** Multi-step committed actions (e.g. batch registration, payment collection, expense submission) open as large centered modals. Do not open every action in a new modal — reserve modals for committed multi-step workflows. Simple views (read-only detail, single-field edits) stay inline.

---

## Mobile UI Architecture (Staff Android App)

```
┌─────────────────────────────────────┐
│  Top App Bar                        │
│  Title │ Search │ Sync │ Profile    │
├─────────────────────────────────────┤
│                                     │
│  Vertical Card Feed                 │
│  ┌───────────────────────────────┐  │
│  │ Card 1 (color-coded pill)     │  │
│  ├───────────────────────────────┤  │
│  │ Card 2 (color-coded pill)     │  │
│  ├───────────────────────────────┤  │
│  │ Card 3 …                      │  │
│  └───────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│  ─ FAB (New Payment / Attendance) ─ │
├─────────────────────────────────────┤
│  Home │ CRM │ Academics │ Fin │ HR  │  ← 5-tab bottom nav
└─────────────────────────────────────┘
```

- **Top App Bar** — Title, Search, Sync Status, Profile.
- **Vertical Card Feed** — one record per card, color-coded status pills, 48dp × 48dp minimum touch targets.
- **Floating Action Button (FAB)** — context-sensitive primary action (New Payment on Financials tab, Take Attendance on Academics tab).
- **5-tab Bottom Navigation** — Home/Dashboard, CRM/Roster, Academics, Financials, Personnel/Staff.
- **Bottom sheet drawers** slide up for detail views (parent profile, student profile, payment detail).

> **Critical rule:** Never port desktop tables directly to mobile. Convert every desktop table into a vertical card feed — one record per card. Desktop tables are unreadable on a phone screen.

---

## The 4 Consolidated Desktop Hubs

The Desktop sidebar exposes 4 Hubs. Each Hub loads a secondary tab bar; each tab keeps its own scroll position and filter state.

| Hub | Name | Primary audience | Tabs |
| :--- | :--- | :--- | :--- |
| **Hub 1** | Dashboard | Super Admin, Financial Officer | Main Overview, Notifications, Reports, Analytics |
| **Hub 2** | Financial Portal | Financial Officer | Payments, Receipts, Debt Dashboard, Installments |
| **Hub 3** | Relationship Portal | Admin, Receptionist | Parents & Students (unified), 1→N Batch Creation |
| **Hub 4** | Academic Management | Admin, Teacher | Scolarite Levels, Clubs, Subject Mapping |

**Settings** is a separate sidebar entry, **not** a fifth Hub. It contains RBAC matrix configuration, AI provider keys (BYOK), backup configuration, audit log viewer, and system preferences.

---

## Color Token Discipline

1. Always reference CSS variables (e.g. `var(--color-primary-blue)`).
2. Never hard-code hex strings (e.g. `#349BD4`) in components.
3. When porting a color from a design tool (Figma, Sketch), add it to the token file first, then reference the token.
4. Status colors are semantic — use the status name (e.g. `var(--status-success)`) rather than the raw color token when mapping a domain status to a color. This lets the status palette change without touching every component.

Centralizing tokens means a theme change (e.g. adding a light mode) only requires editing the token file, not grep-and-replacing hex strings across hundreds of components.
