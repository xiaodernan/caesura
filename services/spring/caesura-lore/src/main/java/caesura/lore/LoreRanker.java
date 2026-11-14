package caesura.lore;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * BM25 排序器（k1=1.5 · b=0.75，标题权重 ×3 ≈ BM25F-lite）。
 *
 * <p>与前端 `codex/index.html` 的算法同构：中文 bigram + 英文词元（len ≥ 2）。
 * 词表在构造时构建一次（df 表），之后每次 search 只做打分——O(文档数 × 查询词数)。
 */
@Component
public class LoreRanker {

  public record Hit(LoreEntry entry, double score) {}

  private static final double K1 = 1.5;
  private static final double B = 0.75;

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
      // 文本池 = 标题 ×3（BM25F-lite）+ 正文（双语同池——两个读者进的是同一个世界）
      String text = e.title().zh() + ' ' + e.title().en() + ' '
          + e.title().zh() + ' ' + e.title().en() + ' '
          + e.title().zh() + ' ' + e.title().en() + ' '
          + e.body().zh() + ' ' + e.body().en();
      List<String> toks = tokenize(text);
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
    List<String> qToks = tokenize(query);
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
    return Math.log(1.0 + (entries.size() - df + 0.5) / (df + 0.5));
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
      s += idf(q) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (dl / avgLength)));
    }
    return s;
  }

  /** 中文 bigram + 英文词元（len ≥ 2）；与前端 codex/index.html 同口径——同一世界、同一分词 */
  static List<String> tokenize(String raw) {
    String text = raw == null ? "" : raw;
    List<String> out = new ArrayList<>();
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      if (Character.isLetter(ch) || Character.isDigit(ch)) {
        if (Character.UnicodeScript.of(ch) == Character.UnicodeScript.HAN) {
          out.add(String.valueOf(ch));
          if (i + 1 < text.length()) {
            char next = text.charAt(i + 1);
            if (Character.UnicodeScript.of(next) == Character.UnicodeScript.HAN) {
              out.add(text.substring(i, i + 2));
            }
          }
        }
      }
    }
    for (String latin : text.toLowerCase().split("[^a-z0-9]+")) {
      if (latin.length() >= 2) out.add(latin);
    }
    return out;
  }
}
