#!/usr/bin/env bash
# TD-003 落地：在 detached worktree 平面上真跑钩子提交，CAS 移动 master，再修主副本索引。
set -u
MAIN=/d/法环游戏
WT=/c/Users/18414/AppData/Local/Temp/caesura_wt_td003
WTW='C:\Users\18414\AppData\Local\Temp\caesura_wt_td003'
MSG=$MAIN/.scratch/td003_commit_msg.txt
MSGWIN=/c/Users/18414/AppData/Local/Temp/caesura_td003_msg.txt
cp "$MSG" "$MSGWIN" || { echo "MSG COPY FAILED"; exit 1; }
PATHS=(docs/KNOWN_ISSUES.md docs/technical-architecture.md tests/unit/doc-audit.test.ts)
EXPECT_HEAD=c0ccf30

norm() { sed 's/\r$//'; }

echo "== 1. 把我的三个文件覆盖进 worktree 并按归一化字节复验 =="
cd "$MAIN" || exit 1
for f in "${PATHS[@]}"; do
  cp "$f" "$WT/$f" || { echo "CP FAILED $f"; exit 1; }
  if diff <(norm <"$f") <(norm <"$WT/$f") >/dev/null; then echo "SAME  $f"; else echo "DIFF  $f"; exit 1; fi
done

echo "== 2. worktree 里真跑 npm run lint =="
( cd "$WT" && npm run lint >"$WT/../caesura_wt_td003_lint2.log" 2>&1 )
echo "LINT_RC=$?"
tail -3 "/c/Users/18414/AppData/Local/Temp/caesura_wt_td003_lint2.log"

echo "== 3. 只 stage 我的三个路径，并把 staged numstat 与主副本的 numstat 对上 =="
git -C "$WT" add -- "${PATHS[@]}"
git -C "$WT" diff --cached --numstat | sort > "$MAIN/.scratch/td003_numstat_wt.txt"
git diff --numstat -- "${PATHS[@]}" 2>/dev/null | sort > "$MAIN/.scratch/td003_numstat_main.txt"
echo "--- worktree staged ---"; cat "$MAIN/.scratch/td003_numstat_wt.txt"
echo "--- main unstaged ---"; cat "$MAIN/.scratch/td003_numstat_main.txt"
if ! diff "$MAIN/.scratch/td003_numstat_wt.txt" "$MAIN/.scratch/td003_numstat_main.txt" >/dev/null; then
  echo "REFUSE: staged numstat 与主副本不一致"; exit 1
fi
STAGED=$(git -C "$WT" diff --cached --name-only | sort | tr '\n' ' ')
if [ "$STAGED" != "${PATHS[*]} " ]; then echo "REFUSE: 暂存区不是且仅是我这三个文件: [$STAGED]"; exit 1; fi
echo "STAGED_OK: $STAGED"

echo "== 4. 提交（机器级 pre-commit 真跑） =="
git -C "$WT" -c user.name="CAESURA-Team" -c user.email="dev@caesura.local" commit -F "$MSGWIN" 2>&1 | tail -6
NEWW=$(git -C "$WT" rev-parse HEAD)
echo "NEW=$NEWW"
[ -n "$NEWW" ] || exit 1

echo "== 5. 提交内容 == 我写的字节（按 blob 比，不比工作副本行尾） =="
for f in "${PATHS[@]}"; do
  if diff <(git -C "$WT" show "HEAD:$f" | norm) <(norm <"$f") >/dev/null; then echo "BLOB-SAME $f"; else echo "BLOB-DIFF $f"; exit 1; fi
done

echo "== 6. CAS 移动 master（$EXPECT_HEAD -> $NEWW） =="
OLD=$(git -C "$MAIN" rev-parse --short refs/heads/master)
if [ "$OLD" != "$EXPECT_HEAD" ]; then echo "STAND DOWN: master 已不在 $EXPECT_HEAD（现在是 $OLD），不动 ref"; exit 2; fi
git -C "$MAIN" update-ref refs/heads/master "$NEWW" "$(git -C "$MAIN" rev-parse refs/heads/master)"
echo "UPDATE_REF_RC=$?"
git -C "$MAIN" log --oneline -1 | cat

echo "== 7. 修主副本的陈旧索引（只重建我这三个路径） =="
git -C "$MAIN" reset -q -- "${PATHS[@]}"
echo "--- master status（应当只剩别人的文件） ---"
git -C "$MAIN" status --porcelain | grep -E "docs/KNOWN_ISSUES|technical-architecture|doc-audit" && { echo "REFUSE: 我的路径仍显示为脏"; exit 1; }
echo "MY_PATHS_CLEAN=yes"

echo "== 8. 拆平面：先删 junction，再删目录 =="
cmd.exe //c "rmdir $WTW\\node_modules" >/dev/null 2>&1; echo "RMDIR_LINK_RC=$?"
[ -e "$WT/node_modules/vitest" ] && { echo "REFUSE: junction 没删掉，停在这里（不要 rm -rf）"; exit 1; }
git -C "$MAIN" worktree remove --force "$WT" && echo "WT_REMOVED"
git -C "$MAIN" worktree prune
ls /d/法环游戏/node_modules | wc -l
echo "LAND DONE"
