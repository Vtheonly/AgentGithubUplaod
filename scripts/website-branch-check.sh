#!/bin/bash
# Website repo branch containment verification
cd /home/z/my-project/repos/elimtiyaz-website || exit 1
MAIN=origin/main
echo "MAIN tip: $(git rev-parse --short $MAIN)"
echo ""
for b in $(git branch -r | grep -v HEAD | sed 's/ *//' | grep -v 'origin/main$'); do
  name=${b#origin/}
  if git merge-base --is-ancestor "$b" $MAIN 2>/dev/null; then anc="OK"; else anc="FAIL"; fi
  uniq=$(git rev-list --count $MAIN..$b)
  ahead_behind="ahead=$uniq behind=$(git rev-list --count $b..$MAIN)"
  date=$(git log -1 --format='%as' $b)
  echo "$name: ancestor=$anc $ahead_behind last=$date"
  if [ "$anc" = "FAIL" ]; then
    echo "  unique commits on $name:"
    git log --oneline $MAIN..$b | head -10 | sed 's/^/    /'
  fi
done
