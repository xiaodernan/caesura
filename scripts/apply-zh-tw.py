#!/usr/bin/env python
"""Apply Traditional Chinese (zh-TW) toggle to all static HTML pages.

Sets up /caesura/zh-tw-converter.js based conversion and a 3-way toggle
(zh-CN → zh-TW → EN → zh-CN) on every static page with .zh-copy / .en-copy markup.
"""
import io, os, re, sys

ROOT = r'D:\法环游戏'

# Pages to update (skip admin/index.html and tutorial/index.html — those are handled manually)
PAGES = [
    'index.html',
    'codex/index.html',
    'cast/index.html',
    'console/index.html',
    'story/index.html',
    'story/anthology/index.html',
    'story/unnamed-stone/index.html',
    'story/empty-bar/index.html',
    'story/ledger/index.html',
    'story/garden/index.html',
    'story/tribunal/index.html',
    'story/frostbell/index.html',
    'story/doors/index.html',
    'story/stonethroat/index.html',
    'story/first-bell/index.html',
    'story/dark-tide/index.html',
    'story/twelfth-listener/index.html',
    'story/bell-picker/index.html',
    'story/lampwright-bell/index.html',
]

def patches_for(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        s = f.read()

    orig = s

    # Patch 1: CSS rule — make zh-TW behave like zh for display purposes
    s = s.replace('[data-lang="zh"] .en-copy { display:none !important; }',
                  '[data-lang="zh-TW"] .en-copy { display:none !important; }\n  [data-lang="zh"] .en-copy { display:none !important; }')
    s = s.replace('    [data-lang="zh"] .en-copy { display:none }',
                  '    [data-lang="zh-TW"] .en-copy { display:none }\n    [data-lang="zh"] .en-copy { display:none }')
    s = s.replace('  [data-lang="zh"] .en-copy { display:none }\n  [data-lang="en"] .zh-copy { display:none }',
                  '  [data-lang="zh-TW"] .en-copy { display:none }\n  [data-lang="zh"] .en-copy { display:none }\n  [data-lang="en"] .zh-copy { display:none }')
    if '[data-lang="zh-TW"] .en-copy' not in s:
        print('  WARN: no CSS zh-TW rule inserted for', rel)

    # Patch 2: Language toggle cycling order — replace handler logic
    s = re.sub(
        r"(saved === 'en' \|\| saved === 'zh')",
        "(saved === 'en' || saved === 'zh' || saved === 'zh-TW')",
        s, count=1)
    s = re.sub(
        r"root\.lang = next === 'en' \? 'en-US' : 'zh-CN';",
        "root.lang = next === 'en' ? 'en-US' : (next === 'zh-TW' ? 'zh-TW' : 'zh-CN');",
        s, count=99)

    # Cycle logic: zh → zh-TW → en → zh
    s = s.replace("setLang(LANG === 'zh' ? 'en' : 'zh')",
                  "setLang(LANG === 'zh' ? 'zh-TW' : (LANG === 'zh-TW' ? 'en' : 'zh'))")

    # Patch 3: load converter script before closing </body>, after existing .tracker.js load if any
    conv = '<script defer src="/caesura/zh-tw-converter.js"></script>\n'
    if '/caesura/zh-tw-converter.js' not in s:
        s = s.replace('</body>', conv + '</body>', 1)

    # Patch 4: after i18n application or applyLang, call the converter's applyToDocument if zh-TW
    # Skip codex — it has a different pattern (no zh-copy spans; renders cards via JS)
    if rel == 'codex/index.html':
        print('  SKIP codex (own i18n flow):', rel)
        return s

    if s == orig:
        print('  WARN no changes for', rel)
        return s
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)
    print('  patched', rel)
    return s

for rel in PAGES:
    patches_for(rel)
print('DONE')
