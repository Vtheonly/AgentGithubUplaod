#!/usr/bin/env python3
"""
Excel Deep Inspection & Reverse-Engineering Engine
=================================================
Performs deep structural, logical, formulaic, and semantic inspection
of Excel workbooks (.xlsx, .xlsm) to prepare for generic ingestion architectures.

Features:
- Dual-pass inspection: Raw formulas (AST/templates) + Evaluated values/errors
- Exact formula extraction & normalized pattern detection (row-invariant clustering)
- Cross-sheet & external workbook reference extraction
- Detection of Excel formula errors (#REF!, #NAME?, #VALUE!, #DIV/0!)
- Merged cells, hidden rows/cols/sheets, freeze panes, tables, validations
- Sheet archetype inference: Flat Master Table vs Repeated Form Blocks vs Dashboard
- Semantic column classification (Identifiers, Names, Contacts, Academics, Financials)
- Cross-workbook structural and formulaic comparison
- Emits comprehensive JSON and human-readable Markdown reports
"""

import os
import sys
import re
import json
import glob
import datetime
import argparse
from collections import defaultdict, Counter
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional, Set

import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string
from openpyxl.worksheet.worksheet import Worksheet


# ==============================================================================
# CONSTANTS & PATTERNS
# ==============================================================================

EXCEL_ERRORS = {"#REF!", "#NAME?", "#VALUE!", "#DIV/0!", "#N/A", "#NULL!", "#NUM!"}

CURRENCY_KEYWORDS = {"dzd", "da", "$", "€", "£", "dinars", "dinar"}
FINANCIAL_KEYWORDS = {
    "montant", "devis", "frais", "remise", "reduction", "scolarisation", 
    "versement", "versements", "total", "creance", "dette", "solde", 
    "remboursement", "reglement", "reglements", "tranche", "1t", "t2", "t3", "v1", "v2", "v3", "fi"
}
ACADEMIC_KEYWORDS = {"classe", "niveau", "option", "section", "cycle", "annee"}
STUDENT_KEYWORDS = {"eleve", "nom", "prenom", "nom et prenom", "etudiant"}
PARENT_KEYWORDS = {"tuteur", "parent", "pere", "mere", "responsable"}
CONTACT_KEYWORDS = {"tel", "telephone", "phone", "nem", "email", "e-mail", "adresse"}
TRANSPORT_KEYWORDS = {"trnsp", "transport", "destination", "distination", "arret", "ligne"}

FORMULA_REF_REGEX = re.compile(r"(?:'([^']+)'|([A-Za-z0-9_]+))!(\$?[A-Z]+\$?[0-9]+(?::\$?[A-Z]+\$?[0-9]+)?)")
EXTERNAL_REF_REGEX = re.compile(r"\[([^\]]+)\](?:'([^']+)'|([A-Za-z0-9_]+))?!(\$?[A-Z]+\$?[0-9]+)")
CELL_COORD_REGEX = re.compile(r"(\$?[A-Z]{1,3}\$?)(\d+)")


# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

def json_serial(obj):
    """JSON serializer for objects not serializable by default."""
    if isinstance(obj, (datetime.datetime, datetime.date, datetime.time)):
        return obj.isoformat()
    if isinstance(obj, set):
        return list(obj)
    return str(obj)


def normalize_formula_pattern(formula_str: str, current_row: int) -> str:
    """
    Normalizes a formula by replacing cell references on the same row with {row},
    enabling pattern deduplication across tabular rows.
    e.g. '=L2-M2' in row 2 becomes '=L{row}-M{row}'
    """
    if not formula_str or not formula_str.startswith("="):
        return formula_str

    def replace_coord(match):
        col_part = match.group(1)
        row_num = int(match.group(2))
        diff = row_num - current_row
        if diff == 0:
            return f"{col_part}{{row}}"
        elif diff > 0:
            return f"{col_part}{{row+{diff}}}"
        else:
            return f"{col_part}{{row{diff}}}"

    return CELL_COORD_REGEX.sub(replace_coord, formula_str)


