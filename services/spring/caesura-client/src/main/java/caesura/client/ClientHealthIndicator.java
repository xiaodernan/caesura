package caesura.client;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * caesura-client 的健康指示器。
 *
 * <p>Node 侧探针（{@code scripts/spring-health-check.mjs}）读取
 * {@code /actuator/health}，这条路返回 UP 表示服务已起、配置已拉取。
 * 它**不报告任何业务阈值**（熔断上限、粒子预算、画质档位等）——
 * 那些由 Node 侧的 {@code settings/Quality.ts} 与 {@code scripts/spring-family-rules.mjs}
 * 统一拍板，Spring 家族只负责编排/重试/熔断/报告。
 */
@Component
public class ClientHealthIndicator implements HealthIndicator {

  @Override
  public Health health() {
    return Health.up()
        .withDetail("service", "caesura-client")
        .withDetail("role", "config-client-demo")
        .withDetail("orchestrationOnly", true)
        .withDetail("judgmentBy", "node")
        .build();
  }
}
