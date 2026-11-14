package caesura.lore;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

/**
 * 缓存门面：**手动** get/put（不走注解），这样命中率与未命中都住在自己手里——
 * /lore/stats 能说出「这个服务快在哪儿、慢在哪儿」，而不是把缓存当黑盒。
 *
 * <p>缓存的是**序列化后的 JSON 载荷**（不是对象），两种后端（ConcurrentMap / Redis）
 * 行为一致，也避免 Jackson 在热点路径上重复序列化 48 条文本。
 */
@Component
public class LoreCache {

  private final CacheManager cacheManager;
  private final AtomicLong hits = new AtomicLong();
  private final AtomicLong misses = new AtomicLong();
  private final AtomicLong searches = new AtomicLong();

  public LoreCache(CacheManager cacheManager) {
    this.cacheManager = cacheManager;
  }

  public record Stats(long cacheHits, long cacheMisses, long searches, double hitRate) {}

  /** 从命名空间读一个载荷；没有就从 supplier 算一个并放回去 */
  public String getOrCompute(String namespace, String key, Supplier<String> compute) {
    Cache cache = cacheManager.getCache(namespace);
    if (cache != null) {
      String cached = cache.get(key, String.class);
      if (cached != null) {
        hits.incrementAndGet();
        return cached;
      }
      misses.incrementAndGet();
      String fresh = compute.get();
      cache.put(key, fresh);
      return fresh;
    }
    // 没有配置缓存实现也得能跑——慢一点，但不许静默报错
    return compute.get();
  }

  public void noteSearch() {
    searches.incrementAndGet();
  }

  public Stats stats() {
    long h = hits.get();
    long m = misses.get();
    double rate = (h + m) == 0 ? 0.0 : (double) h / (h + m);
    return new Stats(h, m, searches.get(), rate);
  }

  public String backend() {
    return cacheManager.getClass().getSimpleName();
  }
}
