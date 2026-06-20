# 元数据同步系统

## 概述

元数据同步系统确保 `package.json`（唯一真相来源）与项目中所有文档文件之间的一致性。它防止版本漂移、过期徽章与手动更新错误。

## 为何需要

### 问题所在

在典型的项目生命周期中：

1. 开发者在 `package.json` 中将版本升至 `3.5.0`
2. 创建发布提交
3. **忘记**更新 `README.md` 中的版本徽章（仍显示 `3.4.0`）
4. **忘记**更新 `docs/参考.md` 中的版本标题
5. 添加新智能体后**忘记**更新 `.github/CLAUDE.md` 中的智能体数量
6. 用户在各文档中看到不一致的版本信息
7. CI 构建看起来专业，却包含过期元数据

**结果：** 困惑、信任降低、观感不专业。

### 解决方案

一个自动化脚本，能够：
- 从 `package.json` 读取规范元数据
- 一次性更新所有文档文件
- 可验证同步状态（用于 CI/CD）
- 支持预演模式以保证安全
- 精确报告变更内容

## 工作原理

### 唯一真相来源

`package.json` 是以下字段的**唯一真相来源**：

| 字段 | 用途 |
|-------|----------|
| `version` | 版本徽章、标题、引用 |
| `name` | npm 包链接、下载徽章 |
| `description` | 项目标语（未来） |
| `keywords` | SEO 元数据（未来） |
| `repository.url` | GitHub 链接 |
| `homepage` | 网站链接 |

### 目标文件

脚本同步以下文件：

| 文件 | 更新内容 |
|------|-------------------|
| `README.md` | npm 版本/下载徽章 |
| `docs/参考.md` | 版本徽章、版本标题 |
| `.github/CLAUDE.md` | 智能体数量、技能数量 |
| `docs/架构.md` | 版本引用 |
| `CHANGELOG.md` | 最新版本标题（仅验证） |

### 动态元数据

部分元数据为计算所得，而非读取：

- **智能体数量** - 统计 `agents/` 目录下的 `.yaml`/`.yml` 文件
- **技能数量** - 统计 `skills/` 目录下的 `.md` 文件

这确保文档始终反映当前状态。

## 用法

### 基本同步

```bash
npm run sync-metadata
```

同步所有文件。输出：
```
📦 Metadata Sync System
========================

Version: 3.5.0
Package: wise
Agents: 32
Skills: 45

✓ README.md
  - npm version badge

✓ docs/参考.md
  - Version badge
  - Version header

✓ .github/CLAUDE.md
  - Agent count
  - Slash command count

✅ Successfully synced 3 file(s)!
```

### 预演（预览变更）

```bash
npm run sync-metadata -- --dry-run
```

显示**将要**变更的内容而不写入文件：

```
🔍 DRY RUN MODE - No files will be modified

📝 README.md
  - npm version badge

📝 docs/参考.md
  - Version badge

📊 2 file(s) would be updated
Run without --dry-run to apply changes
```

### 验证同步（CI/CD）

```bash
npm run sync-metadata -- --verify
```

检查文件是否已同步。退出状态码：
- `0` - 所有文件已同步
- `1` - 文件未同步（显示哪些文件）

```
🔍 Verifying metadata sync...
✓ README.md
✗ docs/参考.md
  - Version badge needs update

❌ Files are out of sync!
Run: npm run sync-metadata
```

### 帮助

```bash
npm run sync-metadata -- --help
```

## 何时运行

### 手动工作流

在提交版本变更**之前**运行同步：

```bash
# 1. Bump version
npm version patch

# 2. Sync metadata
npm run sync-metadata

# 3. Commit everything together
git add .
git commit -m "chore: release v3.5.0"
```

### 自动化工作流（推荐）

添加到 `package.json`：

```json
{
  "scripts": {
    "version": "npm run sync-metadata && git add ."
  }
}
```

现在 `npm version patch` 会自动：
1. 在 `package.json` 中升级版本
2. 运行同步脚本
3. 暂存已同步文件
4. 创建版本提交

### 提交前 Hook

添加到 `.husky/pre-commit`：

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Verify metadata is in sync
npm run sync-metadata -- --verify

if [ $? -ne 0 ]; then
  echo "❌ Metadata out of sync! Run: npm run sync-metadata"
  exit 1
fi
```

### CI/CD 流水线

为 GitHub Actions 添加验证步骤：

```yaml
- name: Verify Metadata Sync
  run: npm run sync-metadata -- --verify
```

## 如何扩展

### 添加新目标文件

编辑 `scripts/sync-metadata.ts`：

```typescript
function getFileSyncConfigs(): FileSync[] {
  return [
    // ... existing configs ...
    {
      path: 'docs/NEW-FILE.md',
      replacements: [
        {
          pattern: /version \d+\.\d+\.\d+/gi,
          replacement: (m) => `version ${m.version}`,
          description: 'Version references',
        },
        {
          pattern: /\*\*\d+ features\*\*/g,
          replacement: (m) => `**${getFeatureCount()} features**`,
          description: 'Feature count',
        },
      ],
    },
  ];
}
```

### 添加动态元数据

新增一个函数：

```typescript
function getFeatureCount(): number {
  const featuresDir = join(projectRoot, 'features');
  const files = readdirSync(featuresDir);
  return files.filter(f => f.endsWith('.ts')).length;
}
```

在替换中使用：

```typescript
{
  pattern: /\*\*\d+ features\*\*/g,
  replacement: () => `**${getFeatureCount()} features**`,
  description: 'Feature count',
}
```

### 添加新元数据来源

扩展 `Metadata` 接口：

```typescript
interface Metadata {
  version: string;
  description: string;
  keywords: string[];
  repository: string;
  homepage: string;
  npmPackage: string;
  // NEW:
  author: string;
  license: string;
  engines: { node: string };
}
```

更新 `loadMetadata()`：

```typescript
function loadMetadata(): Metadata {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  return {
    // ... existing fields ...
    author: packageJson.author || '',
    license: packageJson.license || '',
    engines: packageJson.engines || { node: '>=20.0.0' },
  };
}
```

## 实现细节

### 安全替换策略

脚本使用**基于正则的替换**并带有保护措施：

1. 将整个文件**读入**内存
2. 对字符串**应用所有替换**
3. **比较**原始与修改后内容
4. 仅在内容变更时**写入**

这避免了：
- 不必要的文件写入（保留时间戳）
- 部分更新（原子操作）
- 权限错误（在写入前失败）

### 模式设计

模式设计为：

**足够具体**，仅匹配预期内容：
```typescript
// GOOD - matches only npm badge
/\[!\[npm version\]\(https:\/\/img\.shields\.io\/npm\/v\/[^)]+\)/g

