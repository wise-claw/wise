# CJK 输入法已知问题

本文档描述 Claude Code CLI 中 CJK（中文、日语、韩语）输入法输入的已知问题，并为受影响用户提供变通方案。

## 目录

- [Overview](#overview)
- [Affected Users](#affected-users)
- [Known Issues](#known-issues)
- [Root Cause](#root-cause)
- [Workarounds](#workarounds)
- [Related Issues](#related-issues)
- [Status](#status)

## Overview

Claude Code CLI 使用 React Ink 进行终端 UI 渲染。由于终端 raw 模式处理 IME（输入法编辑器）组合事件的局限，CJK 用户会遇到从不可见字符到组合文本错位等各类输入问题。

## Affected Users

| 语言 | 输入法 | 受影响 |
|----------|--------------|----------|
| 韩语 (한국어) | macOS 韩语 IME | ✅ 是 |
| 韩语 (한국어) | Windows 韩语 IME | ✅ 是 |
| 韩语 (한국어) | Gureumkim (구름) | ✅ 是 |
| 日语 (日本語) | macOS 日语 IME | ✅ 是 |
| 日语 (日本語) | Windows 日语 IME | ✅ 是 |
| 中文 (中文) | macOS 拼音 | ✅ 是 |
| 中文 (中文) | Windows 拼音 | ✅ 是 |
| 越南语 | Telex | ✅ 是 |

## Known Issues

### 1. 组合期间字符不可见（严重）

**症状**：输入 CJK 字符时，IME 组合期间输入框中无任何显示。字符仅在按回车后才出现。

**平台**：macOS、Linux

**示例（韩语）**：
- 输入 `ㅎ` → 无显示
- 输入 `ㅎ` + `ㅏ` → 无显示  
- 输入 `ㅎ` + `ㅏ` + `ㄴ` → 无显示
- 按回车 → `한` 出现在输出中

### 2. 组合位置错误

**症状**：组合中的字符出现在错误位置（如下一行行首），而非光标处。

**平台**：Windows、部分 macOS 终端

### 3. 性能问题与重复候选词

**症状**：IME 输入导致卡顿、重复转换候选词或高内存占用。

**平台**：全部

## Root Cause

该问题源于三个相互关联的技术局限：

### 1. 终端 Raw 模式局限

当 Node.js 运行于 raw 模式（`process.stdin.setRawMode(true)`）时，它仅提供字节级 STDIN 访问，而无：
- 组合事件回调（`compositionstart`、`compositionupdate`、`compositionend`）
- IME 预编辑缓冲区信息
- 组合期间的光标位置反馈

### 2. React Ink 的 TextInput 组件

React Ink 的 TextInput 逐键处理击键，而不理解多阶段字符形成：
- 无 `isComposing` 状态跟踪
- 无独立组合缓冲区
- 逐字符处理破坏 CJK 算法式组合

### 3. CJK 字符复杂度

CJK 语言使用算法式组合，多个击键组合为单字符：

**韩语谚文**：
```
ㄱ + ㅏ → 가
가 + ㄴ → 간
간 + ㅇ → (new syllable)
```

**日语平假名**：
```
k + a → か
か + n → かn (waiting for next)
かn + a → かな
```

这需要终端 raw 模式无法提供的实时组合显示。

## Workarounds

### 变通方案 1：外部编辑器 + 粘贴（推荐）

在能正确处理 IME 的外部编辑器中编写文本，再粘贴进 Claude Code。

1. 打开任意文本编辑器（VS Code、Notes、TextEdit、Notepad）
2. 在其中输入 CJK 文本
3. 复制（`Cmd+C` / `Ctrl+C`）
4. 粘贴进 Claude Code（`Cmd+V` / `Ctrl+V`）

**优点**：100% 可靠
**缺点**：打断工作流，需切换应用

### 变通方案 2：使用英文提示配合 CJK 上下文

可能时，提示使用英文，但在文件内容或引用中包含 CJK 文本。

```
# Instead of typing Korean directly:
# "한국어로 인사말 작성해줘"

# Use English prompt:
# "Write a greeting message in Korean language"
```

### 变通方案 3：基于剪贴板的输入脚本

创建一个从剪贴板读取并发送给 Claude Code 的脚本：

```bash
# macOS
pbpaste | claude --stdin

# Linux (requires xclip)
xclip -selection clipboard -o | claude --stdin
```

### 变通方案 4：使用 IDE 集成

通过 IDE 集成（VS Code 扩展）使用 Claude Code，其 IME 处理可能优于裸终端。

## Related Issues

### wise
- [#344](https://github.com/wise-claw/wise/issues/344) - 韩语 IME 输入在输入框中不可见

### anthropics/claude-code
- [#22732](https://github.com/anthropics/claude-code/issues/22732) - 韩语 IME：组合期间字符完全不可见
- [#18291](https://github.com/anthropics/claude-code/issues/18291) - 韩语 IME 组合：音节完成前 jamo 不显示
- [#16322](https://github.com/anthropics/claude-code/issues/16322) - [严重] 韩语 IME：组合字符显示在错误位置
- [#15705](https://github.com/anthropics/claude-code/issues/15705) - 韩语输入字符在 iOS 移动 SSH 上消失
- [#1547](https://github.com/anthropics/claude-code/issues/1547) - IME 输入导致性能问题
- [#3045](https://github.com/anthropics/claude-code/issues/3045) - 调查：通过修补 React Ink 修复 IME 问题

### 上游（React Ink）
- React Ink 的 TextInput 不支持 IME 组合状态
- 最小复现：https://github.com/takeru/react-ink-ime-bug

### 其他项目中的相似问题
- [Google Gemini CLI #3014](https://github.com/google-gemini/gemini-cli/issues/3014) - 同一问题影响 Gemini CLI

## Status

| 修复领域 | 状态 | 备注 |
|----------|--------|-------|
| 光标定位 | ✅ 部分修复 | 2025 年 8 月发布改进了组合窗口位置 |
| 字符可见性 | ❌ 未修复 | 组合期间字符仍不可见 |
| 性能 | ⚠️ 进行中 | 内存问题正在调查 |
| 根本性修复 | 🔄 进行中 | 需修补 React Ink 或使用替代输入法 |

## 贡献

若你有额外变通方案或找到解决方案，请：

1. 提交 PR 更新本文档
2. 在相关 GitHub issue 下评论
3. 与社区分享你的发现

## 参考

- [Terminal-friendly application with Node.js - User Inputs](https://blog.soulserv.net/terminal-friendly-application-with-node-js-part-iii-user-inputs/)
- [React IME Composition Events Issue #8683](https://github.com/facebook/react/issues/8683)
- [Node.js Readline Documentation](https://nodejs.org/api/readline.html)
