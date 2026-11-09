package caesura.gate;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 进程形状的真读数（KI-429）。
 *
 * <p><b>这条形状是被实机读数逼出来的</b>：第一趟整族跑读数里，五道门有**三道**
 * （都是 {@code npm} 那几道）**一出生就死**——
 * {@code Cannot run program "npm" ... error=2（系统找不到指定的文件）}：
 * Windows 上 {@code npm} 是批处理文件（{@code npm.cmd}），{@code CreateProcess} 不能直接起它。
 *
 * <p>名册里写的是**逻辑命令名**（{@code npm}／{@code node}），「怎么把它起起来」是这一族自己的事；
 * 判定仍然只看**退出码**。
 */
class GateRunnerCommandShapeTest {

    @Test
    void npmOnWindowsGoesThroughTheShell() {
        assertEquals(
                List.of("cmd", "/c", "npm", "run", "lint"),
                GateRunner.spawnCommand(List.of("npm", "run", "lint"), true));
    }

    @Test
    void nodeOnWindowsGoesThroughTheShellToo() {
        assertEquals(
                List.of("cmd", "/c", "node", "scripts/phase-status.mjs"),
                GateRunner.spawnCommand(List.of("node", "scripts/phase-status.mjs"), true));
    }

    @Test
    void posixKeepsTheCommandAsIs() {
        assertEquals(
                List.of("npm", "run", "lint"),
                GateRunner.spawnCommand(List.of("npm", "run", "lint"), false));
    }

    @Test
    void anEmptyCommandStaysEmpty() {
        assertEquals(List.of(), GateRunner.spawnCommand(List.of(), true));
        assertEquals(List.of(), GateRunner.spawnCommand(List.of(), false));
    }
}
