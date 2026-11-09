package caesura.report;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

/**
 * caesura-report 的对外面（KI-422）。
 *
 * <ul>
 *   <li>{@code GET  /report/roster}  —— 门名册（问 caesura-gate 要，不是这里编的）</li>
 *   <li>{@code POST /report/family}  —— 跑完整族，汇总成判决</li>
 *   <li>{@code GET  /report/verdict} —— 上一趟的汇总判决（没有就 409，不拿空对象冒充）</li>
 * </ul>
 */
@RestController
public class ReportController {

    /** caesura-gate 的地址靠注册中心解析（{@code @LoadBalanced}）；这里是服务名，不是门 id，也不是阈值 */
    private static final String GATE_SERVICE = "http://caesura-gate";

    private final RestTemplate rest;

    /** 「问不到就重试」的几与间隔——**编排参数**，从 YAML 读（住配置，不住代码） */
    private final int retryAttempts;
    private final long retryDelayMs;

    private final AtomicReference<FamilyVerdict> last = new AtomicReference<>();

    public ReportController(RestTemplate rest,
            @Value("${caesura.report.retry-attempts}") int retryAttempts,
            @Value("${caesura.report.retry-delay-ms}") long retryDelayMs) {
        this.rest = rest;
        this.retryAttempts = retryAttempts;
        this.retryDelayMs = retryDelayMs;
    }

    /** 门名册：转发到 caesura-gate（它那份才是从配置服务器来的） */
    @GetMapping("/roster")
    public Map<String, Object> roster() {
        Map<String, Object> body = withRetry(() -> rest.getForObject(GATE_SERVICE + "/gate/gates", Map.class));
        return body == null ? Map.of("error", "empty_roster", "why", "caesura-gate 回了一个空对象") : body;
    }

    /** 跑完整族：逐道问 caesura-gate，然后汇总 */
    @PostMapping("/family")
    @SuppressWarnings("unchecked")
    public FamilyVerdict family() {
        Map<String, Object> rosterBody = withRetry(() -> rest.getForObject(GATE_SERVICE + "/gate/gates", Map.class));
        List<Map<String, Object>> roster = rosterBody == null ? null : (List<Map<String, Object>>) rosterBody.get("gates");
        if (roster == null) {
            roster = List.of();
        }

        List<Map<String, Object>> verdicts = new ArrayList<>();
        List<String> redTitles = new ArrayList<>();
        int blockingReds = 0;

        for (Map<String, Object> gate : roster) {
            String id = String.valueOf(gate.get("id"));
            Map<String, Object> verdict;
            try {
                verdict = withRetry(() -> rest.postForObject(GATE_SERVICE + "/gate/gates/" + id + "/run", null, Map.class));
            } catch (RuntimeException e) {
                // 跑不起来也是一个判决：起不来 ≠ 绿。
                verdict = new LinkedHashMap<>();
                verdict.put("id", id);
                verdict.put("verdict", "error");
                verdict.put("exitCode", -1);
                verdict.put("stderrTail", "问不到 caesura-gate：" + e);
            }
            if (verdict == null) {
                verdict = new LinkedHashMap<>();
                verdict.put("id", id);
                verdict.put("verdict", "error");
                verdict.put("exitCode", -1);
                verdict.put("stderrTail", "caesura-gate 回了一个空对象");
            }
            verdicts.add(verdict);
            if (!"green".equals(String.valueOf(verdict.get("verdict")))) {
                redTitles.add(id + ": " + verdict.get("verdict"));
                if (Boolean.TRUE.equals(gate.get("blocking"))) {
                    blockingReds++;
                }
            }
        }

        FamilyVerdict verdict = new FamilyVerdict(
                blockingReds == 0 ? "green" : "red",
                redTitles.size(),
                roster.size(),
                verdicts.size(),
                roster.size(),
                redTitles,
                false,
                blockingReds,
                verdicts);
        last.set(verdict);
        return verdict;
    }

    /** 上一趟的判决；还没有就 409（不拿空对象冒充「跑过了而且全绿」） */
    @GetMapping("/verdict")
    public ResponseEntity<FamilyVerdict> verdict() {
        FamilyVerdict verdict = last.get();
        if (verdict == null) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(new FamilyVerdict("no-verdict", 0, 0, 0, 0, List.of(), false, 0, List.of()));
        }
        return ResponseEntity.ok(verdict);
    }

    /**
     * 问一次，**问不到就再问**。
     *
     * <p>为什么需要：负载均衡的实例表是**异步**从注册中心拉来的 —— 刚起的那一瞬间，
     * 「本地还没有 caesura-gate」是常态而不是故障。把它当故障报出来是假警报；
     * 当成成功（拿空结果继续）则是谎。**重试就是「编排」这一层的活**（Java 侧该干的活之一）。
     *
     * @param call 一次调用
     * @return 那次调用的结果
     */
    private <T> T withRetry(Supplier<T> call) {
        RuntimeException lastError = null;
        for (int attempt = 1; attempt <= retryAttempts; attempt++) {
            try {
                return call.get();
            } catch (RuntimeException e) {
                lastError = e;
                if (attempt < retryAttempts) {
                    try {
                        Thread.sleep(retryDelayMs);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw e;
                    }
                }
            }
        }
        throw lastError;
    }
}
