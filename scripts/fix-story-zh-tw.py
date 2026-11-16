import io, glob, sys

FILES = glob.glob('story/**/index.html', recursive=True) + ['story/index.html']
FILES = sorted(set(FILES))

OLD_LANG  = "root.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');"
NEW_LANG  = "root.setAttribute('lang', lang === 'en' ? 'en-US' : (lang === 'zh-TW' ? 'zh-TW' : 'zh-CN'));"
OLD_SAVE  = "try { localStorage.setItem('caesura-lang', lang); } catch (e) { /* noop */ }"
NEW_SAVE  = ("try { localStorage.setItem('caesura-lang', lang); } catch (e) { /* noop */ }\n"
             "    if (window.__caesuraZhTW) {\n"
             "      if (lang === 'zh-TW' && window.__caesuraZhTW.applyToDocument) window.__caesuraZhTW.applyToDocument();\n"
             "      else if (lang === 'zh' && window.__caesuraZhTW.restoreOriginals) window.__caesuraZhTW.restoreOriginals();\n"
             "    }\n"
             "    btn.textContent = lang === 'zh' ? '繁體' : (lang === 'zh-TW' ? 'EN' : '简体');")
OLD_CYCLE = "apply(root.getAttribute('data-lang') === 'en' ? 'zh' : 'en');"
NEW_CYCLE = "var cur = root.getAttribute('data-lang'); apply(cur === 'zh' ? 'zh-TW' : (cur === 'zh-TW' ? 'en' : 'zh'));"
OLD_BOOT  = "apply(saved === 'en' ? 'en' : 'zh');"
NEW_BOOT  = "apply(saved === 'en' || saved === 'zh-TW' ? saved : 'zh');"

changed = 0
for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    orig = s
    n = 0
    n += s.count(OLD_LANG);  s = s.replace(OLD_LANG, NEW_LANG)
    n += s.count(OLD_SAVE);  s = s.replace(OLD_SAVE, NEW_SAVE)
    n += s.count(OLD_CYCLE); s = s.replace(OLD_CYCLE, NEW_CYCLE)
    n += s.count(OLD_BOOT);  s = s.replace(OLD_BOOT, NEW_BOOT)
    if s != orig:
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        print('patched', p, '(%d sites)' % n)
        changed += 1
    else:
        print('UNCHANGED', p)
print('DONE', changed, 'files')