def detect_number_format_category(code: Optional[str]) -> str:
    """Categorizes an Excel number_format string."""
    if not code or code.lower() in ("general", ""):
        return "GENERAL"
    code_lower = code.lower()
    if any(k in code_lower for k in CURRENCY_KEYWORDS):
        return "CURRENCY"
    if any(k in code_lower for k in ("yy", "mm", "dd", "m/", "/d")):
        return "DATE"
    if "%" in code:
        return "PERCENTAGE"
    if any(k in code for k in ("0.0", "#,##0", "0")):
        return "NUMERIC"
    return "CUSTOM"


def classify_column_semantics(col_name: str, sample_values: List[Any]) -> str:
    """Infers the business role of a column based on header text and samples."""
    name_clean = re.sub(r"[^a-z0-9]", "", str(col_name).lower())
    
    if any(k in name_clean for k in CONTACT_KEYWORDS):
        return "CONTACT_INFO"
    if any(k in name_clean for k in STUDENT_KEYWORDS):
        return "STUDENT_IDENTITY"
    if any(k in name_clean for k in PARENT_KEYWORDS):
        return "PARENT_TUTEUR"
    if any(k in name_clean for k in TRANSPORT_KEYWORDS):
        return "TRANSPORT_SERVICE"
    if any(k in name_clean for k in ACADEMIC_KEYWORDS):
        return "ACADEMIC_LEVEL"
    if any(k in name_clean for k in FINANCIAL_KEYWORDS):
        return "FINANCIAL_AMOUNT"

    # Inspect sample values if header is ambiguous or generic
    str_samples = [str(s).strip() for s in sample_values if s is not None and str(s).strip()]
    if str_samples:
        phone_match_ratio = sum(1 for s in str_samples if re.search(r"(\+?213|0[567])[0-9]{8}", s)) / len(str_samples)
        if phone_match_ratio > 0.4:
            return "CONTACT_PHONE"

    return "GENERIC_DATA"


# ==============================================================================
# WORKBOOK INSPECTOR
# ==============================================================================

