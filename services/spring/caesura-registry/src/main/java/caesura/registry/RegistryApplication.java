package caesura.registry;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.netflix.eureka.server.EnableEurekaServer;

/**
 * caesura-registry —— Eureka Server（KI-422）。
 *
 * <p>它只回答一件事：<b>谁活着、地址在哪</b>。它不读仓库的任何一份数据、不跑任何一道门、
 * 也不持有任何阈值 ⇒ 把它停掉，除了「别人找不到彼此」之外，什么都不会坏。
 */
@SpringBootApplication
@EnableEurekaServer
public class RegistryApplication {

    public static void main(String[] args) {
        SpringApplication.run(RegistryApplication.class, args);
    }
}
