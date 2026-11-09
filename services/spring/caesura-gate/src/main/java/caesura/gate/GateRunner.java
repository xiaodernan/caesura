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
    private final CircuitBreaker breaker;

    /** 这一台是不是 Windows（决定进程怎么起；判定不看这个，只看退出码） */
    private final boolean windows;

    @org.springframework.beans.factory.annotation.Autowired
    public GateRunner(GateProperties properties, CircuitBreaker breaker) {
        this(properties, breaker, onWindows());
    }

    /** 测试用：把「是不是 Windows」换掉（形状那一段要能被真读数量） */
    GateRunner(GateProperties properties, CircuitBreaker breaker, boolean windows) {
        this.properties = properties;
        this.breaker = breaker;
        this.windows = windows;
    }

    /** 这一台是不是 Windows */
    static boolean onWindows() {
        return System.getProperty("os.name", "").toLowerCase().startsWith("win");
    }

    /**
     * 进程形状：**Windows 上 {@code npm} 是批处理文件**（{@code npm.cmd}），
     * 而 {@code CreateProcess} 不能直接起它 —— 实测报的是
     * {@code Cannot run program "npm" ... error=2（系统找不到指定的文件）}：
     * 名册里写着「npm run lint」，门起进程却**一出生就死**（五道门里有三道是这种死法）。
     *
     * <p>所以 Windows 上要经过 {@code cmd /c}。**名册写的是逻辑命令名**（{@code npm}／{@code node}），
     * 「怎么把它起起来」是这一族自己的事 —— 判定仍然只看**退出码**，一个字没变。
     *
     * <p>POSIX 上原样起（{@code npm} 本来就是可执行文件，多一层 shell 只会多一层壳）。
     */
    static List<String> spawnCommand(List<String> command, boolean windows) {
        if (!windows || command.isEmpty()) {
            return command;
        }
        List<String> out = new ArrayList<>();
        out.add("cmd");
        out.add("/c");
        out.addAll(command);
        return out;
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

        // 熔断（KI-429）：**起进程之前**先问一句。开闸了就直接回一个判决——
        // 一个进程都不起（这一趟的 durationMs 是 0，因为它真的什么都没做）。
        CircuitBreaker.Decision decision = breaker.beforeRun(gate.getId());
        if (!decision.allowed()) {
            return new GateVerdict(gate.getId(), gate.getFamily(), described, -1, 0,
                    "circuit_open", startedAt.toString(), "",
                    "熔断中（" + decision.reason() + "）：这一道门没有起进程",
                    decision.state().name());
        }

        Process proc = null;
        Collector out = null;
        Collector err = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(spawnCommand(command, windows));
            builder.directory(root.toFile());
            proc = builder.start();
            out = new Collector(proc.getInputStream());
            err = new Collector(proc.getErrorStream());
            out.start();
            err.start();

            boolean finished = proc.waitFor(gate.getTimeoutSec(), TimeUnit.SECONDS);
            if (!finished) {
                killTree(proc);
                proc.waitFor();
                long ms = Duration.between(startedAt, Instant.now()).toMillis();
                breaker.afterRun(gate.getId(), false);
                return new GateVerdict(gate.getId(), gate.getFamily(), described, -1, ms,
                        "timeout", startedAt.toString(), tail(out.text()), tail(err.text()),
                        decision.state().name());
            }
            out.join();
            err.join();
            long ms = Duration.between(startedAt, Instant.now()).toMillis();
            int exit = proc.exitValue();
            breaker.afterRun(gate.getId(), exit == 0);
            return new GateVerdict(gate.getId(), gate.getFamily(), described, exit, ms,
                    exit == 0 ? "green" : "red", startedAt.toString(), tail(out.text()), tail(err.text()),
                    decision.state().name());
        } catch (IOException e) {
            long ms = Duration.between(startedAt, Instant.now()).toMillis();
            breaker.afterRun(gate.getId(), false);
            return new GateVerdict(gate.getId(), gate.getFamily(), described, -1, ms,
                    "error", startedAt.toString(), "", "起不来：" + e,
                    decision.state().name());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (proc != null) {
                killTree(proc);
            }
            long ms = Duration.between(startedAt, Instant.now()).toMillis();
            breaker.afterRun(gate.getId(), false);
            return new GateVerdict(gate.getId(), gate.getFamily(), described, -1, ms,
                    "error", startedAt.toString(), "", "被中断：" + e,
                    decision.state().name());
        }
    }

    /** 人读的命令串（`npm run lint` 而不是 `["npm","run","lint"]`） */
    private static String describe(List<String> command) {
        return String.join(" ", command);
    }

    /**
     * 连**子孙**一起杀。
     *
     * <p>为什么：Windows 上经过 {@code cmd /c} 之后，被杀的是壳——壳底下那个
     * （npm 起的 node）会变成孤儿继续跑，占着机器不放手。只杀壳等于没杀。
     */
    private static void killTree(Process proc) {
        proc.descendants().forEach(ProcessHandle::destroyForcibly);
        proc.destroyForcibly();
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
