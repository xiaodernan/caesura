package caesura.lore;

import java.util.ArrayList;
import java.util.List;

/**
 * 分词器（中文 bigram + 英文词元 len ≥ 2）—— 与前端 codex/index.html 同口径，
 * 也是 SQLite 词袋索引的唯一出处（`LoreSqliteIndex` 用它把每条文本切成 posting 行）。
 * 同一套分词保证「内存 BM25」与「SQLite 词袋 BM25」的对照是**同一裁判**在判两条路，
 * 不是两个裁判的两个路——否则对比键本身先失了效。
 */
public final class LoreTokenizer {

  private LoreTokenizer() {}

  /** 中文 bigram + 英文词元（len ≥ 2） */
  public static List<String> tokenize(String raw) {
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
