package caesura.gate;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * caesura-gate 的配置：**整份来自配置服务器**（{@code services/spring/config/caesura-gates.yml}）。
 *
 * <p>这里没有一行默认值是「阈值」—— {@code repoRoot} 是路径，{@code timeoutSec} 是从配置服务器
 * 取回来的上限，{@code blocking} 是「红了算不算这一族失败」的开关。
 *
 * <p>本类的字段名与 YAML 的键一一对应（relaxed binding：{@code timeout-sec} → {@code timeoutSec}）。
 * 名册里出现一个新字段而这里没有 ⇒ Spring 的绑定不会报错，那一格就被**悄悄丢掉**了；
 * 所以 {@code tests/unit/spring-family.test.ts} 另有一腿盯着「名册的每个键在 Java 里都有主人」。
 */
@ConfigurationProperties(prefix = "caesura")
public class GateProperties {

    /** 仓库根（门在这个目录里跑 {@code npm run …} / {@code node scripts/…}） */
    private String repoRoot = "..";

    /** 门名册：每一格的门 id、族、命令、上限、是否阻塞 */
    private List<Gate> gates = new ArrayList<>();

    /**
     * 熔断参数（KI-429）：连续失败几次开闸、冷却多久。
     *
     * <p>**编排参数**，住在 {@code caesura-gate} 自己的 {@code application.yml}——
     * 和重试参数一样，**不在**配置服务器那份门名册里：名册只装**判定**
     * （门 id／命令／参数表／上限／是否阻塞），编排参数塞进去会让「名册」这个词失去意思。
     *
     * <p>两个默认值都是「没开这个功能」（阈值非正 ⇒ 每趟都跑），**不是**阈值本身：
     * 真正的数只住在那一份 YAML 里，Java 源码里不许再写一遍。
     */
    private Circuit circuit = new Circuit();

    public String getRepoRoot() {
        return repoRoot;
    }

    public void setRepoRoot(String repoRoot) {
        this.repoRoot = repoRoot;
    }

    public List<Gate> getGates() {
        return gates;
    }

    public void setGates(List<Gate> gates) {
        this.gates = gates;
    }

    public Circuit getCircuit() {
        return circuit;
    }

    public void setCircuit(Circuit circuit) {
        this.circuit = circuit;
    }

    /** 熔断参数（两个数都住在 YAML 里，Java 只是把它们读出来用） */
    public static class Circuit {

        /** 连着坏几次就开闸；**非正 ⇒ 熔断没开**（不是阈值，是「没开」的记号） */
        private int failureThreshold = 0;

        /** 开闸之后冷静多少秒 */
        private long cooldownSec = 0;

        public int getFailureThreshold() {
            return failureThreshold;
        }

        public void setFailureThreshold(int failureThreshold) {
            this.failureThreshold = failureThreshold;
        }

        public long getCooldownSec() {
            return cooldownSec;
        }

        public void setCooldownSec(long cooldownSec) {
            this.cooldownSec = cooldownSec;
        }
    }

    /**
     * 一道门。
     *
     * <p>{@code timeoutSec} 是**阈值**：它住在配置服务器那一份 YAML 里，Java 只把它读出来用。
     * Java 侧一旦也写一个「兜底超时」，同一道判据就有了两个主人 ⇒ 那道门（spring-family.test.ts）
     * 盯着这件事：名册里的上限值不许在 Java 源码里再出现一遍。
     */
    public static class Gate {

        private String id = "";
        private String family = "";
        private String command = "";
        private List<String> args = new ArrayList<>();
        private int timeoutSec = 0;
        private boolean blocking = true;

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }

        public String getFamily() {
            return family;
        }

        public void setFamily(String family) {
            this.family = family;
        }

        public String getCommand() {
            return command;
        }

        public void setCommand(String command) {
            this.command = command;
        }

        public List<String> getArgs() {
            return args;
        }

        public void setArgs(List<String> args) {
            this.args = args;
        }

        public int getTimeoutSec() {
            return timeoutSec;
        }

        public void setTimeoutSec(int timeoutSec) {
            this.timeoutSec = timeoutSec;
        }

        public boolean isBlocking() {
            return blocking;
        }

        public void setBlocking(boolean blocking) {
            this.blocking = blocking;
        }
    }
}
