package caesura.lore;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * 健康自检：语料必须真的加载出来了（48 条、id 唯一），否则这一格不许报 UP——
 * 起不来 ≠ 绿。
 */
@Component
public class LoreHealthIndicator implements HealthIndicator {

  private final LoreCorpus corpus;

  public LoreHealthIndicator(LoreCorpus corpus) {
    this.corpus = corpus;
  }

  @Override
  public Health health() {
    if (corpus.size() > 0) {
      return Health.up().withDetail("entries", corpus.size()).build();
    }
    return Health.down().withDetail("reason", "lore/codex.json 为空").build();
  }
}