class WorkbookDeepInspector:
    def __init__(self, file_path: str):
        self.file_path = file_path
        self.file_name = os.path.basename(file_path)
        self.wb_raw = None
        self.wb_val = None

    def inspect(self) -> Dict[str, Any]:
        print(f"\n[*] Starting deep inspection of: {self.file_name}")
        report: Dict[str, Any] = {
            "file_name": self.file_name,
            "file_path": os.path.abspath(self.file_path),
            "file_size_bytes": os.path.getsize(self.file_path),
            "inspected_at": datetime.datetime.utcnow().isoformat(),
            "metadata": {},
            "defined_names": [],
            "sheets_overview": [],
            "sheets": {},
        }

        # 1. Dual-Pass Loading
        try:
            print("    -> Pass 1: Loading raw formulas & formatting...")
            self.wb_raw = openpyxl.load_workbook(self.file_path, data_only=False, keep_vba=True)
            print("    -> Pass 2: Loading calculated values & runtime error states...")
            self.wb_val = openpyxl.load_workbook(self.file_path, data_only=True, keep_vba=True)
        except Exception as e:
            print(f"    [!] Error loading workbook {self.file_name}: {e}")
            report["load_error"] = str(e)
            return report

        # 2. Extract Document Metadata
        props = self.wb_raw.properties
        report["metadata"] = {
            "title": props.title,
            "creator": props.creator,
            "last_modified_by": props.lastModifiedBy,
            "created": props.created,
            "modified": props.modified,
            "sheet_count": len(self.wb_raw.sheetnames),
        }

        # 3. Defined Names (Named Ranges)
        for name, defn in self.wb_raw.defined_names.items():
            report["defined_names"].append({
                "name": name,
                "destinations": [f"{sheet}!{coord}" for sheet, coord in defn.destinations] if hasattr(defn, "destinations") else str(defn.value)
            })

        # 4. Sheet Level Iteration
        for sheetname in self.wb_raw.sheetnames:
            ws_raw = self.wb_raw[sheetname]
            ws_val = self.wb_val[sheetname] if sheetname in self.wb_val.sheetnames else None
            
            sheet_report = self._inspect_sheet(ws_raw, ws_val)
            report["sheets"][sheetname] = sheet_report
            
            report["sheets_overview"].append({
                "sheet_name": sheetname,
                "state": ws_raw.sheet_state,
                "archetype": sheet_report["archetype"],
                "dimensions": sheet_report["dimensions"]["actual_used_range"],
                "row_count": sheet_report["dimensions"]["actual_row_count"],
                "col_count": sheet_report["dimensions"]["actual_col_count"],
                "formula_count": sheet_report["statistics"]["formula_cells"],
                "error_count": sheet_report["statistics"]["error_cells"],
            })

        return report

    def _inspect_sheet(self, ws_raw: Worksheet, ws_val: Optional[Worksheet]) -> Dict[str, Any]:
        sheetname = ws_raw.title
        print(f"    -> Inspecting Sheet: {sheetname}")

        # Compute true used bounding box (ignoring infinite trailing empty cells)
        min_r, max_r, min_c, max_c = 1, 0, 1, 0
        actual_rows = 0
        
        # Scan cells to calculate true used boundaries
        occupied_coords: Set[Tuple[int, int]] = set()
        for r in range(1, min(ws_raw.max_row or 1, 10000) + 1):
            row_has_data = False
            for c in range(1, min(ws_raw.max_column or 1, 200) + 1):
                val_raw = ws_raw.cell(row=r, column=c).value
                val_val = ws_val.cell(row=r, column=c).value if ws_val else None
                if val_raw is not None or val_val is not None:
                    row_has_data = True
                    occupied_coords.add((r, c))
                    if c > max_c: max_c = c
            if row_has_data:
                actual_rows += 1
                if r > max_r: max_r = r

        if max_r == 0:
            max_r = 1
        if max_c == 0:
            max_c = 1

        used_range_str = f"A1:{get_column_letter(max_c)}{max_r}"

        # Layout, Panes, Merged cells, Dimensions
        merged_ranges = [str(m) for m in ws_raw.merged_cells.ranges]
        freeze_panes = str(ws_raw.freeze_panes) if ws_raw.freeze_panes else None

        hidden_rows = [r for r, dim in ws_raw.row_dimensions.items() if dim.hidden]
        hidden_cols = [col_letter for col_letter, dim in ws_raw.column_dimensions.items() if dim.hidden]

        # Scan and Profile Cells
        stat_types = Counter()
        format_categories = Counter()
        excel_errors_found = defaultdict(list)
        formulas_raw: Dict[str, str] = {}
        formula_patterns = defaultdict(list)
        cross_sheet_refs = defaultdict(set)
        external_refs = defaultdict(set)
        
        column_samples = defaultdict(list)
        column_values_set = defaultdict(set)
        column_types = defaultdict(Counter)

        for r in range(1, max_r + 1):
            for c in range(1, max_c + 1):
                cell_raw = ws_raw.cell(row=r, column=c)
                cell_val = ws_val.cell(row=r, column=c) if ws_val else cell_raw
                coord = f"{get_column_letter(c)}{r}"
                val_raw = cell_raw.value
                val_calc = cell_val.value

                # Format analysis
                num_fmt = cell_raw.number_format
                fmt_cat = detect_number_format_category(num_fmt)
                format_categories[fmt_cat] += 1

                # Cell Type & Content Analysis
                if val_raw is None and val_calc is None:
                    stat_types["empty"] += 1
                    continue

                # Error Detection (Pass 2 captures evaluated error strings)
                calc_str = str(val_calc).strip() if val_calc is not None else ""
                raw_str = str(val_raw).strip() if val_raw is not None else ""

                for err in EXCEL_ERRORS:
                    if err == calc_str or err in raw_str:
                        excel_errors_found[err].append({
                            "cell": coord,
                            "raw_formula": raw_str if str(raw_str).startswith("=") else None,
                            "evaluated_value": calc_str
                        })
                        stat_types["error"] += 1
                        break

                # Formula Extraction & Pattern Normalization
                if str(val_raw).startswith("="):
                    stat_types["formula"] += 1
                    formula_str = str(val_raw)
                    formulas_raw[coord] = formula_str

                    # Check for cross-sheet references
                    for match in FORMULA_REF_REGEX.finditer(formula_str):
                        ref_sheet = match.group(1) or match.group(2)
                        target_range = match.group(3)
                        cross_sheet_refs[ref_sheet].add(target_range)

                    # Check for external file references
                    for ext_match in EXTERNAL_REF_REGEX.finditer(formula_str):
                        ext_file = ext_match.group(1)
                        target_cell = ext_match.group(4)
                        external_refs[ext_file].add(target_cell)

                    # Normalize row-shifted formula templates
                    pattern = normalize_formula_pattern(formula_str, r)
                    col_letter = get_column_letter(c)
                    formula_patterns[(col_letter, pattern)].append(r)
                else:
                    # Data cell typing
                    if isinstance(val_calc, (int, float)):
                        stat_types["numeric"] += 1
                        column_types[c]["numeric"] += 1
                    elif isinstance(val_calc, (datetime.date, datetime.datetime)):
                        stat_types["date"] += 1
                        column_types[c]["date"] += 1
                    elif isinstance(val_calc, bool):
                        stat_types["boolean"] += 1
                        column_types[c]["boolean"] += 1
                    else:
                        stat_types["text"] += 1
                        column_types[c]["text"] += 1

                # Collect profiling data for column definition
                if val_calc is not None:
                    column_values_set[c].add(str(val_calc).strip())
                    if len(column_samples[c]) < 5 and str(val_calc).strip() not in column_samples[c]:
                        column_samples[c].append(str(val_calc).strip())

        # 5. Header Detection & Column Profiling
        candidate_headers, header_row_idx = self._detect_header_row(ws_raw, max_r, max_c)
        
        columns_profile = []
        for c in range(1, max_c + 1):
            col_letter = get_column_letter(c)
            header_name = candidate_headers.get(c, f"COL_{col_letter}")
            primary_type = column_types[c].most_common(1)[0][0] if column_types[c] else "EMPTY"
            samples = column_samples[c]
            semantics = classify_column_semantics(header_name, samples)

            columns_profile.append({
                "column_index": c,
                "column_letter": col_letter,
                "header_name": header_name,
                "inferred_semantic_role": semantics,
                "predominant_type": primary_type,
                "unique_values_count": len(column_values_set[c]),
                "sample_values": samples,
            })

        # 6. Sheet Archetype Inference
        archetype = self._infer_sheet_archetype(
            sheetname=sheetname,
            max_r=max_r,
            max_c=max_c,
            actual_rows=actual_rows,
            header_row_idx=header_row_idx,
            formulas_count=len(formulas_raw),
            merged_count=len(merged_ranges)
        )

        # 7. Aggregate Formula Patterns
        summarized_patterns = []
        for (col_letter, pattern_tmpl), rows in formula_patterns.items():
            summarized_patterns.append({
                "target_column": col_letter,
                "pattern_template": pattern_tmpl,
                "occurrences": len(rows),
                "row_range": f"{min(rows)}..{max(rows)}" if rows else "",
                "sample_original_formula": ws_raw.cell(row=rows[0], column=column_index_from_string(col_letter)).value
            })
        summarized_patterns.sort(key=lambda x: x["occurrences"], reverse=True)

        return {
            "sheet_name": sheetname,
            "sheet_state": ws_raw.sheet_state,
            "archetype": archetype,
            "dimensions": {
                "max_row_reported": ws_raw.max_row,
                "max_col_reported": ws_raw.max_column,
                "actual_row_count": actual_rows,
                "actual_col_count": max_c,
                "actual_used_range": used_range_str
            },
            "layout": {
                "freeze_panes": freeze_panes,
                "merged_cells_count": len(merged_ranges),
                "merged_ranges": merged_ranges[:50],  # cap at 50 to avoid blowing up JSON
                "hidden_rows": hidden_rows,
                "hidden_columns": hidden_cols,
                "has_tables": len(ws_raw.tables) > 0,
                "table_names": [t.name for t in ws_raw.tables.values()] if hasattr(ws_raw, "tables") else []
            },
            "statistics": {
                "total_used_cells": len(occupied_coords),
                "text_cells": stat_types["text"],
                "numeric_cells": stat_types["numeric"],
                "date_cells": stat_types["date"],
                "formula_cells": stat_types["formula"],
                "empty_cells": stat_types["empty"],
                "error_cells": stat_types["error"],
                "format_categories": dict(format_categories)
            },
            "detected_header_row_index": header_row_idx,
            "columns": columns_profile,
            "excel_errors": {k: len(v) for k, v in excel_errors_found.items()},
            "excel_errors_details": {k: v[:20] for k, v in excel_errors_found.items()},
            "formula_patterns": summarized_patterns,
            "cross_sheet_references": {k: list(v) for k, v in cross_sheet_refs.items()},
            "external_references": {k: list(v) for k, v in external_refs.items()},
            "sample_individual_formulas": [
                {"cell": coord, "formula": formula}
                for coord, formula in list(formulas_raw.items())[:30]
            ]
        }

    def _detect_header_row(self, ws: Worksheet, max_r: int, max_c: int) -> Tuple[Dict[int, str], int]:
        """Detects the most probable header row by scoring text density and uniqueness."""
        best_row = 1
        best_score = -1
        best_headers: Dict[int, str] = {}

        # Look in the first 15 rows
        for r in range(1, min(max_r, 15) + 1):
            text_cells = 0
            unique_vals = set()
            headers = {}
            for c in range(1, max_c + 1):
                val = ws.cell(row=r, column=c).value
                if val is not None and str(val).strip():
                    v_str = str(val).strip()
                    if not v_str.startswith("="):
                        text_cells += 1
                        unique_vals.add(v_str.lower())
                        headers[c] = v_str

            # Score based on number of populated text columns and uniqueness
            score = text_cells * 2 + len(unique_vals)
            if score > best_score and text_cells >= 2:
                best_score = score
                best_row = r
                best_headers = headers

        return best_headers, best_row

    def _infer_sheet_archetype(
        self,
        sheetname: str,
        max_r: int,
        max_c: int,
        actual_rows: int,
        header_row_idx: int,
        formulas_count: int,
        merged_count: int
    ) -> str:
        """Infers the structural archetype of the worksheet."""
        name_lower = sheetname.lower()
        if "ref" in name_lower or "param" in name_lower or "liste" in name_lower:
            return "LOOKUP_REFERENCE_TABLE"
        if "stat" in name_lower or "tableau" in name_lower or "bord" in name_lower:
            return "ANALYTICAL_DASHBOARD_MATRIX"
        if "devis" in name_lower or "bon" in name_lower or "facture" in name_lower:
            return "REPEATING_DOCUMENT_BLOCKS"
        if actual_rows > 20 and max_c > 5 and header_row_idx <= 3:
            return "FLAT_TABULAR_MASTER"
        if merged_count > 15:
            return "COMPLEX_FORMATTED_FORM"
        return "GENERIC_SPREADSHEET"


