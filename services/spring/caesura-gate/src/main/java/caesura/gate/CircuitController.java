package caesura.gate;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 熔断那一层的账（KI-441）。
 *
 * <p>**为什么要一个专门的读数面**：在这之前，「现在这道门是什么状态」只能从
 * **下一趟的判决**里反推——「上一趟被拒、这一趟放行 ⇒ 大概是冷却过去了、放了一道试探」。
 * 半开那一档因此从来没有被**读**过，只被动过。而熔断真正要证的三件事全都不是判决能带的：
 *
 * <ul>
 *   <li>连着坏了几道（{@code consecutiveFailures}）——阈值是不是真按那道门自己记的；</li>
 *   <li>试探在不在跑（{@code trialInFlight}）——并发打两下时，第二道必须被拒；</li>
 *   <li>冷却还差多少毫秒（{@code remainingMs}）——冷却是真的在走，不是一个常数。</li>
 * </ul>
 *
 * <p>这三个数在这里都是**现读的账**：状态从内存里读，两个参数从 {@link GateProperties} 读
 * （主人是 {@code caesura-gate} 自己的 {@code application.yml}，Java 一个字都不写死）。
 * 这个面**只读**：它不推进状态机（看 {@link CircuitBreaker#snapshot(String)} 那段为什么重要）。
 */
@RestController
@RequestMapping("/circuit")
public class CircuitController {

    private final GateProperties properties;
    private final CircuitBreaker breaker;

    public CircuitController(GateProperties properties, CircuitBreaker breaker) {
        this.properties = properties;
        this.breaker = breaker;
    }

    /** 把一份账摆成人读的格子（键名与 {@link CircuitBreaker.Snapshot} 的字段一一对应） */
    private static Map<String, Object> row(CircuitBreaker.Snapshot s) {
        return Map.of(
                "id", s.gateId(),
                "state", s.state().name(),
                "consecutiveFailures", s.consecutiveFailures(),
                "trialInFlight", s.trialInFlight(),
                "openedAtMs", s.openedAtMs(),
                "cooldownMs", s.cooldownMs(),
                "remainingMs", s.remainingMs());
    }

    /** 名册里每一道门的账，连两个编排参数一起（参数的值来自 YAML，这里只搬运） */
    @GetMapping
    public Map<String, Object> all() {
        List<Map<String, Object>> rows = properties.getGates().stream()
                .map(g -> row(breaker.snapshot(g.getId())))
                .toList();
        return Map.of(
                "failureThreshold", properties.getCircuit().getFailureThreshold(),
                "cooldownSec", properties.getCircuit().getCooldownSec(),
                "count", rows.size(),
                "gates", rows);
    }

    /** 某一格门；名册里没有就说没有（404 ＋ 已知的那几格，与 {@code GET /gates/{id}} 同一形状） */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> one(@PathVariable("id") String id) {
        return properties.getGates().stream()
                .filter(g -> g.getId().equals(id))
                .findFirst()
                .map(g -> ResponseEntity.ok(row(breaker.snapshot(g.getId()))))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "not_found", "id", id,
                                "known", properties.getGates().stream().map(g -> g.getId()).toList())));
    }
}
