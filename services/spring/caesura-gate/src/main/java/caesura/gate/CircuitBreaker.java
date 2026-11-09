package caesura.gate;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 每道门一个熔断器（KI-429）。
 *
 * <p><b>它不判定任何东西。</b>它只回答一个问题：<i>这一道门现在该不该起进程？</i>
 * 判「红不红」的仍然是 Node 侧那道命令的退出码；熔断器看到的是**那个退出码**，
 * 它自己从不对「什么算红」发表意见。
 *
 * <p><b>为什么要它</b>：这一族会同时起好几道门，而一道门挂住（不是红，是挂住）时，
 * 「再试一次」是最坏的反应——它把一个已经知道坏掉的东西再叫一遍，机器就永远回不来。
 * 熔断是**编排**这一层的活（和重试一样）：连着坏了几道就先把闸打开，
 * 冷却过去再放一道**试探**过去试探。判定权一行没搬进 Java。
 *
 * <p><b>参数住在哪</b>：连续失败几次开闸、冷却多久——这两个数是**编排参数**，
 * 住在 {@code caesura-gate} 自己的 {@code application.yml}（像重试参数那样），
 * <b>不在</b>配置服务器那份门名册里：名册只装**判定**（门 id／命令／上限／是否阻塞）。
 * Java 源码里不许再写一遍这两个数——那就是两个出处。
 *
 * <p><b>三态</b>（与 Resilience4j 的语义同形，但这里只有三个态，且不引第三方依赖）：
 * <ul>
 *   <li>{@code CLOSED}——正常，每一趟都起进程；</li>
 *   <li>{@code OPEN}——开闸，<b>不起进程</b>，直接回一个「熔断中」的判决；</li>
 *   <li>{@code HALF_OPEN}——冷却过去了，放<b>一道</b>试探过去：试探绿了就闭合，败了就重新开闸。</li>
 * </ul>
 */
@Component
public class CircuitBreaker {

    /** 熔断器的三个状态 */
    public enum State {
        /** 正常：每一趟都起进程 */
        CLOSED,
        /** 开闸：不再起进程（直回一个「熔断中」的判决） */
        OPEN,
        /** 半开：冷却过去了，放一道试探过去 */
        HALF_OPEN
    }

    /**
     * 「能不能跑」的判决。
     *
     * @param allowed 这一趟该不该起进程
     * @param state   问这一句时的状态
     * @param reason  人读的理由（判决里为什么是它）
     */
    public record Decision(boolean allowed, State state, String reason) {
    }

    /** 一道门一份的记账（每道门各记各的：一道门坏了不该拖累别的门） */
    private static final class Entry {
        private State state = State.CLOSED;
        private int consecutiveFailures;
        private long openedAtMs;
        private boolean trialInFlight;
    }

    private final GateProperties properties;
    private final LongSupplier clock;
    private final Map<String, Entry> entries = new ConcurrentHashMap<>();

    @Autowired
    public CircuitBreaker(GateProperties properties) {
        this(properties, System::currentTimeMillis);
    }

    /** 测试用：时钟可以换 ⇒ 冷却期不用真等（生产走上面那个构造器） */
    CircuitBreaker(GateProperties properties, LongSupplier clock) {
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * 起跑之前问一句：这一道门现在该不该起进程？
     *
     * @param gateId 门 id
     * @return 判决（永不为 null；「不该跑」也是一个判决）
     */
    public Decision beforeRun(String gateId) {
        int threshold = properties.getCircuit().getFailureThreshold();
        if (threshold <= 0) {
            // 熔断没开（阈值非正）⇒ 每趟都跑。这不是「默认值」，是「没开这个功能」。
            return new Decision(true, State.CLOSED, "熔断没开");
        }
        Entry entry = entries.computeIfAbsent(gateId, k -> new Entry());
        synchronized (entry) {
            if (entry.state == State.OPEN) {
                long elapsed = clock.getAsLong() - entry.openedAtMs;
                long cooldownMs = properties.getCircuit().getCooldownSec() * 1000L;
                if (elapsed >= cooldownMs) {
                    entry.state = State.HALF_OPEN;
                    entry.trialInFlight = true;
                    return new Decision(true, State.HALF_OPEN, "冷却过去了，放一道试探过去");
                }
                return new Decision(false, State.OPEN,
                        "还在冷却里（还差 " + (cooldownMs - elapsed) + " 毫秒）");
            }
            if (entry.state == State.HALF_OPEN) {
                if (entry.trialInFlight) {
                    return new Decision(false, State.HALF_OPEN, "试探还在跑，不放第二道");
                }
                entry.trialInFlight = true;
                return new Decision(true, State.HALF_OPEN, "放一道试探过去");
            }
            return new Decision(true, State.CLOSED, "正常");
        }
    }

    /**
     * 跑完回来记账：这一趟绿了没有？
     *
     * @param gateId 门 id
     * @param green  这一趟是不是绿（绿＝退出码 0；红／超时／起不来都算不绿）
     */
    public void afterRun(String gateId, boolean green) {
        int threshold = properties.getCircuit().getFailureThreshold();
        if (threshold <= 0) {
            return;
        }
        Entry entry = entries.computeIfAbsent(gateId, k -> new Entry());
        synchronized (entry) {
            if (green) {
                entry.consecutiveFailures = 0;
                entry.trialInFlight = false;
                entry.state = State.CLOSED;
                return;
            }
            entry.consecutiveFailures++;
            entry.trialInFlight = false;
            if (entry.state == State.HALF_OPEN || entry.consecutiveFailures >= threshold) {
                entry.state = State.OPEN;
                entry.openedAtMs = clock.getAsLong();
            }
        }
    }

    /** 现在这道门的状态（只读，不改变状态） */
    public State stateOf(String gateId) {
        Entry entry = entries.get(gateId);
        return entry == null ? State.CLOSED : entry.state;
    }
}