# ==============================================================================
# CROSS-WORKBOOK COMPARATOR
# ==============================================================================

class CrossWorkbookComparator:
    """Compares multiple reverse-engineered workbooks to highlight schema differences."""
    
    @staticmethod
    def compare(wb_reports: List[Dict[str, Any]]) -> Dict[str, Any]:
        if len(wb_reports) < 2:
            return {"note": "Requires at least 2 workbooks for comparison."}

        wb1, wb2 = wb_reports[0], wb_reports[1]
        name1, name2 = wb1["file_name"], wb2["file_name"]

        sheets1 = set(wb1["sheets"].keys())
        sheets2 = set(wb2["sheets"].keys())

        common_sheets = sheets1 & sheets2
        only_in_wb1 = sheets1 - sheets2
        only_in_wb2 = sheets2 - sheets1

        sheet_comparisons = {}
        for sname in common_sheets:
            s1 = wb1["sheets"][sname]
            s2 = wb2["sheets"][sname]

            cols1 = {c["column_letter"]: c["header_name"] for c in s1["columns"]}
            cols2 = {c["column_letter"]: c["header_name"] for c in s2["columns"]}

            headers1 = set(cols1.values())
            headers2 = set(cols2.values())

            # Compare formula templates
            patterns1 = {p["pattern_template"] for p in s1["formula_patterns"]}
            patterns2 = {p["pattern_template"] for p in s2["formula_patterns"]}

            sheet_comparisons[sname] = {
                "archetype_wb1": s1["archetype"],
                "archetype_wb2": s2["archetype"],
                "row_count_wb1": s1["dimensions"]["actual_row_count"],
                "row_count_wb2": s2["dimensions"]["actual_row_count"],
                "col_count_wb1": s1["dimensions"]["actual_col_count"],
                "col_count_wb2": s2["dimensions"]["actual_col_count"],
                "headers_added_in_wb2": list(headers2 - headers1),
                "headers_removed_in_wb2": list(headers1 - headers2),
                "common_headers_count": len(headers1 & headers2),
                "formula_patterns_added_in_wb2": list(patterns2 - patterns1),
                "formula_patterns_retained_count": len(patterns1 & patterns2),
                "error_cells_wb1": s1["statistics"]["error_cells"],
                "error_cells_wb2": s2["statistics"]["error_cells"],
            }

        return {
            "workbook_1": name1,
            "workbook_2": name2,
            "sheets_only_in_wb1": list(only_in_wb1),
            "sheets_only_in_wb2": list(only_in_wb2),
            "common_sheets": list(common_sheets),
            "detailed_sheet_comparisons": sheet_comparisons
        }


