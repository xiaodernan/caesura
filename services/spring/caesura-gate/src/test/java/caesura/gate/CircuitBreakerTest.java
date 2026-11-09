package caesura.gate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/**
 * 熔断状态机的真行为读数（KI-429）。
 *
 * <p>这一份是**行为**读数，不是「源码里写着什么」：冷却期用**可换的时钟**推进，
 * 所以这一族的状态机可以被完整地走一遍——开闸、冷却、放试探、试探绿了闭合、试探败了重开——
 * **不用真等**。
 *
 * <p><b>这里的数是这份测试自己挑的</b>（不是生产那一份阈值）：状态机该在**任意**阈值下
 * 都对，所以测试挑自己的数——顺带保证 Java 源码里不出现生产阈值那个字面量
 * （那是「唯一出处」那条门盯着的事：阈值只住那一份 YAML 里）。
 */
class CircuitBreakerTest {

    /** 一只手动推进的时钟（毫秒） */
    private final AtomicLong clock = new AtomicLong(0);

    /** 冷却期（秒）——这份测试自己挑的 */
    private static final long COOLDOWN_SEC = 45;

    private GateProperties props(int failureThreshold, long cooldownSec) {
        GateProperties properties = new GateProperties();
        properties.getCircuit().setFailureThreshold(failureThreshold);
        properties.getCircuit().setCooldownSec(cooldownSec);
        return properties;
    }

    private CircuitBreaker breaker(int failureThreshold) {
        return new CircuitBreaker(props(failureThreshold, COOLDOWN_SEC), clock::get);
    }

    /** 推进时钟：越过冷却期 */
    private void passCooldown() {
        clock.addAndGet(COOLDOWN_SEC * 1000L);
    }

    @Test
    void belowThresholdKeepsRunning() {
        CircuitBreaker breaker = breaker(2);
        // 失败次数**还没到**阈值（1 < 2）⇒ 仍然闭合，仍然起进程
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        assertEquals(CircuitBreaker.State.CLOSED, breaker.stateOf("g"));
        assertTrue(breaker.beforeRun("g").allowed());
    }

    @Test
    void opensAfterThresholdConsecutiveFailures() {
        CircuitBreaker breaker = breaker(2);
        for (int i = 0; i < 2; i++) {
            breaker.beforeRun("g");
            breaker.afterRun("g", false);
        }
        assertEquals(CircuitBreaker.State.OPEN, breaker.stateOf("g"));
    }

    @Test
    void openCircuitRefusesToRun() {
        CircuitBreaker breaker = breaker(1);
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        CircuitBreaker.Decision decision = breaker.beforeRun("g");
        assertFalse(decision.allowed());
        assertEquals(CircuitBreaker.State.OPEN, decision.state());
    }

    @Test
    void cooldownLetsExactlyOneTrialThrough() {
        CircuitBreaker breaker = breaker(1);
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        passCooldown();
        CircuitBreaker.Decision trial = breaker.beforeRun("g");
        assertTrue(trial.allowed());
        assertEquals(CircuitBreaker.State.HALF_OPEN, trial.state());
        // 试探还在跑的时候不许放第二道
        assertFalse(breaker.beforeRun("g").allowed());
    }

    @Test
    void successfulTrialClosesTheCircuit() {
        CircuitBreaker breaker = breaker(1);
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        passCooldown();
        breaker.beforeRun("g");
        breaker.afterRun("g", true);
        assertEquals(CircuitBreaker.State.CLOSED, breaker.stateOf("g"));
        assertTrue(breaker.beforeRun("g").allowed());
    }

    @Test
    void failedTrialReopensTheCircuit() {
        CircuitBreaker breaker = breaker(1);
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        passCooldown();
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        assertEquals(CircuitBreaker.State.OPEN, breaker.stateOf("g"));
        assertFalse(breaker.beforeRun("g").allowed());
    }

    @Test
    void aGreenRunResetsTheFailureCount() {
        CircuitBreaker breaker = breaker(2);
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        breaker.beforeRun("g");
        breaker.afterRun("g", true);
        breaker.beforeRun("g");
        breaker.afterRun("g", false);
        assertEquals(CircuitBreaker.State.CLOSED, breaker.stateOf("g"));
    }

    @Test
    void breakerIsOffWhenThresholdIsNotPositive() {
        CircuitBreaker breaker = breaker(0);
        for (int i = 0; i < 10; i++) {
            assertTrue(breaker.beforeRun("g").allowed());
            breaker.afterRun("g", false);
        }
        assertEquals(CircuitBreaker.State.CLOSED, breaker.stateOf("g"));
    }

    @Test
    void eachGateHasItsOwnBreaker() {
        CircuitBreaker breaker = breaker(1);
        breaker.beforeRun("g1");
        breaker.afterRun("g1", false);
        assertFalse(breaker.beforeRun("g1").allowed());
        // 另一道门不该被拖累
        assertTrue(breaker.beforeRun("g2").allowed());
    }
}
