#!/bin/bash
# Branch analysis for issue #21 consolidation
# For each remote branch: merged status, ahead/behind vs main, unique commits, changed files
cd /home/z/my-project/repos/AgentGithubUplaod || exit 1

MAIN=origin/main
echo "MAIN tip: $(git rev-parse --short $MAIN) $(git log -1 --format='%s' $MAIN | cut -c1-80)"
echo ""
printf "%-45s %-10s %-8s %-8s %s\n" "BRANCH" "MERGED?" "AHEAD" "BEHIND" "LAST_COMMIT_DATE"
echo "------------------------------------------------------------------------------------------------"

for b in $(git branch -r | grep -v HEAD | sed 's/ *//'); do
  name=${b#origin/}
  # merged = branch tip is ancestor of main
  if git merge-base --is-ancestor "$b" $MAIN 2>/dev/null; then merged="YES"; else merged="no"; fi
  ahead=$(git rev-list --count $MAIN..$b 2>/dev/null)
  behind=$(git rev-list --count $b..$MAIN 2>/dev/null)
  date=$(git log -1 --format='%as' $b)
  printf "%-45s %-10s %-8s %-8s %s\n" "$name" "$merged" "$ahead" "$behind" "$date"
done