# ==============================================================================
# REPORT GENERATORS (JSON & MARKDOWN)
# ==============================================================================

class ReportGenerator:
    @staticmethod
    def write_json(data: Any, output_path: str):
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=json_serial, ensure_ascii=False)
        print(f"[+] Successfully wrote JSON report: {output_path}")

    @staticmethod
    def write_markdown(data: Dict[str, Any], output_path: str):
        lines: List[str] = []

        lines.append("# Deep Excel Inspection & Reverse-Engineering Report")
        lines.append(f"\n*Generated on: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}*\n")
        lines.append("This report reverse-engineers the logical schemas, calculations, formulas, and data models of the inspected Excel workbooks.\n")

        # Summary of Files Inspected
        lines.append("## 1. Executive Summary")
        lines.append("| Workbook File | Sheets | Total Used Rows | Formulas Found | Formula Errors | Status |")
        lines.append("| :--- | :---: | :---: | :---: | :---: | :---: |")
        for wb in data.get("workbooks", []):
            fname = wb["file_name"]
            scount = len(wb["sheets"])
            total_rows = sum(s["dimensions"]["actual_row_count"] for s in wb["sheets"].values())
            total_formulas = sum(s["statistics"]["formula_cells"] for s in wb["sheets"].values())
            total_errors = sum(s["statistics"]["error_cells"] for s in wb["sheets"].values())
            status = "⚠️ Has Errors" if total_errors > 0 else "✅ Clean"
            lines.append(f"| **`{fname}`** | {scount} | {total_rows:,} | {total_formulas:,} | {total_errors:,} | {status} |")
        lines.append("")

        # Cross-Workbook Comparison Section
        cross_comp = data.get("cross_workbook_comparison", {})
        if "detailed_sheet_comparisons" in cross_comp:
            lines.append("## 2. Cross-Workbook Schema & Evolution Diff")
            lines.append(f"Comparing **`{cross_comp['workbook_1']}`** ➔ **`{cross_comp['workbook_2']}`**:\n")

            if cross_comp.get("sheets_only_in_wb1"):
                lines.append(f"- **Sheets removed or renamed from WB1**: `{', '.join(cross_comp['sheets_only_in_wb1'])}`")
            if cross_comp.get("sheets_only_in_wb2"):
                lines.append(f"- **Sheets new in WB2**: `{', '.join(cross_comp['sheets_only_in_wb2'])}`")
            lines.append(f"- **Common Sheets Analyzed**: `{', '.join(cross_comp['common_sheets'])}`\n")

            for sname, sdiff in cross_comp["detailed_sheet_comparisons"].items():
                lines.append(f"### Diff for Sheet: `{sname}`")
                lines.append(f"- **Archetype**: `{sdiff['archetype_wb1']}` ➔ `{sdiff['archetype_wb2']}`")
                lines.append(f"- **Dimensions**: Rows: `{sdiff['row_count_wb1']}` ➔ `{sdiff['row_count_wb2']}` | Cols: `{sdiff['col_count_wb1']}` ➔ `{sdiff['col_count_wb2']}`")
                lines.append(f"- **Runtime Formula Errors**: `{sdiff['error_cells_wb1']}` (WB1) vs `{sdiff['error_cells_wb2']}` (WB2)")
                
                if sdiff["headers_added_in_wb2"]:
                    lines.append(f"- **New Columns in WB2**: `{', '.join(sdiff['headers_added_in_wb2'])}`")
                if sdiff["headers_removed_in_wb2"]:
                    lines.append(f"- **Columns Absent in WB2**: `{', '.join(sdiff['headers_removed_in_wb2'])}`")
                if sdiff["formula_patterns_added_in_wb2"]:
                    lines.append(f"- **New Formula Patterns in WB2**:")
                    for pat in sdiff["formula_patterns_added_in_wb2"][:5]:
                        lines.append(f"  - `{pat}`")
                lines.append("")

        # Detailed Inspection per Workbook
        lines.append("## 3. Deep Workbook & Worksheet Inspections")
        for wb in data.get("workbooks", []):
            lines.append(f"\n---\n### Workbook: `{wb['file_name']}`")
            lines.append(f"- **Path**: `{wb['file_path']}`")
            lines.append(f"- **Size**: {wb['file_size_bytes'] / 1024:.1f} KB")
            lines.append(f"- **Defined Named Ranges**: {len(wb['defined_names'])}")
            if wb['defined_names']:
                lines.append(f"  - `{', '.join([d['name'] for d in wb['defined_names'][:10]])}`")

            for sname, sheet in wb["sheets"].items():
                lines.append(f"\n#### Worksheet: `{sname}`")
                lines.append(f"- **Inferred Archetype**: `{sheet['archetype']}` (State: `{sheet['sheet_state']}`)")
                lines.append(f"- **Active Boundaries**: `{sheet['dimensions']['actual_used_range']}` ({sheet['dimensions']['actual_row_count']} data rows, {sheet['dimensions']['actual_col_count']} columns)")
                lines.append(f"- **Layout Controls**: Freeze Panes: `{sheet['layout']['freeze_panes']}` | Merged Cells: {sheet['layout']['merged_cells_count']} | Hidden Rows: {len(sheet['layout']['hidden_rows'])} | Hidden Cols: {len(sheet['layout']['hidden_columns'])}")
                
                # Statistics
                stats = sheet["statistics"]
                lines.append(f"- **Cell Breakdown**: Text: {stats['text_cells']} | Numeric: {stats['numeric_cells']} | Dates: {stats['date_cells']} | Formulas: {stats['formula_cells']} | Empty: {stats['empty_cells']} | **Errors: {stats['error_cells']}**")
                
                # Errors
                if sheet["excel_errors"]:
                    lines.append(f"\n> ⚠️ **Excel Calculation Errors in `{sname}`**:")
                    for err_type, count in sheet["excel_errors"].items():
                        lines.append(f"> - **{err_type}**: {count} cells")
                        sample_errs = sheet["excel_errors_details"].get(err_type, [])[:3]
                        for se in sample_errs:
                            lines.append(f">   - Location `{se['cell']}`: Formula=`{se['raw_formula']}` | Evaluated=`{se['evaluated_value']}`")

                # Cross-sheet references
                if sheet["cross_sheet_references"]:
                    lines.append("\n**Cross-Sheet Dependencies:**")
                    for target_s, ranges in sheet["cross_sheet_references"].items():
                        lines.append(f"- References sheet **`{target_s}`** at cells: `{', '.join(ranges[:10])}`")

                # Column Schema Table
                lines.append("\n**Column Definitions & Inferred Business Semantics:**")
                lines.append("| Col | Header | Semantic Role | Dominant Type | Uniques | Sample Values |")
                lines.append("| :--- | :--- | :--- | :--- | :---: | :--- |")
                for col in sheet["columns"][:40]:  # Cap at 40 cols to avoid overwhelming markdown
                    hname = col["header_name"] if col["header_name"] else f"*(empty)*"
                    samples = ", ".join([f"`{s}`" for s in col["sample_values"][:3]])
                    lines.append(f"| `{col['column_letter']}` | **{hname}** | `{col['inferred_semantic_role']}` | {col['predominant_type']} | {col['unique_values_count']} | {samples} |")
                if len(sheet["columns"]) > 40:
                    lines.append(f"| ... | *[{len(sheet['columns']) - 40} more columns omitted]* | | | | |")

                # Formula Patterns
                if sheet["formula_patterns"]:
                    lines.append("\n**Calculated Logic & Formula Templates (Row-Shift Invariant):**")
                    lines.append("| Target Col | Normalized Formula Template | Span | Rows | Example Formula |")
                    lines.append("| :---: | :--- | :---: | :---: | :--- |")
                    for pat in sheet["formula_patterns"][:15]:
                        lines.append(f"| `{pat['target_column']}` | `{pat['pattern_template']}` | {pat['occurrences']} | `{pat['row_range']}` | `{pat['sample_original_formula']}` |")
                    lines.append("")

        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"[+] Successfully wrote Markdown report: {output_path}")


# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Deep Excel Reverse-Engineering Engine: extracts formulas, schemas, errors, and relations."
    )
    parser.add_argument(
        "--dir", "-d",
        default=".",
        help="Directory containing Excel workbooks to analyze (default: current directory)."
    )
    parser.add_argument(
        "--output-json", "-j",
        default="excel_deep_inspection_report.json",
        help="Path to generated JSON report."
    )
    parser.add_argument(
        "--output-md", "-m",
        default="excel_deep_inspection_report.md",
        help="Path to generated Markdown report."
    )

    args = parser.parse_args()
    target_dir = os.path.abspath(args.dir)

    print("=" * 80)
    print("  EXCEL REVERSE-ENGINEERING ENGINE: FORMULA, SCHEMA & LOGIC INSPECTOR")
    print("=" * 80)
    print(f"Target Directory: {target_dir}")

    # Discover Excel files
    patterns = ["*.xlsx", "*.xlsm"]
    found_files = []
    for pat in patterns:
        found_files.extend(glob.glob(os.path.join(target_dir, pat)))

    # Filter out temporary Excel lock files (e.g. ~$file.xlsx)
    valid_files = [f for f in found_files if not os.path.basename(f).startswith("~$")]

    if not valid_files:
        print(f"[!] No valid Excel workbooks (.xlsx, .xlsm) found in: {target_dir}")
        sys.exit(1)

    print(f"[+] Identified {len(valid_files)} workbook(s) for deep reverse engineering:")
    for vf in valid_files:
        print(f"    - {os.path.basename(vf)}")

    # Inspect each workbook
    wb_reports = []
    for fpath in valid_files:
        inspector = WorkbookDeepInspector(fpath)
        report = inspector.inspect()
        wb_reports.append(report)

    # Perform cross-workbook comparison
    print("\n[*] Performing cross-workbook schema and calculation comparison...")
    cross_comparison = CrossWorkbookComparator.compare(wb_reports)

    full_analysis_data = {
        "analysis_timestamp": datetime.datetime.utcnow().isoformat(),
        "workbooks_inspected_count": len(wb_reports),
        "cross_workbook_comparison": cross_comparison,
        "workbooks": wb_reports
    }

    # Generate Reports
    print("\n[*] Exporting comprehensive reports...")
    ReportGenerator.write_json(full_analysis_data, args.output_json)
    ReportGenerator.write_markdown(full_analysis_data, args.output_md)

    print("\n" + "=" * 80)
    print("  INSPECTION COMPLETE")
    print(f"  1. Machine-readable JSON : {os.path.abspath(args.output_json)}")
    print(f"  2. Human-readable Markdown : {os.path.abspath(args.output_md)}")
    print("=" * 80)
    print("You can now share these reports back to proceed with designing the canonical ingestion model.\n")


if __name__ == "__main__":
    main()