# 模型 × 智能体兼容性矩阵

针对每个 WISE/OMO 智能体应搭配哪个模型的推荐矩阵，围绕成本与质量权衡。本页面旨在让反复出现的「该把哪个模型固定到哪个智能体？」问题不再仅是 Discord 上的小圈子经验。

这是一份**使用矩阵，而非基准测试报告**。数字与逐任务评分刻意不在范围内。

## 推荐矩阵

| 智能体 | 角色 | 推荐（高端） | 推荐（高性价比） | 避免使用 | 说明 |
|---|---|---|---|---|---|
| Prometheus | 规划 | Claude Opus 4.8, GPT-5.5 high | Sonnet 4.6 | — | 重度推理；每会话运行 1–2 次 |
| Hyperplan | 规划 | Claude Opus 4.8, GPT-5.5 high | Sonnet 4.6 | — | 同 Prometheus |
| Sisyphus | 实现 | Sonnet 4.6 | DeepSeek V4 Pro, Kimi K2.5 | — | token 消耗大；此处成本最关键 |
| Hephaestus | 实现 | Sonnet 4.6, Kimi K2.5 | DeepSeek V4 Pro | **GPT-\*（工具调用/格式出错）** | 为非 GPT 模型调优 |
| Oracle | 审查 | Claude Opus 4.8, GPT-5.5 high | Sonnet 4.6 | — | 质量优先于成本；调用较少 |
| Aletheia | 审查 | Sonnet 4.6 | DeepSeek V4 Pro | — | |
| Hermes | 协调 | Sonnet 4.6 | DeepSeek V4 Flash | — | 仅协调器，非直接执行器 |

## 设计规则

以下四条规则驱动上方每条推荐。如果只能记住一条，请记住规则 3。

1. **规划/审查 = 昂贵；实现 = 便宜。**
   单次 Prometheus/Oracle 遍历与完整 Sisyphus 实现循环之间的 token 开销通常相差 5–20 倍。在罕见且关键的调用上投入，在高频调用上节约。
2. **Hephaestus 不应与 GPT 系列模型搭配。**
   工具调用与结构化输出格式会出错。高端使用 Sonnet 4.6 / Kimi K2.5，高性价比使用 DeepSeek V4 Pro。这把「Hephaestus 搭配非 GPT 模型就是垃圾」的传言纠正了过来。
3. **Sisyphus 是最高价值的成本杠杆。**
   由于 Sisyphus 在任何非平凡会话中占据总 token 的大头，将其从 Opus → Sonnet（或 → DeepSeek V4 Pro）通常比任何其他单一改动更能影响总开销。优先调整这个槽位。
4. **DeepSeek V4 Pro/Flash 现在是一等的经济型选项。**
   将 V4 Pro 作为执行型智能体（Sisyphus、Hephaestus、Aletheia）的默认高性价比选择，将 V4 Flash 作为默认协调器模型。它不再是实验性降级方案。

## 起步预设

选择与你预算姿态匹配的预设并在此基础上调整。每个代码块都是自包含示例 — 直接放入你的 provider/agent 配置，按智能体需要编辑。

### 高端（最高质量）

当正确性压倒成本时使用：影响生产的重构、安全审查、架构决策。

```yaml
agents:
  Prometheus:  { model: claude-opus-4-8 }
  Hyperplan:   { model: claude-opus-4-8 }
  Sisyphus:    { model: claude-sonnet-4-6 }
  Hephaestus:  { model: claude-sonnet-4-6 }   # never GPT-*
  Oracle:      { model: claude-opus-4-8 }
  Aletheia:    { model: claude-sonnet-4-6 }
  Hermes:      { model: claude-sonnet-4-6 }
```

### 均衡（默认）

推荐起点。将规划/审查保留在强模型上，同时将 token 消耗大的实现槽位移到高性价比模型。

```yaml
agents:
  Prometheus:  { model: claude-sonnet-4-6 }
  Hyperplan:   { model: claude-sonnet-4-6 }
  Sisyphus:    { model: deepseek-v4-pro }
  Hephaestus:  { model: kimi-k2-5 }            # never GPT-*
  Oracle:      { model: claude-sonnet-4-6 }
  Aletheia:    { model: deepseek-v4-pro }
  Hermes:      { model: deepseek-v4-flash }
```

### 经济（成本优先）

用于长时间运行的循环、批量重构或实验，总开销比单次调用峰值质量更重要。将 Oracle 保留在强模型上，使最终审查遍仍能捕获回归。

```yaml
agents:
  Prometheus:  { model: claude-sonnet-4-6 }
  Hyperplan:   { model: claude-sonnet-4-6 }
  Sisyphus:    { model: deepseek-v4-pro }
  Hephaestus:  { model: deepseek-v4-pro }      # never GPT-*
  Oracle:      { model: claude-sonnet-4-6 }
  Aletheia:    { model: deepseek-v4-pro }
  Hermes:      { model: deepseek-v4-flash }
```

## 不在范围内

- Provider 路由内部机制（在别处跟踪）。
- 基准测试 — 本页面是使用矩阵，而非基准测试报告。
- Hermes 深度协调模式。
