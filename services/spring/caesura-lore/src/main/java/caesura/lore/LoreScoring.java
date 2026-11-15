package caesura.lore;

/**
 * BM25 打分共享真值（k1=1.5 · b=0.75）—— 内存路（`LoreRanker`）与 SQLite 路
 * （`LoreSqliteIndex`）必须吃同一碗饭，否则「两种引擎对照」先输在判分台不一致。
 */
public final class LoreScoring {

  private LoreScoring() {}

  public static final double K1 = 1.5;
  public static final double B = 0.75;

  /** 标准 BM25 idf：log(1 + (N - df + 0.5) / (df + 0.5)) */
  public static double idf(int corpusSize, int docFreq) {
    return Math.log(1.0 + (corpusSize - docFreq + 0.5) / (docFreq + 0.5));
  }

  /** 单条打分项：idf × tf*(k1+1) / (tf + k1*(1 - b + b*dl/avgdl)) */
  public static double termScore(double idf, int tf, int dl, double avgLength) {
    double norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (dl / Math.max(1.0, avgLength))));
    return idf * norm;
  }
}
