package caesura.lore;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 一条世界谱条目（快照来源：仓库 `codex/index.html` 的 CODEX 数组，
 * 由 scripts/lore-codex-snapshot.mjs 切出，构建期打成 jar 资源）。
 *
 * <p>这里不存任何运行时计算结果——它只是「数据的形状」。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record LoreEntry(String id, String cat, Title title, Body body) {

  public record Title(String zh, String en) {}

  public record Body(String zh, String en) {}
}
