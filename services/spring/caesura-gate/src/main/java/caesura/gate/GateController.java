package caesura.gate;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * caesura-gate 的对外面（KI-422）。
 *
 * <p>三个端点，形状与 {@code services/dev-gateway.mjs} 那族一致：只读为主、读数自带理由、
 * 读不到就说读不到（不拿空集冒充干净）。
 *
 * <ul>
 *   <li>{@code GET  /gate/gates} —— 门名册（**从配置服务器来的那份**，不是这里编的）</li>
 *   <li>{@code GET  /gate/gates/{id}} —— 名册里的某一格</li>
 *   <li>{@code POST /gate/gates/{id}/run} —— 跑一道门，给出判决</li>
 * </ul>
 */
@RestController
@RequestMapping("/gates")
public class GateController {

    private final GateProperties properties;
    private final GateRunner runner;

    public GateController(GateProperties properties, GateRunner runner) {
        this.properties = properties;
        this.runner = runner;
    }

    /** 门名册：连同「这份名册是从哪儿来的」一起摆上来（来源＝配置服务器） */
    @GetMapping
    public Map<String, Object> gates() {
        List<Map<String, Object>> rows = properties.getGates().stream()
                .map(g -> Map.<String, Object>of(
                        "id", g.getId(),
                        "family", g.getFamily(),
                        "command", g.getCommand() + " " + String.join(" ", g.getArgs()),
                        "timeoutSec", g.getTimeoutSec(),
                        "blocking", g.isBlocking()))
                .toList();
        return Map.of(
                "source", "config-server:caesura-gates",
                "repoRoot", properties.getRepoRoot(),
                "count", rows.size(),
                "gates", rows);
    }

    /** 名册里的某一格；读不到就说读不到（404 ＋ 已知的那几格） */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> gate(@PathVariable("id") String id) {
        return properties.getGates().stream()
                .filter(g -> g.getId().equals(id))
                .findFirst()
                .map(g -> ResponseEntity.ok(Map.<String, Object>of(
                        "id", g.getId(),
                        "family", g.getFamily(),
                        "command", g.getCommand() + " " + String.join(" ", g.getArgs()),
                        "timeoutSec", g.getTimeoutSec(),
                        "blocking", g.isBlocking())))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "not_found", "id", id,
                                "known", properties.getGates().stream().map(g -> g.getId()).toList())));
    }

    /** 跑一道门：命令原样跑，判决如实给 */
    @PostMapping("/{id}/run")
    public ResponseEntity<GateVerdict> run(@PathVariable("id") String id) {
        return properties.getGates().stream()
                .filter(g -> g.getId().equals(id))
                .findFirst()
                .map(g -> ResponseEntity.ok(runner.run(g)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).build());
    }
}
