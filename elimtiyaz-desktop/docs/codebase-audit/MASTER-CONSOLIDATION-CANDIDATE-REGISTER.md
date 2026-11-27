# Master register and coverage

The [decision register](MASTER-CONSOLIDATION-CANDIDATE-REGISTER.csv) records 12 findings. Paths are relative to the desktop package unless the row names a sibling repository. P2 identifiers index the supplied CSV in original data-row order.

| Classification | Verified decisions |
|---|---:|
| Confirmed dead | 1 empty file, 0 symbols, 0 LOC |
| Confirmed exact duplicate | 2 |
| Confirmed semantic reimplementation | 1 |
| Conflicting source of truth | 2 |
| Legitimate separation | 1 |
| False positive | 5 |

Six of 1,089 original candidate rows link to verified findings. The [crosswalk](pass3/pass2-candidate-crosswalk.csv) retains every original row, its original evidence and open checks. Compiler resolution traced four external symbol uses in addition to the dependency and empty-file checks. An unresolved symbol or an absent literal filename match does not establish deadness.

The [5,914 original duplication observations](pass3/duplication-observations.csv) and [917 modeled groups](pass3/modeled-groups.csv) have stable row identifiers. The model replay reproduced the original cumulative selections of 224 strict, 308 through near, and 917 through semantic matching. Its algorithm reserves source lines, excludes two proposed dead files, and estimates extraction overhead. 917 includes earlier strict and near selections. These totals overlap. The 14,330 modeled LOC are not verified removals.

The [799 current lint diagnostics](pass3/unused-variable-diagnostics.csv) match the original counts per file across all 214 files. Preserve initializer effects, callback signatures and destructuring semantics until reviewed. The [77-script reference inventory](pass3/operational-script-references.csv) distinguishes filename mentions in documentation and source/configuration. Human invocation and commands constructed dynamically need separate review.
