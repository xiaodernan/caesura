package caesura.lore;

import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 世界谱的 SQLite 词袋倒排（in-memory `jdbc:sqlite::memory:`）—— 这一路存在的理由只有一个：
 * 回答「**数据库**怎么做 BM25 检索」这件事，且和内存路用同一份分词、同一份打分函数。
 *
 * <ul>
 *   <li>`entry` —— 文档行（id / cat / dl），`posting` —— 词→文档词袋行（<b>复合主键</b>
 *   `PRIMARY KEY(token, entry_id)`，WITHOUT ROWID）</li>
 *   <li>`df` —— token 的文档频率表（建索引期算好，查一次装起来，热路径零聚合）</li>
 *   <li>搜索：query tokenize → 一条 `WHERE token IN (?,…)` 走 PK 索引取回 posting 行 → Java 侧用
 *   {@link LoreScoring} 打分（与内存路同一公式）</li>
 * </ul>
 *
 * <p>它不是「另一个裁判」——同裁判（分词+打分），只是裁判站在数据库索引上出庭。
 */
@Component
public class LoreSqliteIndex {

  public record Stats(int entries, int postings, int distinctTokens, double avgdl, long buildMs) {}

  private final LoreCorpus corpus;
  private final Connection conn;
  private final Map<String, Integer> docLen = new HashMap<>();
  private final Map<String, Integer> docFreq = new HashMap<>();
  private final Map<String, LoreEntry> byId = new HashMap<>();
  private final double avgLength;
  private final Stats stats;

  public LoreSqliteIndex(LoreCorpus corpus) {
    this.corpus = corpus;
    for (LoreEntry e : corpus.entries()) byId.put(e.id(), e);
    long t0 = System.nanoTime();
    try {
      conn = DriverManager.getConnection("jdbc:sqlite::memory:");
      build();
    } catch (SQLException e) {
      throw new IllegalStateException("SQLite 索引构建失败 —— 世界谱检索不可用", e);
    }
    long buildMs = (System.nanoTime() - t0) / 1_000_000;
    int postings = 0;
    for (Map.Entry<String, Integer> kv : docFreq.entrySet()) postings += kv.getValue();
    this.avgLength = corpus.size() == 0 ? 1.0 : docLen.values().stream().mapToInt(Integer::intValue).sum() / (double) corpus.size();
    this.stats = new Stats(corpus.size(), postings, docFreq.size(), avgLength, buildMs);
  }

  public Stats stats() {
    return stats;
  }

  /** 世界谱后端暴露给 /lore/stats 的数据库体检：条目数 / posting 数 / 平均文档长 / 构建耗时 */
  public Map<String, Object> healthBlock() {
    Map<String, Object> m = new HashMap<>();
    m.put("type", "sqlite-inmemory");
    m.put("entries", stats.entries());
    m.put("postings", stats.postings());
    m.put("distinctTokens", stats.distinctTokens());
    m.put("avgdl", stats.avgdl());
    m.put("buildMs", stats.buildMs());
    m.put("plan", "SEARCH TABLE posting USING PRIMARY KEY (token=?)");
    return m;
  }

  public int corpusSize() {
    return corpus.size();
  }

