package caesura.report;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.context.annotation.Bean;
import org.springframework.web.client.RestTemplate;

/**
 * caesura-report —— 判决汇总（KI-422）。
 *
 * <p>它<b>不跑门</b>：它去问 caesura-gate「你有哪些门」「这一道跑出来是什么」，
 * 再把各道的判决汇成仓库既有 {@code finish()} 那套形状（kind／reds／total／ranFiles／
 * expectedFiles／redTitles／reportKept）。
 *
 * <p>汇总用<b>负载均衡</b>（Eureka 给地址）：这一族里没有哪一台机器知道别的机器在哪，
 * 名册在注册中心手里 —— 这正是「服务发现」那一族微服务真正的用处。
 */
@SpringBootApplication
public class ReportApplication {

    public static void main(String[] args) {
        SpringApplication.run(ReportApplication.class, args);
    }

    /**
     * 带负载均衡的 {@link RestTemplate}：{@code http://caesura-gate/…} 里的主机名由注册中心解析。
     */
    @Bean
    @LoadBalanced
    RestTemplate loadBalancedRestTemplate(RestTemplateBuilder builder) {
        return builder.build();
    }
}
