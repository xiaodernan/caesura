package caesura.gate;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * caesura-gate 的健康指示器。
 *
 * <p>Node 侧探针读取 {@code /actuator/health}（端口由 {@code GateProperties} 的管理端口决定）。
 * 返回 UP 表示门执行器已起、熔断器已就绪。这里**不报告业务阈值**（熔断上限、重试次数等）——
 * 那些由 Node 侧的 {@code scripts/spring-family-rules.mjs} 统一拍板，Spring 家族只负责编排。
 */
@Component
public class GateHealthIndicator implements HealthIndicator {

    private final GateProperties properties;

    public GateHealthIndicator(GateProperties properties) {
        this.properties = properties;
    }

    @Override
    public Health health() {
        return Health.up()
            .withDetail("service", "caesura-gate")
            .withDetail("role", "gate-executor")
            .withDetail("circuitBreaker", "enabled")
            .withDetail("judgmentBy", "node")
            .withDetail("configSource", "config-server:caesura-gates")
            .build();
    }
}