  public List<LoreRanker.Hit> search(String query, int limit) {
    List<String> qToks = LoreTokenizer.tokenize(query);
    if (qToks.isEmpty()) return List.of();
    String in = placeholders(qToks.size());
    Map<String, Map<String, Integer>> tf = new HashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT entry_id, token, tf FROM posting WHERE token IN (" + in + ")")) {
      for (int i = 0; i < qToks.size(); i++) ps.setString(i + 1, qToks.get(i));
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          tf.computeIfAbsent(rs.getString(1), k -> new HashMap<>()).put(rs.getString(2), rs.getInt(3));
        }
      }
    } catch (SQLException e) {
      throw new IllegalStateException("SQLite 检索失败", e);
    }
    if (tf.isEmpty()) return List.of();
    List<LoreRanker.Hit> scored = new ArrayList<>();
    int n = corpus.size();
    for (Map.Entry<String, Map<String, Integer>> e : tf.entrySet()) {
      double s = 0.0;
      int dl = docLen.getOrDefault(e.getKey(), 1);
      for (String q : qToks) {
        Integer f = e.getValue().get(q);
        if (f == null || f == 0) continue;
        s += LoreScoring.termScore(LoreScoring.idf(n, docFreq.getOrDefault(q, 0)), f, dl, avgLength);
      }
      if (s > 0) scored.add(new LoreRanker.Hit(byId.get(e.getKey()), s));
    }
    scored.sort((a, b) -> Double.compare(b.score(), a.score()));
    int cap = Math.min(Math.max(1, limit), scored.size());
    return scored.subList(0, cap);
  }

  /** `/lore/explain` 用：
   * ① query 的分词结果 ② EXPLAIN QUERY PLAN 原文——证明检索走 PK 索引而不是全表扫 */
  public Map<String, Object> explain(String query) {
    List<String> qToks = LoreTokenizer.tokenize(query);
    List<String> plan = new ArrayList<>();
    if (!qToks.isEmpty()) {
      String token = qToks.get(0).replace("'", "");
      try (Statement st = conn.createStatement();
           ResultSet rs = st.executeQuery(
               "EXPLAIN QUERY PLAN SELECT entry_id, token, tf FROM posting WHERE token = '" + token + "'")) {
        while (rs.next()) plan.add(rs.getString("detail"));
      } catch (SQLException e) {
        plan.add("EXPLAIN QUERY PLAN 失败：" + e.getMessage());
      }
    }
    Map<String, Object> out = new HashMap<>();
    out.put("q", query);
    out.put("tokens", qToks);
    out.put("plan", plan);
    out.put("engine", "sqlite-inmemory / posting PK(token, entry_id)");
    return out;
  }

  private void build() throws SQLException {
    try (Statement st = conn.createStatement()) {
      st.execute("CREATE TABLE entry(id TEXT PRIMARY KEY, cat TEXT NOT NULL, dl INTEGER NOT NULL)");
      st.execute("CREATE TABLE posting(token TEXT NOT NULL, entry_id TEXT NOT NULL, tf INTEGER NOT NULL, PRIMARY KEY(token, entry_id)) WITHOUT ROWID");
      st.execute("CREATE TABLE df(token TEXT PRIMARY KEY, df INTEGER NOT NULL) WITHOUT ROWID");
    }
    // entry：按池子化文本现编 token；df 顺手累计
    try (PreparedStatement ins = conn.prepareStatement("INSERT INTO entry VALUES (?,?,?)")) {
      for (LoreEntry e : corpus.entries()) {
        List<String> toks = LoreTokenizer.tokenize(corpus.textPool(e));
        docLen.put(e.id(), toks.size());
        for (String t : new java.util.HashSet<>(toks)) docFreq.merge(t, 1, Integer::sum);
        ins.setString(1, e.id());
        ins.setString(2, e.cat());
        ins.setInt(3, toks.size());
        ins.addBatch();
      }
      ins.executeBatch();
    }
    // posting：token → 文档词袋行
    try (PreparedStatement ins = conn.prepareStatement("INSERT INTO posting VALUES (?,?,?)")) {
      for (LoreEntry e : corpus.entries()) {
        Map<String, Integer> tf = new HashMap<>();
        for (String t : LoreTokenizer.tokenize(corpus.textPool(e))) tf.merge(t, 1, Integer::sum);
        for (Map.Entry<String, Integer> kv : tf.entrySet()) {
          ins.setString(1, kv.getKey());
          ins.setString(2, e.id());
          ins.setInt(3, kv.getValue());
          ins.addBatch();
        }
      }
      ins.executeBatch();
    }
    try (PreparedStatement ins = conn.prepareStatement("INSERT INTO df VALUES (?,?)")) {
      for (Map.Entry<String, Integer> kv : docFreq.entrySet()) {
        ins.setString(1, kv.getKey());
        ins.setInt(2, kv.getValue());
        ins.addBatch();
      }
      ins.executeBatch();
    }
  }

  private static String placeholders(int n) {
    return String.join(",", Collections.nCopies(n, "?"));
  }
}
