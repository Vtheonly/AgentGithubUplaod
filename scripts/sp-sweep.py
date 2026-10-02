#!/usr/bin/env python3
"""T-460 H2 (issue #3 F-19): the raw fontSize = N.sp sweep over ui/features.

Maps every raw sp literal to the named DS text styles:
  9sp  -> ElTheme.textStyles.chartMicro (NEW — the densest chart tier)
  10sp -> ElTheme.textStyles.badge (+ explicit weight where the base had one)
  11sp -> ElTheme.typography.labelSmall (its native size)
  12sp -> the 12sp styles (labelMedium / bodySmall)
  13sp -> numericSmall (amounts) / labelLarge (action labels)
  14sp -> titleSmall / labelLarge (their native size)
  15sp -> titleMedium (name rows) / numericSmall (stat values)
  16sp -> titleMedium / bodyLarge
  22sp -> titleLarge
  32sp -> headlineLarge
Preserves every fontWeight / color / letterSpacing override via .copy().
"""
import pathlib, re, sys

FEAT = pathlib.Path('app/src/main/java/com/example/ui/features')

# (file, old, new) — exact-string replacements, each must occur exactly once.
EDITS = [
    # ── RollCallScreen ──────────────────────────────────────────────
    ('academics/RollCallScreen.kt',
     '''style = ElTheme.typography.titleMedium.copy(
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 15.sp,
                                        ),''',
     'style = ElTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),'),
    ('academics/RollCallScreen.kt',
     '''style = ElTheme.typography.labelSmall.copy(
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 11.sp,
                                        ),''',
     'style = ElTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),'),
    ('academics/RollCallScreen.kt',
     '''style = ElTheme.typography.labelSmall.copy(
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                fontSize = 12.sp,
            ),''',
     '''style = ElTheme.typography.labelMedium.copy(
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
            ),'''),
    # ── LoginScreen ─────────────────────────────────────────────────
    ('auth/LoginScreen.kt',
     '''style = ElTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 32.sp,
                        ),''',
     'style = ElTheme.typography.headlineLarge.copy(fontWeight = FontWeight.Bold),'),
    # ── DashboardCollectionAndDebtRow ───────────────────────────────
    ('dashboard/DashboardCollectionAndDebtRow.kt',
     'Text(pct, style = ElTheme.typography.labelSmall.copy(fontSize = 10.sp), color = color)',
     'Text(pct, style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.SemiBold), color = color)'),
    # ── DashboardKpiCardsRow ────────────────────────────────────────
    ('dashboard/DashboardKpiCardsRow.kt',
     '''style = ElTheme.textStyles.numeric.copy(
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Black,
                ),''',
     'style = ElTheme.typography.titleLarge.copy(fontWeight = FontWeight.Black),'),
    # ── DashboardRevenueChart ───────────────────────────────────────
    ('dashboard/DashboardRevenueChart.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp, fontWeight = FontWeight.Bold),',
     'style = ElTheme.textStyles.chartMicro.copy(fontWeight = FontWeight.Bold),'),
    ('dashboard/DashboardRevenueChart.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp),',
     'style = ElTheme.textStyles.chartMicro,'),
    # ── AnalyticsSlicersBar ─────────────────────────────────────────
    ('dashboard/analytics/AnalyticsSlicersBar.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 10.sp),',
     'style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.SemiBold),'),
    ('dashboard/analytics/AnalyticsSlicersBar.kt',
     'style = ElTheme.typography.labelMedium.copy(fontSize = 11.sp),',
     'style = ElTheme.typography.labelSmall,'),
    # ── AnalyticsStatStrip ──────────────────────────────────────────
    ('dashboard/analytics/AnalyticsStatStrip.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp, letterSpacing = 0.5.sp),',
     'style = ElTheme.textStyles.chartMicro.copy(letterSpacing = 0.5.sp),'),
    ('dashboard/analytics/AnalyticsStatStrip.kt',
     'style = ElTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, fontSize = 15.sp),',
     'style = ElTheme.textStyles.numericSmall,'),
    ('dashboard/analytics/AnalyticsStatStrip.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp),',
     'style = ElTheme.textStyles.chartMicro,'),
    # ── DebtorsParetoCard ───────────────────────────────────────────
    ('dashboard/analytics/DebtorsParetoCard.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 10.sp),',
     'style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.SemiBold),'),
    ('dashboard/analytics/DebtorsParetoCard.kt',
     'style = ElTheme.typography.labelMedium.copy(fontSize = 12.sp, fontWeight = FontWeight.Medium),',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),'),
    ('dashboard/analytics/DebtorsParetoCard.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp),',
     'style = ElTheme.textStyles.chartMicro,'),
    # ── ExecutiveCards ──────────────────────────────────────────────
    ('dashboard/analytics/ExecutiveCards.kt',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp),',
     'style = ElTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),'),
    ('dashboard/analytics/ExecutiveCards.kt',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 11.sp),',
     'style = ElTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),'),
    ('dashboard/analytics/ExecutiveCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 10.sp),',
     'style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.SemiBold),'),
    ('dashboard/analytics/ExecutiveCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp),',
     'style = ElTheme.textStyles.chartMicro,'),
    ('dashboard/analytics/ExecutiveCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 9.sp),',
     'style = ElTheme.textStyles.chartMicro.copy(fontWeight = FontWeight.SemiBold),'),
    # ── HeatmapAndAgingCards ────────────────────────────────────────
    ('dashboard/analytics/HeatmapAndAgingCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium),',
     'style = ElTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),'),
    ('dashboard/analytics/HeatmapAndAgingCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 11.sp),',
     'style = ElTheme.typography.labelSmall,'),
    # ── MixCards ────────────────────────────────────────────────────
    ('dashboard/analytics/MixCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium),',
     'style = ElTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),'),
    ('dashboard/analytics/MixCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 11.sp),',
     'style = ElTheme.typography.labelSmall,'),
    ('dashboard/analytics/MixCards.kt',
     '''style = ElTheme.typography.labelSmall.copy(
            fontSize = 10.sp,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        ),''',
     '''style = ElTheme.textStyles.badge.copy(
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        ),'''),
    # ── WeeklyOperatingRhythmCard ───────────────────────────────────
    ('dashboard/analytics/WeeklyOperatingRhythmCard.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 10.sp),',
     'style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.SemiBold),'),
    ('dashboard/analytics/WeeklyOperatingRhythmCard.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 10.sp, fontWeight = FontWeight.Medium),',
     'style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.Medium),'),
    # ── YoYAndHistogramCards ────────────────────────────────────────
    ('dashboard/analytics/YoYAndHistogramCards.kt',
     'style = ElTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, fontSize = 16.sp),',
     'style = ElTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),'),
    ('dashboard/analytics/YoYAndHistogramCards.kt',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 12.sp),',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),'),
    ('dashboard/analytics/YoYAndHistogramCards.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp, letterSpacing = 0.4.sp),',
     'style = ElTheme.textStyles.chartMicro.copy(letterSpacing = 0.4.sp),'),
    # ── TrancheWaveCard ─────────────────────────────────────────────
    ('financials/TrancheWaveCard.kt',
     '''style = ElTheme.typography.labelMedium.copy(
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 12.sp,
                                ),''',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),'),
    ('financials/TrancheWaveCard.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 9.sp),',
     'style = ElTheme.textStyles.chartMicro,'),
    ('financials/TrancheWaveCard.kt',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold, fontSize = 13.sp),',
     'style = ElTheme.textStyles.numericSmall,'),
    ('financials/TrancheWaveCard.kt',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 12.sp),',
     'style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),'),
    # ── AuditStreamScreen ───────────────────────────────────────────
    ('personnel/AuditStreamScreen.kt',
     '''style = ElTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.SemiBold,
                                    color = c.primary,
                                    fontSize = 14.sp,
                                ),''',
     'style = ElTheme.typography.titleSmall.copy(color = c.primary),'),
    # ── EmployeeDirectoryScreen ─────────────────────────────────────
    ('personnel/EmployeeDirectoryScreen.kt',
     '''style = ElTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 15.sp,
                            ),''',
     'style = ElTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),'),
    # ── ReleveScreen ────────────────────────────────────────────────
    ('personnel/ReleveScreen.kt',
     'style = ElTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp),',
     'style = ElTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),'),
    ('personnel/ReleveScreen.kt',
     '''style = ElTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                ),''',
     'style = ElTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),'),
    # ── TeacherWorkspaceScreen ──────────────────────────────────────
    ('personnel/TeacherWorkspaceScreen.kt',
     '''Text(
                                        cls.name,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 16.sp,
                                        color = c.textPrimary,
                                    )''',
     '''Text(
                                        cls.name,
                                        style = ElTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold),
                                        color = c.textPrimary,
                                    )'''),
    ('personnel/TeacherWorkspaceScreen.kt',
     '''Text(
                                    "Salle : ${cls.room ?: "—"} · ${cls.enrolledCount} élèves · ${cls.academicYear}",
                                    fontSize = 12.sp,
                                    color = c.textSecondary,
                                )''',
     '''Text(
                                    "Salle : ${cls.room ?: "—"} · ${cls.enrolledCount} élèves · ${cls.academicYear}",
                                    style = ElTheme.typography.bodySmall,
                                    color = c.textSecondary,
                                )'''),
    # ── AuditDiffSheet ──────────────────────────────────────────────
    ('settings/AuditDiffSheet.kt',
     '''Text(
                        if (showRaw) "▾" else "▸",
                        fontSize = 12.sp,
                        color = c.primary,
                    )''',
     '''Text(
                        if (showRaw) "▾" else "▸",
                        style = ElTheme.typography.labelMedium,
                        color = c.primary,
                    )'''),
    ('settings/AuditDiffSheet.kt',
     '''style = ElTheme.typography.labelSmall.copy(
                fontSize = 10.sp,
                color = c.textSecondary,
            ),''',
     'style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.SemiBold, color = c.textSecondary),'),
    ('settings/AuditDiffSheet.kt',
     '''style = ElTheme.typography.labelSmall.copy(
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.4.sp,
        ),''',
     '''style = ElTheme.textStyles.badge.copy(
            letterSpacing = 0.4.sp,
        ),'''),
    ('settings/AuditDiffSheet.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 11.sp),',
     'style = ElTheme.typography.labelSmall,'),
    ('settings/AuditDiffSheet.kt',
     '''style = ElTheme.typography.labelSmall.copy(
                        fontSize = 9.sp,
                        color = c.textSecondary.copy(alpha = 0.7f),
                    ),''',
     'style = ElTheme.textStyles.chartMicro.copy(color = c.textSecondary.copy(alpha = 0.7f)),'),
    ('settings/AuditDiffSheet.kt',
     '''style = ElTheme.typography.labelSmall.copy(
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Medium,
                    color = accent,
                ),''',
     'style = ElTheme.textStyles.chartMicro.copy(fontWeight = FontWeight.Medium, color = accent),'),
    ('settings/AuditDiffSheet.kt',
     '''style = ElTheme.typography.labelSmall.copy(
                fontSize = 11.sp,
                color = color,
                fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
                textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
            ),''',
     '''style = ElTheme.typography.labelSmall.copy(
                color = color,
                fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
                textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
            ),'''),
    ('settings/AuditDiffSheet.kt',
     'style = ElTheme.typography.labelSmall.copy(fontSize = 10.sp),',
     'style = ElTheme.textStyles.badge.copy(fontWeight = FontWeight.SemiBold),'),
    # ── AuditLogScreen ──────────────────────────────────────────────
    ('settings/AuditLogScreen.kt',
     'Text(log.action, style = ElTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, color = c.primary, fontSize = 13.sp), modifier = Modifier.weight(1f))',
     'Text(log.action, style = ElTheme.typography.labelLarge.copy(color = c.primary), modifier = Modifier.weight(1f))'),
]

def main():
    by_file = {}
    for f, old, new in EDITS:
        by_file.setdefault(f, []).append((old, new))
    total = 0
    for fname, edits in by_file.items():
        p = FEAT / fname
        t = p.read_text()
        for old, new in edits:
            n = t.count(old)
            if n == 0:
                print(f'MISS  {fname}: {old[:60]!r}')
                sys.exit(1)
            # occurrences may repeat identically within a file — replace all
            t = t.replace(old, new)
            total += n
            if n > 1:
                print(f'  note: {n} identical sites in {fname}')
        # prune now-unused sp imports
        if not re.search(r'\d\.sp', t):
            t = t.replace('import androidx.compose.ui.unit.sp\n', '')
        p.write_text(t)
    print(f'applied {total} sp-site replacements across {len(by_file)} files')

if __name__ == '__main__':
    main()