// BAD - too broad, matches any badge
/\[!\[[^\]]+\]\([^)]+\)/g
```

**足够灵活**，处理变体：
```typescript
// Matches: 3.4.0, 10.0.0, 2.1.3-beta
/\d+\.\d+\.\d+(-[a-z0-9]+)?/
```

### 错误处理

脚本处理：

- **文件缺失** - 警告但继续
- **无效 package.json** - 快速失败并给出清晰错误
- **权限错误** - 报告并退出
- **正则失败** - 报告失败的模式

### 性能

对于典型项目：
- **读取文件数：** 5-10
- **执行时间：** <100ms
- **内存使用：** <10MB

随目标文件数量线性扩展。

## 测试

### 手动测试

```bash
# 1. Make a change to package.json
npm version patch

# 2. Run dry-run to preview
npm run sync-metadata -- --dry-run

# 3. Apply changes
npm run sync-metadata

# 4. Verify with git
git diff
```

### 自动化测试

脚本导出函数用于测试：

```typescript
import { loadMetadata, syncFile, verifySync } from './scripts/sync-metadata.js';

test('loads metadata correctly', () => {
  const metadata = loadMetadata();
  expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test('syncs README badges', () => {
  const config = getFileSyncConfigs().find(c => c.path === 'README.md');
  const result = syncFile(config, mockMetadata, true, projectRoot);
  expect(result.changed).toBe(true);
});
```

## 故障排查

### "File not found" 警告

**症状：** 脚本报文件未找到。

**原因：** 文件已移动或删除。

**修复：** 从 `getFileSyncConfigs()` 中移除或更新路径。

### "No changes detected" 但文件已过期

**症状：** 脚本报无变更，但文件显示旧版本。

**原因：** 模式不匹配当前文件格式。

**修复：** 更新正则模式以匹配实际内容。

### 版本已更新但徽章仍为旧值

**症状：** package.json 已含新版本，徽章未变。

**原因：** 徽章可能被 shields.io CDN 缓存。

**修复：** 等待 5 分钟或使用 `?cache=bust` 参数。

### 权限拒绝错误

**症状：** 脚本以 EACCES 失败。

**原因：** 文件为只读或属不同用户。

**修复：**
```bash
chmod +w docs/*.md
# or
sudo chown $USER docs/*.md
```

## 最佳实践

### 1. 始终先预演

发布前：
```bash
npm run sync-metadata -- --dry-run
```

审查变更后应用。

### 2. 提交前同步

加入你的工作流：
```bash
npm run sync-metadata && git add -A
```

### 3. 在 CI 中使用验证

在 pull request 中捕获过期文档：
```yaml
- run: npm run sync-metadata -- --verify
```

### 4. 保持模式可维护

为复杂正则加注释：
```typescript
{
  // Matches: [![Version](https://img.shields.io/badge/version-3.4.0-ff6b6b)]
  // Captures: version number only
  pattern: /\[!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-([^-]+)-[^)]+\)/g,
  replacement: (m) => `[![Version](https://img.shields.io/badge/version-${m.version}-ff6b6b)]`,
  description: 'Version badge in 参考.md',
}
```

### 5. package.json 变更后测试

package.json 任何变更后：
```bash
npm run sync-metadata -- --verify
```

## 迁移指南

若将其添加到现有项目：

### 步骤 1：审计当前状态

查找所有硬编码版本：
```bash
grep -r "3\.4\.0" docs/ README.md .github/
```

### 步骤 2：标准化格式

选择一致的徽章格式：
```markdown
[![Version](https://img.shields.io/badge/version-3.4.0-ff6b6b)]
```

手动更新所有实例。

### 步骤 3：运行初始同步

```bash
npm run sync-metadata
```

应报告 "All files are already in sync"。

### 步骤 4：加入工作流

添加 npm 脚本、pre-commit hook、CI 验证。

### 步骤 5：为团队编写文档

更新 CONTRIBUTING.md：
```markdown
## Releasing

1. Bump version: `npm version patch`
2. Sync metadata: `npm run sync-metadata`
3. Commit and tag
```

## 未来增强

潜在改进：

- [ ] 支持多语言文档（i18n）
- [ ] 同步到网站/落地页
- [ ] 从源码提取特性数量
- [ ] 自动更新文档中的依赖版本
- [ ] 与发布工作流集成
- [ ] 基于 Markdown AST 的更新（比正则更安全）
- [ ] 用于自定义模式的配置文件
- [ ] 用于自定义元数据来源的插件系统

## 相关

- [CI/CD 流水线](../.github/workflows/)
