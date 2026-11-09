package caesura.gate;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/**
 * 跑一道门（KI-422）。
 *
 * <p><b>它不判定任何东西。</b>它做的事只有三件：把名册里那一格给的命令**原样**跑起来、
 * 把退出码与输出尾巴如实收上来、到点就把进程杀掉并如实说「超时」。
 *
 * <p>判据的唯一主人仍然是 Node 侧那道命令（{@code npm run lint} / {@code node scripts/validate-data.mjs} …）。
 * Java 侧**没有**任何一行「什么算红」的规则：红了就是退出码非零，超时就是超时，
 * 起不来就是起不来——三者互不顶替，也都不被翻译成「算绿」。
 */
@Component
public class GateRunner {

    /** 输出尾巴留多少字符（人读的那一段；全量输出留在门自己的 stdout 里） */
    private static final int TAIL_CHARS = 4000;

    private final GateProperties properties;

    public GateRunner(GateProperties properties) {
        this.properties = properties;
    }

    /**
     * 跑一道门。
     *
     * @param gate 名册里的那一格
     * @return 判决（永不为 null；起不来也是一个判决，{@code verdict=error}）
     */
    public GateVerdict run(GateProperties.Gate gate) {
        Path root = Path.of(properties.getRepoRoot()).toAbsolutePath().normalize();
        List<String> command = new ArrayList<>();
        command.add(gate.getCommand());
        command.addAll(gate.getArgs());
        String described = describe(command);
        Instant startedAt = Instant.now();

        Process proc = null;
        Collector out = null;
        Collector err = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(root.toFile());
            proc = builder.start();
            out = new Collector(proc.getInputStream());
            err = new Collector(proc.getErrorStream());
            out.start();
            err.start();

            boolean finished = proc.waitFor(gate.getTimeoutSec(), TimeUnit.SECONDS);
            if (!finished) {
                proc.destroyForcibly();
                proc.waitFor();
                long ms = Duration.between(startedAt, Instant.now()).toMillis();
                return new GateVerdict(gate.getId(), gate.getFamily(), described, -1, ms,
                        "timeout", startedAt.toString(), tail(out.text()), tail(err.text()));
            }
            out.join();
            err.join();
            long ms = Duration.between(startedAt, Instant.now()).toMillis();
            int exit = proc.exitValue();
            return new GateVerdict(gate.getId(), gate.getFamily(), described, exit, ms,
                    exit == 0 ? "green" : "red", startedAt.toString(), tail(out.text()), tail(err.text()));
        } catch (IOException e) {
            long ms = Duration.between(startedAt, Instant.now()).toMillis();
            return new GateVerdict(gate.getId(), gate.getFamily(), described, -1, ms,
                    "error", startedAt.toString(), "", "起不来：" + e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (proc != null) {
                proc.destroyForcibly();
            }
            long ms = Duration.between(startedAt, Instant.now()).toMillis();
            return new GateVerdict(gate.getId(), gate.getFamily(), described, -1, ms,
                    "error", startedAt.toString(), "", "被中断：" + e);
        }
    }

    /** 人读的命令串（`npm run lint` 而不是 `["npm","run","lint"]`） */
    private static String describe(List<String> command) {
        return String.join(" ", command);
    }

    /** 取尾巴；空的不占位（人读时不该看到一大片空白） */
    private static String tail(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        String trimmed = text.strip();
        if (trimmed.length() <= TAIL_CHARS) {
            return trimmed;
        }
        return "…" + trimmed.substring(trimmed.length() - TAIL_CHARS);
    }

    /**
     * 一个把流读干的小工：管道读不完时进程会卡在写上，所以**必须**另起线程读。
     */
    private static final class Collector extends Thread {

        private final InputStream stream;
        private final StringBuilder buffer = new StringBuilder();

        Collector(InputStream stream) {
            this.stream = stream;
            setDaemon(true);
        }

        @Override
        public void run() {
            try (InputStream in = stream) {
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    buffer.append(new String(chunk, 0, n, StandardCharsets.UTF_8));
                }
            } catch (IOException ignored) {
                // 管道被杀掉时读不到尾字节是正常收场；那一趟的判决在别处（退出码/超时）。
            }
        }

        String text() {
            return buffer.toString();
        }
    }
}
