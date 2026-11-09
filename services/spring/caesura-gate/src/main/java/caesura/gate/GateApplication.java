package caesura.gate;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * caesura-gate —— 门执行器（KI-422）。
 *
 * <p>它从**配置服务器**取门名册（{@code services/spring/config/caesura-gates.yml}），
 * 然后**只**按名册里那几格去调用仓库既有的 npm／node 入口。
 *
 * <p>配置服务器拿不到 ⇒ 这个服务**起不来**（{@code spring.config.import} 不是 optional）。
 * 那是对的：一个没有名册的门执行器不是门执行器，它只是一台会假装自己知道该跑什么的机器。
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class GateApplication {

    public static void main(String[] args) {
        SpringApplication.run(GateApplication.class, args);
    }
}
