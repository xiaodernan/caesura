package caesura.lore;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.CacheManager;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;

import java.time.Duration;

/**
 * caesura-lore —《止音纪元》世界谱后端（2026-11-15，KI-422 族的第八个成员）。
 *
 * <p>它只做三件事：把 jar 里打包的 48 条世界谱文本（/lore/codex）serve 出去、
 * 用 BM25 在内存里给「世界谱」排序（/lore/search）、把缓存命中率报出来（/lore/stats）。
 * <p>所有业务阈值与判定仍由 Node 侧（scripts/spring-family-rules.mjs）拍板；
 * Java 侧不读仓库任何数据表（jar 内快照与仓库同源，由 scripts/lore-codex-snapshot.mjs 生成），
 * 也不进玩家进程。
 */
@SpringBootApplication
@EnableDiscoveryClient
@EnableCaching
public class LoreApplication {

  public static void main(String[] args) {
    SpringApplication.run(LoreApplication.class, args);
  }

  /**
   * 缓存后端＝memory（默认）：零外部依赖，适合 CI 与本地；
   * 想切 Redis：`CAESURA_LORE_CACHE=redis`（+ SPRING_DATA_REDIS_HOST/PORT），条目带 10 分钟 TTL。
   */
  @Bean
  @ConditionalOnProperty(name = "caesura.lore.cache", havingValue = "memory", matchIfMissing = true)
  public CacheManager memoryCacheManager() {
    return new ConcurrentMapCacheManager("codex", "id", "search");
  }

  @Bean
  @ConditionalOnProperty(name = "caesura.lore.cache", havingValue = "redis")
  public CacheManager redisCacheManager(RedisConnectionFactory connectionFactory) {
    RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
        .entryTtl(Duration.ofMinutes(10))
        .computePrefixWith(name -> "lore:" + name + ":");
    return RedisCacheManager.builder(connectionFactory)
        .cacheDefaults(defaults)
        .initialCacheNames(java.util.Set.of("codex", "id", "search"))
        .build();
  }
}
