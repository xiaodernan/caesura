/* zh-tw-converter.js — sibling loaded by every Chinese page.
 * Converts CJK text between 简体 (zh-CN) and 繁體 (zh-TW) on the fly,
 * using a ~57 KB longest-match dictionary (scripts/gen-zh-tw-table.cjs).
 *
 * window.__caesuraZhTW:
 *   toTraditional(s)      — string → Traditional
 *   applyToDocument()     — convert every text node under <body> to Traditional
 *   restoreOriginals()    — walk every node converted by this session and put the original Simplified back
 *   observe(root?)        — install a MutationObserver that converts added/changed text nodes as they appear
 *                           (used by the in-game page where panels re-render constantly)
 *   applyToDocumentAll(root) — convert a subtree (defaults to document.body)
 *
 * Originals are kept in a Map<Text,string> so toggling back to 简体 is lossless.
 */
(function () {
  function loadTable(cb) {
    var req = new XMLHttpRequest();
    req.open('GET', '/caesura/zh-tw.compact.json', true);
    req.onload = function () {
      try {
        var t = JSON.parse(req.response);
        cb(t);
      } catch (e) {
        console.error('[zh-tw] bad table', e);
        cb(null);
      }
    };
    req.onerror = function () { console.error('[zh-tw] failed to load table'); cb(null); };
    req.send(null);
  }

  var table = null;
  var MAXLEN = 8;
  var originals = new Map(); // Text node -> original Simplified textContent
  function setTable(t) {
    table = t;
    var mx = 8;
    if (table && table.map) {
      for (var k in table.map) if (k.length > mx) mx = k.length;
    }
    MAXLEN = mx;
  }

  function toTraditional(s) {
    if (typeof s !== 'string' || s.length === 0) return s;
    if (!table) return s;
    var map = table.map;
    var out = '';
    var i = 0;
    while (i < s.length) {
      var matched = false;
      for (var len = MAXLEN; len >= 1; len--) {
        if (i + len > s.length) continue;
        var key = s.substring(i, i + len);
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          out += map[key];
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) { out += s.charAt(i); i += 1; }
    }
    return out;
  }

  function convertTextNode(node) {
    var raw = node.textContent;
    if (!raw || !/[\u4e00-\u9fff]/.test(raw)) return;
    var conv = toTraditional(raw);
    if (conv === raw) return;
    if (!originals.has(node)) originals.set(node, raw);
    node.textContent = conv;
  }

  function walk(root, fn) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  function applyToDocumentAll(root) {
    if (!table) return;
    walk(root || document.body, convertTextNode);
  }

  function applyToDocument() {
    applyToDocumentAll(document.body);
  }

  function restoreOriginals() {
    originals.forEach(function (orig, node) {
      try { node.textContent = orig; } catch (e) { /* node may be detached */ }
    });
    originals = new Map();
  }

  var observed = false;
  function observe(root) {
    if (observed) return;
    var target = root || document.body;
    if (!target) return;
    observed = true;
    var mo = new MutationObserver(function (mutations) {
      if (!table) return;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'characterData' && m.target && m.target.nodeType === 3) {
          convertTextNode(m.target);
          continue;
        }
        if (m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 3) convertTextNode(n);
            else if (n.nodeType === 1) applyToDocumentAll(n);
          }
        }
      }
    });
    mo.observe(target, { childList: true, subtree: true, characterData: true });
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Persistence key: 'caesura-lang' values: 'zh' | 'zh-TW' | 'en'
  window.__caesuraZhTW = {
    toTraditional: toTraditional,
    applyToDocument: applyToDocument,
    applyToDocumentAll: applyToDocumentAll,
    restoreOriginals: restoreOriginals,
    observe: observe,
  };

  ready(function () {
    loadTable(function (t) {
      setTable(t);
      var saved = null;
      try { saved = localStorage.getItem('caesura-lang'); } catch (e) { /* noop */ }
      if (saved === 'zh-TW') {
        applyToDocument();
      }
    });
  });
})();
