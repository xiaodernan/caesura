package caesura.report;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * caesura-report 的健康指示器。
 *
 * <p>Node 侧探针读取 {@code /actuator/health}。返回 UP 表示汇总服务已起、
 * 门执行结果已订阅。这里**不报告业务阈值**——汇报的「门红多少道」是 Node 侧
 * {@code scripts/phase-status.mjs} 的事，Spring 家族只负责编排与转发。
 */
@Component
public class ReportHealthIndicator implements HealthIndicator {

    @Override
    public Health health() {
        return Health.up()
            .withDetail("service", "caesura-report")
            .withDetail("role", "gate-verdict-collector")
            .withDetail("judgmentBy", "node")
            .build();
    }
}
