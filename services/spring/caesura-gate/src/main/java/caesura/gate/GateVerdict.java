package caesura.gate;

/**
 * 一道门跑完之后的判决（KI-422）。
 *
 * <p>形状刻意贴着仓库既有的判决形状（{@code scripts/red-rate-scan.mjs} 的
 * {@code resultLine}）：<b>kind / reds / total / ranFiles / expectedFiles / redTitles / reportKept</b>。
 * 这样一份汇总出来的报告能被人与量具用**同一把尺**读，不必为微服务另发明一套词汇。
 *
 * @param id        门 id（来自名册）
 * @param family    族（来自名册）
 * @param command   实际跑的命令（人读的那一份）
 * @param exitCode  退出码；**超时或起不来时是 -1**（不是 0，也不是 1）
 * @param durationMs 这一趟跑了多少毫秒
 * @param verdict   {@code green} / {@code red} / {@code timeout} / {@code error}
 * @param ranAt     起跑时刻（ISO-8601）
 * @param stdoutTail 标准输出尾巴（人读）
 * @param stderrTail 标准错误尾巴（人读）
 */
public record GateVerdict(
        String id,
        String family,
        String command,
        int exitCode,
        long durationMs,
        String verdict,
        String ranAt,
        String stdoutTail,
        String stderrTail) {
}
