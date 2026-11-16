package caesura.lore;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * 启动预热：Context 就绪后把两个 codex 载荷（zh/en）直接放进缓存——
 * 首个真实用户请求不付冷启动代价（与 `warmupPrefix` 给 LLM 做烤热是同一条纪律：首调必 miss）。
 *
 * <p>这不是开机必请的外部依赖——两个 payload 都是纯内存计算（N 条文本的 JSON 序列化，条数随快照增长，不在本文件钉死），
 * 构建期一次性付掉，测压路上再也不欠。</p>
 */
@Component
public class LoreWarmup implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(LoreWarmup.class);

  private final LoreController controller;

  public LoreWarmup(LoreController controller) {
    this.controller = controller;
  }

  @Override
  public void run(ApplicationArguments args) {
    long t0 = System.nanoTime();
    try {
      controller.warmCodexCache();
      double ms = (System.nanoTime() - t0) / 1_000_000.0;
      log.info("[lore] codex cache warmed (zh + en) in {} ms", String.format("%.2f", ms));
    } catch (RuntimeException e) {
      // 预热失败不许影响服务起来——真实请求会各自算、且会记账（degradedRequests）
      log.warn("[lore] codex cache warm failed (service still serves, requests compute lazily): {}", e.toString());
    }
  }
}
