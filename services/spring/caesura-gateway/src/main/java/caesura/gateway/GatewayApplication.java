package caesura.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * caesura-gateway —— Spring Cloud Gateway（KI-422）。
 *
 * <p>它是这一族对外的**唯一入口**：{@code /gate/**} 走负载均衡到 caesura-gate，
 * {@code /report/**} 到 caesura-report。路由表在 {@code application.yml} 里（YAML 不是判定，
 * 是拓扑 —— 路由到谁，那是谁的事）。
 */
@SpringBootApplication
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
