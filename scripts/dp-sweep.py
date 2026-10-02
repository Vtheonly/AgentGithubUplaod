#!/usr/bin/env python3
"""T-460 H2 (issue #3 F-19): the off-grid dp sweep over ui/features.

OWNER DECISION (received 2026-10-02): option (b) — bless on-grid literals,
sweep ONLY the off-grid values.

Standard (this script is the counter's definition):
  - A raw `N.dp` literal is OFF-GRID when N % 4 != 0.
  - Swept when: N >= 4 AND not a stroke argument AND not a corner-radius
    argument. The sub-4dp class (1/2/3dp: hairline bars, micro-dots, tight
    micro-gaps, chat-bubble tails) and the stroke class (border widths,
    divider thickness) are EXEMPT — they are not spacing rhythm.
  - Mapping: nearest multiple of 4; ties (N % 4 == 2) round UP
    (6→8, 10→12, 14→16, 22→24, 26→28, 30→32, 34→36, 38→40, 42→44, 46→48,
    86→88, 90→92, 130→132, 150→152, 170→172); the audit-pinned exception
    18→16.
  - Exempt callees (the innermost enclosing call): border, BorderStroke,
    RoundedCornerShape. Exempt named args: thickness, strokeWidth,
    topStart, topEnd, bottomStart, bottomEnd.

Modes: `--check` prints the decision table + exit code 1 if any sweepable
site remains; default applies the sweep.
"""
import pathlib, re, sys

FEAT = pathlib.Path('app/src/main/java/com/example/ui/features')
EXEMPT_CALLEES = {'border', 'BorderStroke', 'RoundedCornerShape'}
EXEMPT_ARGS = {'thickness', 'strokeWidth', 'topStart', 'topEnd', 'bottomStart', 'bottomEnd'}

DP_RE = re.compile(r'(\d+(?:\.\d+)?)\.dp\b')

def innermost_callee(text, pos):
    """The name of the innermost call whose unclosed '(' precedes pos."""
    depth = 0
    i = pos - 1
    while i >= 0:
        ch = text[i]
        if ch == ')':
            depth += 1
        elif ch == '(':
            if depth == 0:
                # identifier immediately before this '('
                j = i - 1
                while j >= 0 and (text[j].isalnum() or text[j] in '_.'):
                    j -= 1
                return text[j + 1:i]
            depth -= 1
        i -= 1
    return ''

def named_arg(text, pos):
    """The `name =` this literal is the direct value of (if any)."""
    seg = text[max(0, pos - 60):pos]
    m = re.search(r'([A-Za-z_]\w*)\s*=\s*$', seg)
    # ensure no '(' or ',' between the = and the value (it would be nested)
    return m.group(1) if m else ''

def map_value(v: float) -> int:
    if v == 18:
        return 16  # the audit-pinned exception (16 is the grid anchor)
    return int(round(v / 4)) * 4  # ties round up (Python round-half-even —
    # NOTE: v/4 for tie cases ends in .5; round() half-even rounds 2.5→2!
    # fix below.

def map_value_fixed(v: float) -> int:
    if v == 18:
        return 16
    q = v / 4.0
    import math
    return int(4 * math.floor(q + 0.5))  # floor(x+0.5) = round-half-UP

def analyze():
    decisions = []  # (file, line, value, action, reason)
    for p in sorted(FEAT.rglob('*.kt')):
        text = p.read_text()
        for m in DP_RE.finditer(text):
            v = float(m.group(1))
            if v % 4 == 0:
                continue  # on-grid
            if v < 4:
                decisions.append((p, text[:m.start()].count('\n') + 1, v, 'exempt', 'sub-4dp micro class'))
                continue
            callee = innermost_callee(text, m.start())
            if callee in EXEMPT_CALLEES:
                decisions.append((p, text[:m.start()].count('\n') + 1, v, 'exempt', f'stroke/radius arg ({callee})'))
                continue
            arg = named_arg(text, m.start())
            if arg in EXEMPT_ARGS:
                decisions.append((p, text[:m.start()].count('\n') + 1, v, 'exempt', f'stroke/radius named arg ({arg})'))
                continue
            decisions.append((p, text[:m.start()].count('\n') + 1, v, 'sweep', f'{v:g} -> {map_value_fixed(v):g}'))
    return decisions

def main():
    check = '--check' in sys.argv
    decisions = analyze()
    sweepable = [d for d in decisions if d[3] == 'sweep']
    exempt = [d for d in decisions if d[3] == 'exempt']
    print(f'off-grid total: {len(decisions)}  sweepable: {len(sweepable)}  exempt: {len(exempt)}')
    if check or '-v' in sys.argv:
        from collections import Counter
        c = Counter((d[2], d[4].split(' -> ')[0] if d[3] == "sweep" else d[4]) for d in decisions)
        for (v, note), n in sorted(c.items(), key=lambda x: (x[0][0] if isinstance(x[0][0], float) else 0)):
            pass
        vals = Counter()
        for d in sweepable:
            vals[d[4]] += 1
        for k in sorted(vals):
            print(f'  {k}: {vals[k]}')
        if '-v' in sys.argv:
            for d in exempt:
                print(f'  EXEMPT {d[0]}:{d[1]} {d[2]:g} ({d[4]})')
    if check:
        sys.exit(1 if sweepable else 0)
    # apply
    changed = {}
    for p in sorted(FEAT.rglob('*.kt')):
        text = p.read_text()
        def repl(m):
            v = float(m.group(1))
            if v % 4 == 0 or v < 4:
                return m.group(0)
            if innermost_callee(text, m.start()) in EXEMPT_CALLEES:
                return m.group(0)
            if named_arg(text, m.start()) in EXEMPT_ARGS:
                return m.group(0)
            new = map_value_fixed(v)
            return (f'{new:g}.dp')
        new_text = DP_RE.sub(repl, text)
        if new_text != text:
            changed[p] = (text.count('\n') - new_text.count('\n')) or 0
            p.write_text(new_text)
    print(f'applied across {len(changed)} files')

if __name__ == '__main__':
    main()
