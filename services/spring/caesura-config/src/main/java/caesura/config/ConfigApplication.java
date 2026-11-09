package caesura.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.config.server.EnableConfigServer;

/**
 * caesura-config —— Spring Cloud Config Server（KI-422）。
 *
 * <p>它是**门名册与阈值的唯一出处**：那份名册（{@code services/spring/config/caesura-gates.yml}）
 * 由它原样供出去，谁想要哪一道门、那一道门的上限是多少，都得来这里取。
 *
 * <p>用 native 后端（读本地目录）而不是 git 后端：这一族是**本地开发/CI 用**的，
 * git 后端要一份真仓库与凭据，而名册本来就在这个仓里 —— 那份文件本身就是它的副本。
 */
@SpringBootApplication
@EnableConfigServer
public class ConfigApplication {

    public static void main(String[] args) {
        SpringApplication.run(ConfigApplication.class, args);
    }
}
