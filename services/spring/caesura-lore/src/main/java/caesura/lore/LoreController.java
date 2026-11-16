package caesura.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * /lore 的对外面（2026-11-15，第八个成员）。
 *
 * <ul>
 *   <li>{@code GET  /lore/codex?lang=zh|en} —— 48 条世界谱（双语各一份载荷，分别缓存）</li>
 *   <li>{@code GET  /lore/codex/{id}}      —— 单条（200 / 404）</li>
 *   <li>{@code POST /lore/search}          —— BM25 检索：{@code {"q": "万籁", "limit": 5, "lang": "zh"}}</li>
 *   <li>{@code GET  /lore/stats}           —— 条目数 / 缓存命中率 / 后端 / 运行时</li>
 * </ul>
 */
@RestController
public class LoreController {

  private static final MediaType JSON = MediaType.APPLICATION_JSON;

  private final LoreCorpus corpus;
  private final LoreRanker ranker;
  private final LoreSqliteIndex sqlite;
  private final LoreCache cache;
  private final ObjectMapper mapper;
  private final long startedAt = System.currentTimeMillis();

  public LoreController(LoreCorpus corpus, LoreRanker ranker, LoreSqliteIndex sqlite, LoreCache cache, ObjectMapper mapper) {
    this.corpus = corpus;
    this.ranker = ranker;
    this.sqlite = sqlite;
    this.cache = cache;
    this.mapper = mapper;
  }

  @GetMapping(value = "/lore/codex", produces = "application/json")
  public ResponseEntity<String> codex(@RequestParam(defaultValue = "zh") String lang) {
    String payload = cache.getOrCompute("codex", "codex:" + safeLang(lang), () -> renderCodex(safeLang(lang)));
    return ResponseEntity.ok().contentType(JSON).body(payload);
  }

  @GetMapping(value = "/lore/codex/{id}", produces = "application/json")
  public ResponseEntity<String> codexById(@PathVariable String id,
      @RequestParam(defaultValue = "zh") String lang) {
    String safe = safeLang(lang);
    String payload = cache.getOrCompute("id", "id:" + safe + ":" + id, () -> renderById(id, safe));
    if (payload == null) {
      return ResponseEntity.status(HttpStatus.NOT_FOUND)
          .contentType(JSON)
          .body("{\"error\":\"not_found\",\"id\":\"" + id + "\"}");
    }
    return ResponseEntity.ok().contentType(JSON).body(payload);
  }

  @PostMapping(value = "/lore/search", produces = "application/json")
  public ResponseEntity<String> search(@RequestBody(required = false) JsonNode body) {
    String q = body == null ? "" : body.path("q").asText("");
    String lang = body == null ? "zh" : body.path("lang").asText("zh");
    int limit = body == null ? 5 : Math.min(50, Math.max(1, body.path("limit").asInt(5)));
    String engine = body == null ? "bm25" : body.path("engine").asText("bm25");
    return respondSearch(q, lang, limit, safeEngine(engine));
  }

