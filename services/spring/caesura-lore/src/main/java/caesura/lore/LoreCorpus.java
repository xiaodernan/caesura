package caesura.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 世界谱语料（启动时自 jar 资源加载一次，之后只读）。
 *
 * <p>纪律：这里**不许**出现任何仓库数据表路径——它读的是自己 jar 里的打包件，
 * 打包件的生成由作者侧脚本（lore-codex-snapshot.mjs）负责，两端由测试共同把关。
 */
@Component
public class LoreCorpus {

  private final List<LoreEntry> entries;
  private final List<LoreEntry> immutable;

  public LoreCorpus(ObjectMapper mapper) throws Exception {
    ClassPathResource res = new ClassPathResource("lore/codex.json");
    try (InputStream in = res.getInputStream()) {
      JsonNode root = mapper.readTree(in);
      JsonNode arr = root.required("entries");
      List<LoreEntry> out = new ArrayList<>(arr.size());
      for (JsonNode node : arr) {
        out.add(mapper.treeToValue(node, LoreEntry.class));
      }
      this.entries = out;
    }
    validate();
    this.immutable = Collections.unmodifiableList(entries);
  }

  private void validate() {
    if (entries.isEmpty()) {
      throw new IllegalStateException("lore/codex.json 是空的——说明打包流程断了");
    }
    Set<String> seen = new HashSet<>();
    for (LoreEntry e : entries) {
      if (e.id() == null || e.id().isBlank()) {
        throw new IllegalStateException("存在缺 id 的条目");
      }
      if (!seen.add(e.id())) {
        throw new IllegalStateException("lore/codex.json 里 id 冲突：" + e.id());
      }
      if (e.title() == null || e.body() == null) {
        throw new IllegalStateException("条目 " + e.id() + " 缺 title/body");
      }
    }
  }

  public List<LoreEntry> entries() {
    return immutable;
  }

  public int size() {
    return immutable.size();
  }

  /** 打分文本池：标题 ×3（BM25F-lite）+ 正文 —— 分词与 df 的唯一出处（bm25 路与 sqlite 路共用） */
  public String textPool(LoreEntry e) {
    return e.title().zh() + ' ' + e.title().en() + ' '
        + e.title().zh() + ' ' + e.title().en() + ' '
        + e.title().zh() + ' ' + e.title().en() + ' '
        + e.body().zh() + ' ' + e.body().en();
  }

  public Optional<LoreEntry> byId(String id) {
    for (LoreEntry e : immutable) {
      if (e.id().equals(id)) return Optional.of(e);
    }
    return Optional.empty();
  }
}
