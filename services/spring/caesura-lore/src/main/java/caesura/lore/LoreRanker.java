package caesura.lore;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * BM25 排序器（k1=1.5 · b=0.75，标题权重 ×3 ≈ BM25F-lite）—— 内存路。
 *
 * <p>与 SQLite 路（{@link LoreSqliteIndex}）吃同一碗 {@link LoreTokenizer} 与 {@link LoreScoring}：
 * 同一裁判判两条路，对照才有意义。
 */
@Component
public class LoreRanker {

  public record Hit(LoreEntry entry, double score) {}

  private final List<LoreEntry> entries;
  private final List<String>[] tokenized;
  private final Map<String, Integer> docFreq = new HashMap<>();
  private final double avgLength;

  @SuppressWarnings("unchecked")
  public LoreRanker(LoreCorpus corpus) {
    this.entries = corpus.entries();
    this.tokenized = new List[entries.size()];
    long total = 0;
    for (int i = 0; i < entries.size(); i++) {
      LoreEntry e = entries.get(i);
      List<String> toks = LoreTokenizer.tokenize(corpus.textPool(e));
      tokenized[i] = toks;
      total += toks.size();
      for (String t : new java.util.HashSet<>(toks)) {
        docFreq.merge(t, 1, Integer::sum);
      }
    }
    this.avgLength = entries.isEmpty() ? 1.0 : (double) total / entries.size();
  }

  public int corpusSize() {
    return entries.size();
  }

  public List<Hit> search(String query, int limit) {
    List<String> qToks = LoreTokenizer.tokenize(query);
    if (qToks.isEmpty()) return List.of();
    int n = entries.size();
    List<Hit> scored = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      double s = scoreDoc(i, qToks);
      if (s > 0) scored.add(new Hit(entries.get(i), s));
    }
    if (scored.isEmpty()) return List.of();
    scored.sort((a, b) -> Double.compare(b.score(), a.score()));
    int cap = Math.min(limit, scored.size());
    return scored.subList(0, cap);
  }

  private double idf(String term) {
    int df = docFreq.getOrDefault(term, 0);
    return LoreScoring.idf(entries.size(), df);
  }

  private double scoreDoc(int idx, List<String> qToks) {
    List<String> toks = tokenized[idx];
    Map<String, Integer> tf = new HashMap<>();
    for (String t : toks) tf.merge(t, 1, Integer::sum);
    double s = 0.0;
    double dl = toks.size();
    for (String q : qToks) {
      Integer f = tf.get(q);
      if (f == null || f == 0) continue;
      s += LoreScoring.termScore(idf(q), f, (int) dl, avgLength);
    }
    return s;
  }

}
