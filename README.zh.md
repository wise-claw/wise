## 快速开始

**第一步：安装**
```bash
/plugin marketplace add https://github.com/wise-claw/wise
/plugin install wise
```

**第二步：配置**
```bash
/wise-setup
```

如果你通过 `wise --plugin-dir <path>` 或 `claude --plugin-dir <path>` 运行 WISE，请在 `wise setup` 中添加 `--plugin-dir-mode`（或提前导出 `WISE_PLUGIN_ROOT`），以避免复制插件在运行时已经提供的技能/代理。有关完整的决策矩阵和所有可用标志，请参阅 [REFERENCE.md 中的 Plugin directory flags 部分](./docs/REFERENCE.md#plugin-directory-flags)。

<!-- TODO(i18n): verify translation -->

**第三步：开始构建**
```
autopilot: build a REST API for managing tasks
```

就这么简单。其余都是自动的。