#!/usr/bin/env bash
# T-058 guard matrix — exercises every branch of check-migrations-append-only.sh
# against a throwaway git repo, then the real chain. Run from anywhere.
set -uo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-migrations-append-only.sh"
ROOT="/home/z/my-project/.t058-test"
rm -rf "$ROOT"; mkdir -p "$ROOT/supabase/migrations"
cd "$ROOT"
git init -q .; git config user.email t@t; git config user.name t
printf -- '-- 0001 init\nCREATE TABLE t (id int);\n' > supabase/migrations/0001_init.sql
git add -A; git commit -qm init
BASE=$(git rev-parse HEAD)
PASS=0; FAIL=0
check () { # $1 = expected exit (0|1), $2 = label
  bash "$S" --dir "$ROOT/supabase/migrations" --base "$BASE" >/dev/null 2>&1
  local got=$?
  if [[ "$got" == "$1" ]]; then PASS=$((PASS+1)); echo "PASS  ($got) $2";
  else FAIL=$((FAIL+1)); echo "FAIL  (got $got, want $1) $2"; fi
}

check 0 "clean repo"
printf -- '-- planted edit\n' >> supabase/migrations/0001_init.sql
check 1 "unstaged EDIT of tracked migration"
git checkout -q -- supabase/migrations/0001_init.sql
git rm -q supabase/migrations/0001_init.sql
check 1 "staged DELETE (dir pruned)"
git reset -q --hard HEAD
git mv supabase/migrations/0001_init.sql supabase/migrations/0002_renamed.sql
check 1 "staged RENAME"
git reset -q --hard HEAD
printf -- '-- 0002 new\nSELECT 1;\n' > supabase/migrations/0002_new.sql
check 0 "new untracked migration WITH header (append = allowed)"
rm supabase/migrations/0002_new.sql
printf 'SELECT 1;\n' > supabase/migrations/0002_bad.sql
check 1 "new migration WITHOUT header"
rm supabase/migrations/0002_bad.sql
printf -- '-- bad name\nSELECT 1;\n' > supabase/migrations/zz.sql
check 1 "migration name not NNNN_*.sql"
rm supabase/migrations/zz.sql
printf -- '-- committed edit\n' >> supabase/migrations/0001_init.sql
git add -A; git commit -qm edit
check 1 "COMMITTED edit (only visible vs base)"
git reset -q --hard HEAD~1
check 0 "restored clean"

echo "--- real chain ---"
bash "$S" --base HEAD >/dev/null 2>&1 && echo "PASS  real repo vs HEAD" || { echo "FAIL  real repo vs HEAD"; FAIL=$((FAIL+1)); }
bash "$S" --base origin/main >/dev/null 2>&1 && echo "PASS  real repo vs origin/main" || { echo "FAIL  real repo vs origin/main"; FAIL=$((FAIL+1)); }
echo "=== matrix: $PASS pass / $FAIL fail ==="
rm -rf "$ROOT"
[[ $FAIL -eq 0 ]]
