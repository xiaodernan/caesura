package caesura.report;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 真人行为「真实上报」通道（KI-720）。
 *
 * <p>与 admin/data.js 那份固定种子的模拟队列是两回事：这里只收浏览器主动送来的匿名事件，
 * 逐行追加到 JSONL，然后按天现算聚合。玩家进程默认不开启上报；开关在浏览器本地，
 * 且**只在用户显式打开时**才会发一个网络请求。
 *
 * <p>纪律：
 * <ol>
 *   <li>只收白名单字段（type/path/q/session），不收 referrer、不收正文、不收任何身份信息；</li>
 *   <li>单行上限 4 KiB，超出直接拒收，防止把日志当垃圾场；</li>
 *   <li>每 IP 每秒最多 30 条，超出 429 —— 压力测试里这也是一道真实限流；</li>
 *   <li>读不到文件或没有事件时如实回 {@code cohortKind:"live", events:0}，不拿模拟数据冒充；</li>
 *   <li>这是一台本地开发用的只追加端点，不声称是公网埋点服务。</li>
 * </ol>
 */
@RestController
@CrossOrigin(origins = "*")
public class LiveTelemetryController {

    private static final int MAX_BODY_BYTES = 4096;
    private static final int MAX_EVENTS_PER_SEC = 30;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    /** 每条事件都会经过这道白名单；不在表里的键一律丢掉。 */
    private static final List<String> FIELDS = List.of("type", "path", "q", "session");

    private final Path store;
    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    public LiveTelemetryController(
            @Value("${caesura.report.live-events-path:data/live-events.jsonl}") String path) {
        this.store = Paths.get(path);
    }

    /** 匿名事件入口。返回 202 表示「收下了」，不回显内容。 */
    @PostMapping("/live/events")
    public ResponseEntity<Map<String, Object>> collect(@RequestBody Map<String, Object> body,
            jakarta.servlet.http.HttpServletRequest request) {
        String ip = String.valueOf(request.getRemoteAddr());
        long now = System.currentTimeMillis();
        Bucket bucket = buckets.computeIfAbsent(ip, k -> new Bucket());
        if (now > bucket.resetAt) {
            synchronized (bucket) {
                if (now > bucket.resetAt) {
                    bucket.resetAt = now + 1000;
                    bucket.count.set(0);
                }
            }
        }
        if (bucket.count.incrementAndGet() > MAX_EVENTS_PER_SEC) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("ok", false, "why", "rate_limited"));
        }
        try {
            String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body);
            if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BODY_BYTES) {
                return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                        .body(Map.of("ok", false, "why", "body_too_large"));
            }
        } catch (IOException e) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "why", "bad_json"));
        }

        String type = String.valueOf(body.getOrDefault("type", "")).toLowerCase();
        if (type.isEmpty() || type.length() > 32 || !type.matches("[a-z0-9_]+")) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "why", "bad_type"));
        }

        Map<String, Object> clean = new LinkedHashMap<>();
        clean.put("at", System.currentTimeMillis());
        for (String key : FIELDS) {
            Object v = body.get(key);
            if (v == null) continue;
            String s = String.valueOf(v);
            // 路径与 session 都截短；不留下任何可以拼出身份的字段。
            clean.put(key, s.length() > 96 ? s.substring(0, 96) : s);
        }

        Path parent = store.toAbsolutePath().getParent();
        try {
            if (parent != null) Files.createDirectories(parent);
            synchronized (this) {
                try (BufferedWriter w = Files.newBufferedWriter(store, StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
                    w.write(new com.fasterxml.jackson.databind.ObjectMapper()
                            .writeValueAsString(clean));
                    w.newLine();
                }
            }
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("ok", false, "why", "store_unavailable"));
        }
        return ResponseEntity.accepted().body(Map.of("ok", true));
    }

    /** 按天现算真实事件的日聚合；只有真正收到的事件才计入，不掺模拟值。 */
    @GetMapping("/live/daily")
    public Map<String, Object> daily(@RequestParam(name = "days", defaultValue = "30") int days) {
        int span = Math.max(1, Math.min(90, days));
        Map<String, DayBucket> byDay = new LinkedHashMap<>();
        Path file = store;
        if (Files.exists(file)) {
            try (BufferedReader r = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                String line;
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                while ((line = r.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    Map<?, ?> ev;
                    try { ev = mapper.readValue(line, Map.class); } catch (IOException bad) { continue; }
                    Object at = ev.get("at");
                    if (!(at instanceof Number)) continue;
                    String day = java.time.Instant.ofEpochMilli(((Number) at).longValue())
                            .atZone(ZoneId.systemDefault()).toLocalDate().format(DAY);
                    DayBucket b = byDay.computeIfAbsent(day, k -> new DayBucket());
                    Object tv = ev.get("type");
                    String t = tv == null ? "" : String.valueOf(tv);
                    switch (t) {
                        case "pageview": b.pageViews++; b.sessions++; break;
                        case "click": b.clicks++; break;
                        case "rage": b.rage++; break;
                        case "error": b.errors++; break;
                        default: b.custom++; break;
                    }
                }
            } catch (IOException e) {
                // 读不到就报 0 条，绝不退回模拟值。
            }
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map.Entry<String, DayBucket> e : byDay.entrySet()) {
            DayBucket b = e.getValue();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("date", e.getKey());
            row.put("sessions", b.sessions);
            row.put("pageViews", b.pageViews);
            row.put("clicks", b.clicks);
            row.put("rage", b.rage);
            row.put("errors", b.errors);
            row.put("custom", b.custom);
            rows.add(row);
        }
        int totalEvents = 0;
        for (Map<String, Object> row : rows) {
            DayBucket b = byDay.get(String.valueOf(row.get("date")));
            totalEvents += b.pageViews + b.clicks + b.rage + b.errors + b.custom;
        }
        return Map.of("cohortKind", "live", "days", span, "events", totalEvents, "daily", rows);
    }

    private static final class DayBucket {
        int sessions, pageViews, clicks, rage, errors, custom;
    }

    private static final class Bucket {
        final AtomicInteger count = new AtomicInteger();
        long resetAt = System.currentTimeMillis() + 1000;
    }
}
