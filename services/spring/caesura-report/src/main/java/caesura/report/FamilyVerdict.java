package caesura.report;

import java.util.List;
import java.util.Map;

/**
 * 一族门跑完之后的汇总判决（KI-422）。
 *
 * <p>字段名与仓库 {@code scripts/red-rate-scan.mjs} 的 {@code resultLine} **逐个对齐**：
 * {@code kind / reds / total / ranFiles / expectedFiles / redTitles / reportKept}。
 * 这样一份微服务汇总出来的报告，与仓库那套量具读的是同一套词汇。
 *
 * <p><b>「红了」与「拉红整族」是两件事</b>：{@code reds} 数的是**所有**红了的门
 * （与 {@code redTitles} 一一对应——仓库那套纪律：计数与点名是两个分母，混用就会得到
 * 一份自相矛盾的读数）；而 {@code kind} 看的是 {@code blockingReds}（**阻塞门**红了几道）——
 * 名册里 {@code blocking: false} 的门红了照样出现在 {@code redTitles} 里，但**不**把整族拉红。
 * （**这里刻意不点名任何一道门**：门 id 是名册的主键，Java 侧一写死它就有个第二出处
 * ——门改名了这段话就成了谎。门自己那道门会当场红：{@code spring-family-table.test.ts} 的
 * 「门 id 一个都不许出现在 Java 源码里」那一腿。）
 *
 * @param kind        {@code green} / {@code red}（看的是阻塞门那一格）
 * @param reds        红了的门数（**与 redTitles 一一对应**）
 * @param total       这一族一共多少道门
 * @param ranFiles    这一趟真的跑了多少道门
 * @param expectedFiles 名册里一共有多少道门（跑了少于这个数 ⇒ 有一道没跑成，别把它算成绿）
 * @param redTitles   红了的那几道的名字（**不截断**）
 * @param reportKept  完整报告还在不在某个能打开的地方（本族：**不在**——门只把输出尾巴带回来）
 * @param blockingReds 其中有几道是「阻塞门」（不阻塞的红门照样出现在 redTitles 里，只是不拉红整族）
 * @param gates       每道门各自的判决
 */
public record FamilyVerdict(
        String kind,
        int reds,
        int total,
        int ranFiles,
        int expectedFiles,
        List<String> redTitles,
        boolean reportKept,
        int blockingReds,
        List<Map<String, Object>> gates) {
}
