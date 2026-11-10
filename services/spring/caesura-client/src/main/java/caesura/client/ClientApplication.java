package caesura.client;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * caesura-client —— Spring Cloud Config Client 示例服务。
 *
 * <p>它不做判定，只负责**编排**：从 `caesura-config` 配置服务器拉取配置，
 * 向 `caesura-registry` 注册自己，暴露 `/actuator/health` 供 Node 侧探针读取。
 * 所有业务阈值与判定仍由 Node 侧负责（见 {@code scripts/import-target-rules.mjs}
 * 与 {@code scripts/spring-family-rules.mjs} 的守门判据）。
 */
@SpringBootApplication
@EnableDiscoveryClient
public class ClientApplication {
  public static void main(String[] args) {
    SpringApplication.run(ClientApplication.class, args);
  }
}
