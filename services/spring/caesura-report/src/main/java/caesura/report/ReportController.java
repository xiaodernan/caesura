package caesura.report;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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

    /** 一族最多同时跑几道门——**编排参数**，从 YAML 读（KI-429） */
    private final int concurrency;

    private final AtomicReference<FamilyVerdict> last = new AtomicReference<>();

    public ReportController(RestTemplate rest,
            @Value("${caesura.report.retry-attempts}") int retryAttempts,
            @Value("${caesura.report.retry-delay-ms}") long retryDelayMs,
            @Value("${caesura.report.concurrency}") int concurrency) {
        this.rest = rest;
        this.retryAttempts = retryAttempts;
        this.retryDelayMs = retryDelayMs;
        this.concurrency = concurrency;
    }

    /** 门名册：转发到 caesura-gate（它那份才是从配置服务器来的） */
    @GetMapping("/roster")
    public Map<String, Object> roster() {
        Map<String, Object> body = withRetry(() -> rest.getForObject(GATE_SERVICE + "/gate/gates", Map.class));
        return body == null ? Map.of("error", "empty_roster", "why", "caesura-gate 回了一个空对象") : body;
    }

    /**
     * 跑完整族：汇总成判决。
     *
     * <p><b>有界并发</b>（KI-429）：一族里最重的几道门（整套测试、构建、HEAD 自证）
     * 逐道排队要等好几分钟；一起跑就快得多。但**并发度有上限**，而且那个上限
     * 住在 YAML 里（{@code caesura.report.concurrency}）——它是**编排参数**，
     * 不进配置服务器那份门名册（名册只装判定）。
     *
     * <p>每一道门**仍然只由 caesura-gate 跑**：这里只是把「问哪几道、怎么问」编排一下，
     * 判定权一行没搬过来。
     */
    @PostMapping("/family")
    public FamilyVerdict family() {
        Map<String, Object> rosterBody = withRetry(() -> rest.getForObject(GATE_SERVICE + "/gate/gates", Map.class));
        List<Map<String, Object>> roster = rosterBody == null ? null : (List<Map<String, Object>>) rosterBody.get("gates");
        if (roster == null) {
            roster = List.of();
        }

        long startedAt = System.currentTimeMillis();
        List<Map<String, Object>> verdicts = new ArrayList<>();
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, concurrency));
        try {
            List<Future<Map<String, Object>>> futures = new ArrayList<>();
            for (Map<String, Object> gate : roster) {
                futures.add(pool.submit(() -> runOne(gate)));
            }
            for (Future<Map<String, Object>> future : futures) {
                verdicts.add(unwrap(future));
            }
        } finally {
            pool.shutdown();
        }
        long wallMs = System.currentTimeMillis() - startedAt;

        List<String> redTitles = new ArrayList<>();
        int blockingReds = 0;
        for (int i = 0; i < verdicts.size(); i++) {
            Map<String, Object> verdict = verdicts.get(i);
            Map<String, Object> gate = i < roster.size() ? roster.get(i) : Map.of();
            String id = String.valueOf(verdict.get("id"));
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
                concurrency,
                wallMs,
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
                    .body(new FamilyVerdict("no-verdict", 0, 0, 0, 0, List.of(), false, 0, concurrency, 0, List.of()));
        }
        return ResponseEntity.ok(verdict);
    }

    /**
     * 跑一道门，拿它的判决。
     *
     * <p>跑不起来也是一个判决：起不来 ≠ 绿。
     */
    private Map<String, Object> runOne(Map<String, Object> gate) {
        String id = String.valueOf(gate.get("id"));
        Map<String, Object> verdict;
        try {
            verdict = withRetry(() -> rest.postForObject(GATE_SERVICE + "/gate/gates/" + id + "/run", null, Map.class));
        } catch (RuntimeException e) {
            return errorVerdict(id, "问不到 caesura-gate：" + e);
        }
        if (verdict == null) {
            return errorVerdict(id, "caesura-gate 回了一个空对象");
        }
        return verdict;
    }

    /** 从 future 里把判决取出来；future 自己炸了也是一个判决 */
    private Map<String, Object> unwrap(Future<Map<String, Object>> future) {
        try {
            return future.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return errorVerdict("(未知)", "被中断：" + e);
        } catch (ExecutionException e) {
            return errorVerdict("(未知)", "这一道门炸了：" + e.getCause());
        }
    }

    /** 起不来也是一个判决（它进 redTitles，也占 ranFiles 那一格） */
    private Map<String, Object> errorVerdict(String id, String why) {
        Map<String, Object> verdict = new LinkedHashMap<>();
        verdict.put("id", id);
        verdict.put("verdict", "error");
        verdict.put("exitCode", -1);
        verdict.put("stderrTail", why);
        return verdict;
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
