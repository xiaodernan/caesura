# KNOWN_ISSUES / 技术债登记（需求 §78/§79）

状态词表：**Implemented** ｜ **Partial** ｜ **Placeholder** ｜ **Blocked**

## 1. Known Issues（已知问题）

| ID | 描述 | 严重度 | 状态 |
|---|---|---|---|
| KI-001 | （空）项目尚未开始编码 | — | — |

## 2. Technical Debt（技术债）

| ID | 描述 | 计划清理点 |
|---|---|---|
| TD-000 | 暂无 | — |

## 3. Performance Issues（性能问题）

| ID | 描述 | Before/After 记录 |
|---|---|---|
| — | 暂无（首次基准测试后登记） | — |

## 4. Missing Assets / Environment Limitations（缺失资产与环境限制，需求 §3）

| ID | 限制 | 替代方案 | 升级路径 |
|---|---|---|---|
| ENV-001 | **Unreal Engine 5 不可用**：本机无 UE5、无 C++ 工具链（Visual Studio/MSVC）、D 盘剩余空间不足（UE5 需 60GB+） | 经用户批准，Vertical Slice 以 Vite+TypeScript+**Three.js(WebGL2)** 实现；Nanite/Lumen/World Partition/GAS 等的等效/近似/降级映射见 docs/technical-architecture.md §1 | 保持 UE5 兼容的数据 schema（JSON DataAssets）与模块边界，未来可整体迁移；C++ 骨架列为远期交付 |
| ENV-002 | 无外部美术资产来源（禁商业资产，需求 §51/§85） | 全部程序化几何+原创 shader+低模占位，接口分层预留替换 | 高质量资产管线路径见 art-direction.md §资产管线 |
| ENV-003 | 无版权音乐/音效库 | WebAudio 程序合成（audio.md 规格） | 未来可换采样库，总线结构不变 |
| ENV-004 | 硬件：i5-12500H / RTX 3060 Laptop 6GB / 16GB RAM | 60fps@1080p 目标 + Low/Med/High/Ultra 档位 | — |