  /** 只读检索的 GET 形态（浏览器直接可用；e2e 也用这一条打 BM25 探针） */
  @org.springframework.web.bind.annotation.GetMapping(value = "/lore/search", produces = "application/json")
  public ResponseEntity<String> searchGet(@RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "zh") String lang,
      @RequestParam(defaultValue = "5") int limit,
      @RequestParam(defaultValue = "bm25") String engine) {
    return respondSearch(q, safeLang(lang), Math.min(50, Math.max(1, limit)), safeEngine(engine));
  }

  private String safeEngine(String engine) {
    return "fts".equalsIgnoreCase(engine) ? "fts" : "bm25";
  }

  private ResponseEntity<String> respondSearch(String q, String lang, int limit, String engine) {
    cache.noteSearch();
    String cacheKey = "search:" + engine + ":" + safeLang(lang) + ":" + normalize(q) + ":" + limit;
    String payload = cache.getOrCompute("search", cacheKey, () -> renderSearch(q, lang, limit, engine));
    return ResponseEntity.ok().contentType(JSON).body(payload);
  }

  /** 数据库引擎自述（EXPLAIN QUERY PLAN 原文 + 分词结果）—— 不进缓存、每问必真算 */
  @GetMapping(value = "/lore/explain", produces = "application/json")
  public ResponseEntity<String> explain(@RequestParam(defaultValue = "") String q) {
    try {
      return ResponseEntity.ok().contentType(JSON).body(mapper.writeValueAsString(sqlite.explain(q)));
    } catch (Exception e) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).contentType(JSON)
          .body("{\"error\":\"explain_failed\"}");
    }
  }

  @GetMapping(value = "/lore/stats", produces = "application/json")
  public ResponseEntity<String> stats() {
    LoreCache.Stats s = cache.stats();
    ObjectNode node = mapper.createObjectNode();
    node.put("entries", corpus.size());
    node.put("corpus", corpus.size() + "-real-texts-of-the-epoch-of-hush");
    node.put("cacheBackend", cache.backend());
    node.put("cacheHits", s.cacheHits());
    node.put("cacheMisses", s.cacheMisses());
    node.put("searches", s.searches());
    node.put("hitRate", s.hitRate());
    node.put("uptimeMs", System.currentTimeMillis() - startedAt);
    node.put("playerProcessLlm", false);
    node.put("degradedRequests", s.degradedRequests());
    ObjectNode db = mapper.createObjectNode();
    for (Map.Entry<String, Object> kv : sqlite.healthBlock().entrySet()) {
      Object v = kv.getValue();
      if (v instanceof Number) db.put(kv.getKey(), ((Number) v).doubleValue()); else db.put(kv.getKey(), String.valueOf(v));
    }
    node.set("db", db);
    return ResponseEntity.ok().contentType(JSON).body(node.toString());
  }

  // ---------- 渲染 ----------

  private String safeLang(String lang) {
    return "en".equalsIgnoreCase(lang) ? "en" : "zh";
  }

  private String normalize(String q) {
    return q == null ? "" : q.trim().toLowerCase().replaceAll("\\s+", " ");
  }

  /** 启动预热用：同样的 key（`codex:zh`/`codex:en`）、同样的载荷 —— 首个真实请求直接命中 */
  public void warmCodexCache() {
    cache.warm("codex", "codex:zh", () -> renderCodex("zh"));
    cache.warm("codex", "codex:en", () -> renderCodex("en"));
  }

  private String renderCodex(String lang) {
    ObjectNode root = mapper.createObjectNode();
    root.put("lang", lang);
    root.put("total", corpus.size());
    ArrayNode arr = root.putArray("entries");
    for (LoreEntry e : corpus.entries()) {
      arr.add(entryNode(e, lang, null));
    }
    return root.toString();
  }

  private String renderById(String id, String lang) {
    return corpus.byId(id).map(e -> entryNode(e, lang, null).toString()).orElse(null);
  }

  private String renderSearch(String q, String lang, int limit, String engine) {
    long t0 = System.nanoTime();
    List<LoreRanker.Hit> hits = "fts".equals(engine) ? sqlite.search(q, limit) : ranker.search(q, limit);
    double tookMs = (System.nanoTime() - t0) / 1_000_000.0;
    ObjectNode root = mapper.createObjectNode();
    root.put("q", q);
    root.put("lang", safeLang(lang));
    root.put("total", hits.size());
    root.put("tookMs", tookMs);
    root.put("algorithm", "BM25(k1=1.5,b=0.75,titleBoost=3)");
    root.put("engine", engine);
    if ("fts".equals(engine)) root.put("engineDetail", "sqlite-inmemory / posting PK(token, entry_id) / idf(df table, one lookup per term)");
    ArrayNode arr = root.putArray("hits");
    for (LoreRanker.Hit hit : hits) {
      arr.add(entryNode(hit.entry(), safeLang(lang), hit.score()));
    }
    return root.toString();
  }

  private ObjectNode entryNode(LoreEntry e, String lang, Double score) {
    ObjectNode node = mapper.createObjectNode();
    node.put("id", e.id());
    node.put("cat", e.cat());
    boolean en = "en".equals(lang);
    node.put("title", en ? e.title().en() : e.title().zh());
    node.put("body", en ? e.body().en() : e.body().zh());
    if (score != null) node.put("score", score);
    return node;
  }
}
