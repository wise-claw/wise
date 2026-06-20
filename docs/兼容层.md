# MCP/插件兼容层

兼容层使 wise 能够发现、注册并使用外部插件、MCP 服务器与工具。它提供管理外部工具的统一接口，同时通过集成的权限系统保障安全。

## 目录

- [概览](#overview)
- [架构](#architecture)
- [插件发现](#plugin-discovery)
- [MCP 服务器发现](#mcp-server-discovery)
- [插件清单格式](#plugin-manifest-format)
- [工具注册](#tool-registration)
- [权限系统](#permission-system)
- [MCP 桥接](#mcp-bridge)
- [API 参考](#api-reference)
- [示例](#examples)
- [故障排查](#troubleshooting)

<a id="overview"></a>
## 概览

兼容层由四个协同工作的集成系统组成：

1. **发现系统** - 从用户目录自动发现插件与 MCP 服务器
2. **工具注册表** - 注册并管理所有外部工具并解决冲突的中心枢纽
3. **权限适配器** - 集成 WISE 权限系统以安全执行工具
4. **MCP 桥接** - 连接 MCP 服务器并暴露其工具供使用

```
Plugins              MCP Configs          WISE Tools
   ↓                      ↓                    ↓
 Discovery System ────────────────────────────┐
                                              ↓
                           Tool Registry ← ← ←┘
                              ↓
                         Permission Adapter
                              ↓
                           MCP Bridge
```

<a id="architecture"></a>
## 架构

### 发现系统（`discovery.ts`）

从以下位置扫描外部插件与 MCP 服务器：

- `~/.claude/plugins/` - WISE/Claude Code 插件目录
- `~/.claude/installed-plugins/` - 备选插件位置
- `~/.claude/settings.json` - Claude Code MCP 服务器配置
- `~/.claude/claude_desktop_config.json` - Claude Desktop MCP 服务器配置
- 插件清单（`plugin.json`）用于内嵌 MCP 服务器

**发现：**
- 插件技能与智能体（来自 SKILL.md 与 agent .md 文件）
- MCP 服务器配置
- 来自插件清单的工具定义

### 工具注册表（`registry.ts`）

工具管理的中心枢纽：

- 注册来自已发现插件与 MCP 服务器的工具
- 使用基于优先级的解析处理工具名冲突
- 将命令路由到合适的处理器
- 提供搜索与过滤能力
- 发出注册与连接状态事件

**关键特性：**
- 工具使用命名空间（例如 `plugin-name:tool-name`）
- 用于冲突解析的优先级系统（高优先级胜出）
- 短名查找（即使有命名空间也能找到 `tool-name`）
- 用于监控注册表状态的事件监听器

### 权限适配器（`permission-adapter.ts`）

将外部工具集成到 WISE 权限系统：

- 为只读工具维护安全模式
- 自动批准已知安全操作
- 对危险操作（写入、执行）提示用户
- 缓存权限决策
- 确定工具执行的委派目标

**安全模式：**
- 常见 MCP 工具的内置模式（文件系统读取、context7 查询）
- 来自清单的插件贡献模式
- 可在运行时注册自定义模式

### MCP 桥接（`mcp-bridge.ts`）

管理 MCP 服务器连接：

- 派生服务器进程
- 发送 JSON-RPC 请求并处理响应
- 从服务器发现工具与资源
- 将工具调用路由到服务器
- 处理连接生命周期（连接、断开、重连）

**协议：** 基于进程 stdio 的 JSON-RPC 2.0，使用换行分隔消息

<a id="plugin-discovery"></a>
## 插件发现

### 目录结构

插件从 `~/.claude/plugins/` 与 `~/.claude/installed-plugins/` 发现：

```
~/.claude/plugins/
├── my-plugin/
│   ├── plugin.json          (required)
│   ├── skills/              (optional)
│   │   ├── skill-1/
│   │   │   └── SKILL.md
│   │   └── skill-2/
│   │       └── SKILL.md
│   ├── agents/              (optional)
│   │   ├── agent-1.md
│   │   └── agent-2.md
│   └── commands/            (optional)
└── another-plugin/
    └── plugin.json
```

### 插件清单结构

`plugin.json` 定义插件的元数据与工具：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "namespace": "my-plugin",
  "skills": "./skills/",
  "agents": "./agents/",
  "commands": "./commands/",
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["server.js"],
      "env": {},
      "enabled": true,
      "description": "My MCP server"
    }
  },
  "permissions": [
    {
      "tool": "my-plugin:search",
      "scope": "read",
      "patterns": [".*"],
      "reason": "Search is read-only"
    }
  ],
  "tools": [
    {
      "name": "my-tool",
      "description": "Does something useful",
      "handler": "tools/my-tool.js",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" }
        }
      }
    }
  ]
}
```

### 技能与智能体发现

**技能**从受支持技能目录中的 `SKILL.md` 文件发现。WISE 的规范项目本地写入目标仍是 `.wise/skills/`，同时还从 `.claude/skills/` 读取 Claude Code 项目技能，并从 `.agents/skills/` 读取项目本地兼容技能。每个技能目录必须包含带 frontmatter 的 SKILL.md：

```markdown
---
name: my-skill
description: Describes what this skill does
tags: tag1, tag2
---

Skill documentation here...
```

**智能体**从 agents 目录中带类似 frontmatter 结构的 `.md` 文件发现。受支持的运行时字段取决于 Claude Code；WISE 捆绑的 agent 文件当前依赖 `name`、`description`、`model`、可选工具限制与 prompt 正文指引。它们当前不附带 `effort:` frontmatter 覆盖，因此 effort 继承自父 Claude Code 会话，除非自定义 agent 显式添加。

<a id="mcp-server-discovery"></a>
## MCP 服务器发现

### Claude Desktop 配置

位于 `~/.claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/"],
      "enabled": true
    },
    "web": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-web"],
      "enabled": true
    }
  }
}
```

### Claude Code 设置

位于 `~/.claude/settings.json`：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "API_KEY": "secret"
      }
    }
  }
}
```

### 远程 MCP / 远程 WISE 形态

WISE 可在统一注册表中同步并保留**远程 MCP** 条目。这是「连接远程 WISE」受支持的窄化答案：

```json
{
  "mcpServers": {
    "remoteWise": {
      "url": "https://lab.example.com/mcp",
      "timeout": 30
    }
  }
}
```

这支持远程 MCP 端点。它**不会**创建通用多主机 WISE 集群或透明共享远程文件系统视图。

### 插件内嵌 MCP 服务器

插件可在其清单中定义 MCP 服务器：

```json
{
  "name": "plugin-with-server",
  "mcpServers": {
    "my-mcp": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
```

<a id="plugin-manifest-format"></a>
## 插件清单格式

### 完整 Schema

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `name` | string | 是 | 插件名（字母数字、连字符、下划线） |
| `version` | string | 是 | 语义版本（例如 "1.0.0"） |
| `description` | string | 否 | 人类可读说明 |
| `namespace` | string | 否 | 工具名前缀（默认为插件名） |
| `skills` | string\|string[] | 否 | 技能目录路径 |
| `agents` | string\|string[] | 否 | agents 目录路径 |
| `commands` | string\|string[] | 否 | commands 目录路径 |
| `mcpServers` | object | 否 | MCP 服务器配置（name → McpServerEntry） |
| `permissions` | PluginPermission[] | 否 | 插件工具所需权限 |
| `tools` | PluginToolDefinition[] | 否 | 工具定义 |

### McpServerEntry

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `command` | string | 是 | 运行服务器的命令（例如 "node"、"npx"） |
| `args` | string[] | 否 | 命令参数 |
| `env` | object | 否 | 传递给服务器的环境变量 |
| `enabled` | boolean | 否 | 服务器是否在初始化时连接（默认：true） |
| `description` | string | 否 | 人类可读说明 |

### PluginPermission

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `tool` | string | 需要权限的工具名 |
| `scope` | "read"\|"write"\|"execute"\|"all" | 权限作用域 |
| `patterns` | string[] | 允许路径/命令的正则模式 |
| `reason` | string | 为何需要此权限 |

### PluginToolDefinition

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `name` | string | 工具名（变为 `namespace:name`） |
| `description` | string | 人类可读说明 |
| `handler` | string | 处理器函数或命令的路径 |
| `inputSchema` | object | 工具输入的 JSON Schema |

<a id="tool-registration"></a>
## 工具注册

### 注册流程

工具按以下顺序注册：

1. **插件发现** - 在配置路径中找到的插件
2. **工具提取** - 从插件提取技能、智能体与工具定义
3. **MCP 服务器发现** - 从配置文件发现的 MCP 服务器
4. **工具转换** - 将 MCP 工具转换为 ExternalTool 格式
5. **冲突解析** - 同名工具按优先级解析

### 工具命名

工具使用命名空间格式：

```
{namespace}:{tool-name}

Examples:
- my-plugin:search
- filesystem:read_file
- context7:query-docs
```

短名同样可用：
```javascript
getRegistry().getTool('search')     // Finds 'my-plugin:search'
getRegistry().getTool('my-plugin:search')  // Exact match
```

### 冲突解析

当两个插件提供同名工具时：

1. **优先级值** - 高优先级工具胜出（默认：50）
2. **命名空间** - 使用完整命名空间名消歧
3. **手动** - 检查冲突并以不同优先级重新注册

```javascript
// Check for conflicts
const conflicts = registry.getConflicts();

// Get winner for conflict
const winner = conflicts[0].winner;
console.log(`${winner.source} won with priority ${winner.priority}`);
```

<a id="permission-system"></a>
## 权限系统

### 安全模式

只读工具自动批准，无需提示用户：

```javascript
// Check if tool is safe
const result = checkPermission('mcp__filesystem__read_file');
// { allowed: true, reason: "Filesystem read (read-only)" }
```

内置安全模式覆盖：

- **Context7** - 文档查询（只读）
- **Filesystem** - 仅读操作
- **Exa** - 网页搜索（只读、外部）

### 权限检查流程

```
Tool invocation
    ↓
Check safe patterns → Allowed (no prompt needed)
    ↓ (not in safe patterns)
Check dangerous patterns → Ask user
    ↓ (not dangerous)
Check tool capabilities → Safe caps (auto-approve) or Dangerous (ask user)
    ↓
Execute or Deny
```

### 自动批准示例

```javascript
// Read-only tools are safe
checkPermission('my-plugin:search')
// { allowed: true, reason: "Tool has safe capabilities: search" }

// Write/execute requires user confirmation
checkPermission('filesystem:write_file', { path: '/etc/passwd' })
// { allowed: false, askUser: true, reason: "Tool requires explicit permission" }
```

### 缓存权限

权限决策会被缓存。用户可持久授权或拒绝：

```javascript
// User grants permission
grantPermission('custom:dangerous-tool', { mode: 'aggressive' });

// Later calls use cached decision
checkPermission('custom:dangerous-tool', { mode: 'aggressive' });
// { allowed: true, reason: "User granted permission" }

// Clear cache when needed
clearPermissionCache();
```

### 注册安全模式

插件可在清单中注册安全模式：

```json
{
  "name": "my-plugin",
  "permissions": [
    {
      "tool": "my-plugin:query-docs",
      "scope": "read",
      "patterns": [".*"],
      "reason": "Documentation lookup is read-only"
    }
  ]
}
```

插件初始化时这些会自动集成。

<a id="mcp-bridge"></a>
## MCP 桥接

### 连接服务器

```javascript
import { getMcpBridge } from './compatibility';

const bridge = getMcpBridge();

// Connect to a single server
const tools = await bridge.connect('filesystem');
console.log(`Connected. Available tools: ${tools.map(t => t.name).join(', ')}`);

// Auto-connect all enabled servers
const results = await bridge.autoConnect();
for (const [serverName, tools] of results) {
  console.log(`${serverName}: ${tools.length} tools`);
}
```

### 调用工具

```javascript
// Invoke a tool on an MCP server
const result = await bridge.invokeTool('filesystem', 'read_file', {
  path: '/home/user/.bashrc'
});

if (result.success) {
  console.log('File contents:', result.data);
  console.log('Time:', result.executionTime, 'ms');
} else {
  console.error('Error:', result.error);
}
```

### 读取资源

部分 MCP 服务器提供资源（文档、API 等）：

```javascript
// Read a resource
const result = await bridge.readResource('web', 'https://example.com');

if (result.success) {
  console.log(result.data);
}
```

### 连接管理

```javascript
// Check connection status
if (bridge.isConnected('filesystem')) {
  console.log('Connected to filesystem server');
}

// Get all server tools and resources
const tools = bridge.getServerTools('filesystem');
const resources = bridge.getServerResources('web');

// Disconnect from server
bridge.disconnect('filesystem');

// Disconnect from all servers
bridge.disconnectAll();
```

### 事件

监控桥接活动：

```javascript
const bridge = getMcpBridge();

bridge.on('server-connected', ({ server, toolCount }) => {
  console.log(`Connected to ${server} with ${toolCount} tools`);
});

bridge.on('server-disconnected', ({ server, code }) => {
  console.log(`Disconnected from ${server}`);
});

bridge.on('server-error', ({ server, error }) => {
  console.error(`Error from ${server}:`, error);
});
```

<a id="api-reference"></a>
## API 参考

### 初始化

```typescript
import {
  initializeCompatibility,
  getRegistry,
  getMcpBridge
} from './compatibility';

// Initialize everything
const result = await initializeCompatibility({
  pluginPaths: ['~/.claude/plugins'],
  mcpConfigPath: '~/.claude/claude_desktop_config.json',
  autoConnect: true  // Auto-connect to MCP servers
});

console.log(`Plugins: ${result.pluginCount}`);
console.log(`MCP servers: ${result.mcpServerCount}`);
console.log(`Tools: ${result.toolCount}`);
console.log(`Connected: ${result.connectedServers.join(', ')}`);
```

### 发现函数

```typescript
import {
  discoverPlugins,
  discoverMcpServers,
  discoverAll,
  isPluginInstalled,
  getPluginInfo,
  getPluginPaths,
  getMcpConfigPath
} from './compatibility';

// Discover plugins from custom paths
const plugins = discoverPlugins({
  pluginPaths: ['/custom/plugins/path']
});

// Discover MCP servers
const servers = discoverMcpServers({
  mcpConfigPath: '~/.claude/claude_desktop_config.json',
  settingsPath: '~/.claude/settings.json'
});

// Discover everything at once
const result = discoverAll({
  force: true  // Force re-discovery even if cached
});

// Check plugin installation
if (isPluginInstalled('my-plugin')) {
  const info = getPluginInfo('my-plugin');
  console.log(`${info.name} v${info.version}`);
}

// Get configured paths
const pluginPaths = getPluginPaths();
const mcpPath = getMcpConfigPath();
```

### 注册表函数

```typescript
import {
  getRegistry,
  initializeRegistry,
  routeCommand,
  getExternalTool,
  listExternalTools,
  hasExternalPlugins,
  hasMcpServers
} from './compatibility';

const registry = getRegistry();

// Register discovery and tools
await initializeRegistry({ force: true });

// Access tools
const allTools = listExternalTools();
const tool = getExternalTool('my-plugin:search');

// Route command
const route = routeCommand('search');
if (route) {
  console.log(`Handler: ${route.handler}`);
  console.log(`Requires permission: ${route.requiresPermission}`);
}

// Check what's available
if (hasExternalPlugins()) {
  console.log('External plugins available');
}
if (hasMcpServers()) {
  console.log('MCP servers available');
}

// Get all plugins and servers
const plugins = registry.getAllPlugins();
const servers = registry.getAllMcpServers();

// Search tools
const results = registry.searchTools('filesystem');

// Listen to events
registry.addEventListener(event => {
  if (event.type === 'tool-registered') {
    console.log(`Registered: ${event.data.tool}`);
  }
});
```

### 权限函数

```typescript
import {
  checkPermission,
  grantPermission,
  denyPermission,
  clearPermissionCache,
  addSafePattern,
  getSafePatterns,
  shouldDelegate,
  getDelegationTarget,
  integrateWithPermissionSystem,
  processExternalToolPermission
} from './compatibility';

// Check if tool is allowed
const check = checkPermission('my-tool:dangerous-op');
if (check.allowed) {
  console.log('Allowed:', check.reason);
} else if (check.askUser) {
  console.log('Ask user:', check.reason);
}

// Cache user decisions
grantPermission('custom:tool', { mode: 'aggressive' });
denyPermission('risky:tool');
clearPermissionCache();

// Manage safe patterns
const patterns = getSafePatterns();
addSafePattern({
  tool: 'my-safe-tool',
  pattern: /^\/safe\/path/,
  description: 'Only allows /safe/path',
  source: 'myapp'
});

// Check if tool should be delegated
if (shouldDelegate('external:tool')) {
  const target = getDelegationTarget('external:tool');
  console.log(`Delegate to: ${target.type}/${target.target}`);
}

// Integrate with permission system at startup
integrateWithPermissionSystem();
```

### MCP 桥接函数

```typescript
import {
  getMcpBridge,
  resetMcpBridge,
  invokeMcpTool,
  readMcpResource
} from './compatibility';

const bridge = getMcpBridge();

// Connect to server
const tools = await bridge.connect('filesystem');

// Invoke tool
const result = await invokeMcpTool('filesystem', 'read_file', {
  path: '/etc/hosts'
});

// Read resource
const resourceResult = await readMcpResource('web', 'https://api.example.com');

// Check connections
const status = bridge.getConnectionStatus();

// Clean up
bridge.disconnectAll();
resetMcpBridge();
```

<a id="examples"></a>
## 示例

### 示例 1：初始化并列出工具

```javascript
import { initializeCompatibility, getRegistry } from './compatibility';

async function listAvailableTools() {
  // Initialize the compatibility layer
  const result = await initializeCompatibility({
    autoConnect: true
  });

  console.log(`Discovered ${result.pluginCount} plugins`);
  console.log(`Connected to ${result.connectedServers.length} MCP servers`);

  // List all available tools
  const registry = getRegistry();
  const tools = registry.getAllTools();

  console.log('\nAvailable tools:');
  for (const tool of tools) {
    console.log(`  ${tool.name} (${tool.type})`);
    console.log(`    Description: ${tool.description}`);
    console.log(`    Capabilities: ${tool.capabilities?.join(', ')}`);
  }
}

listAvailableTools().catch(console.error);
```

### 示例 2：搜索并使用工具

```javascript
import {
  initializeCompatibility,
  getRegistry,
  checkPermission,
  getMcpBridge
} from './compatibility';

async function searchAndRead() {
  await initializeCompatibility();

  const registry = getRegistry();

  // Search for filesystem tools
  const fileTools = registry.searchTools('filesystem');
  console.log(`Found ${fileTools.length} filesystem tools`);

  // Find read_file tool
  const readTool = fileTools.find(t => t.name.includes('read'));

  if (readTool) {
    // Check permission
    const perm = checkPermission(readTool.name);

    if (perm.allowed) {
      const bridge = getMcpBridge();
      const result = await bridge.invokeTool(
        readTool.source,
        'read_file',
        { path: '/etc/hosts' }
      );

      if (result.success) {
        console.log('File contents:', result.data);
      }
    }
  }
}

searchAndRead().catch(console.error);
```

### 示例 3：处理带 MCP 服务器的插件

```javascript
import {
  discoverPlugins,
  initializeRegistry,
  getMcpBridge
} from './compatibility';

async function setupPluginMcp() {
  // Discover plugins (includes MCP servers defined in manifests)
  const plugins = discoverPlugins();
  const pluginWithMcp = plugins.find(p => p.manifest.mcpServers);

  if (pluginWithMcp) {
    console.log(`Plugin ${pluginWithMcp.name} has embedded MCP servers:`);
    for (const serverName of Object.keys(pluginWithMcp.manifest.mcpServers || {})) {
      console.log(`  - ${serverName}`);
    }

    // Initialize registry (registers MCP servers from plugins)
    await initializeRegistry();

    // Connect to plugin's MCP server
    const bridge = getMcpBridge();
    const fullServerName = `${pluginWithMcp.name}:${serverName}`;

    try {
      const tools = await bridge.connect(fullServerName);
      console.log(`Connected to ${fullServerName} with ${tools.length} tools`);
    } catch (err) {
      console.error('Failed to connect:', err.message);
    }
  }
}

setupPluginMcp().catch(console.error);
```

### 示例 4：冲突解析

```javascript
import { getRegistry } from './compatibility';

function showConflicts() {
  const registry = getRegistry();
  const conflicts = registry.getConflicts();

  if (conflicts.length === 0) {
    console.log('No tool conflicts');
    return;
  }

  console.log(`Found ${conflicts.length} conflicts:\n`);

  for (const conflict of conflicts) {
    console.log(`Tool: ${conflict.name}`);
    console.log(`  Winner: ${conflict.winner.source} (priority: ${conflict.winner.priority})`);
    console.log('  Alternatives:');
    for (const tool of conflict.tools) {
      if (tool !== conflict.winner) {
        console.log(`    - ${tool.source} (priority: ${tool.priority})`);
      }
    }
    console.log();
  }
}

showConflicts();
```

### 示例 5：自定义权限模式

```javascript
import {
  addSafePattern,
  checkPermission,
  getSafePatterns
} from './compatibility';

function registerCustomPatterns() {
  // Register a safe pattern for a plugin tool
  addSafePattern({
    tool: 'analytics:track',
    pattern: /^(page_view|event|error)$/,
    description: 'Only allows tracking specific event types',
    source: 'myapp'
  });

  // Now check permission with valid input
  let result = checkPermission('analytics:track');
  console.log('Safe:', result.allowed);  // true

  // View all patterns
  const patterns = getSafePatterns();
  const myPatterns = patterns.filter(p => p.source === 'myapp');
  console.log('My patterns:', myPatterns.length);
}

registerCustomPatterns();
```

<a id="troubleshooting"></a>
## 故障排查

### 插件未被发现

**问题：** `discoverPlugins()` 返回空数组。

**检查清单：**
- 插件位于 `~/.claude/plugins/` 或 `~/.claude/installed-plugins/`
- 每个插件在根目录或 `.claude-plugin/` 子目录有 `plugin.json`
- 插件名不与保留名冲突（例如 'wise'）
- 文件权限允许读取该目录

**调试：**
```javascript
import { getPluginPaths } from './compatibility';

const paths = getPluginPaths();
console.log('Scanning paths:', paths);

// Check if directory exists
import { existsSync } from 'fs';
for (const path of paths) {
  console.log(`${path}: ${existsSync(path) ? 'exists' : 'missing'}`);
}
```

### MCP 服务器无法连接

**问题：** `bridge.connect()` 超时。

**检查清单：**
- 服务器命令正确（例如 `npx`、`node`）
- 命令可执行且在 PATH 中
- 参数有效
- 服务器实现 MCP 协议（JSON-RPC 2.0）
- 检查 stderr 输出的错误

**调试：**
```javascript
import { getMcpBridge } from './compatibility';

const bridge = getMcpBridge();

bridge.on('server-error', ({ server, error }) => {
  console.error(`Server error from ${server}:`, error);
});

bridge.on('connect-error', ({ server, error }) => {
  console.error(`Failed to connect to ${server}:`, error);
});
```

### 工具未显示

**问题：** 已注册工具未出现在 `getRegistry().getAllTools()` 中。

**原因与解决方案：**
- 插件未发现 - 先检查插件发现
- 工具未提取 - 确保技能目录中存在 SKILL.md 文件
- 命名空间冲突 - 两个插件使用同一命名空间
- 工具注册失败 - 检查注册表事件中的错误

**调试：**
```javascript
import { getRegistry, discoverPlugins } from './compatibility';

const plugins = discoverPlugins();
for (const plugin of plugins) {
  console.log(`${plugin.name}: ${plugin.tools.length} tools`);
  for (const tool of plugin.tools) {
    console.log(`  - ${tool.name}`);
  }
}

// Check what's actually registered
const registry = getRegistry();
const registered = registry.getAllTools();
console.log(`Registry has ${registered.length} tools`);

// Listen for registration events
registry.addEventListener(event => {
  if (event.type === 'tool-registered') {
    console.log('Registered:', event.data.tool);
  } else if (event.type === 'tool-conflict') {
    console.log('Conflict:', event.data.name, '→', event.data.winner);
  }
});
```

### 权限总是被拒绝

**问题：** 需要权限的工具即使用户批准后也总是被拒绝。

**解决方案：**
- 清除权限缓存：`clearPermissionCache()`
- 确保缓存决策使用相同的工具名/输入
- 检查工具是否匹配覆盖缓存的危险模式

**调试：**
```javascript
import {
  checkPermission,
  grantPermission,
  getSafePatterns
} from './compatibility';

// Check if tool is in dangerous patterns
const patterns = getSafePatterns();
console.log('Safe patterns:', patterns.length);

// Manually grant
grantPermission('my-tool');

// Verify it's cached
const result = checkPermission('my-tool');
console.log('Allowed:', result.allowed);
console.log('Reason:', result.reason);
```

### 清单解析错误

**问题：** 插件加载但清单解析失败。

**检查清单：**
- `plugin.json` 是有效 JSON（使用 `npm install -g jsonlint` 校验）
- 必填字段存在：`name`、`version`
- 路径或配置无语法错误
- 文件编码为 UTF-8

**调试：**
```javascript
import { getPluginInfo } from './compatibility';

const plugin = getPluginInfo('my-plugin');
if (plugin && !plugin.loaded) {
  console.error('Failed to load:', plugin.error);
  console.log('Manifest:', plugin.manifest);
}
```

### MCP 工具调用失败

**问题：** 工具调用返回错误。

**调试：**
```javascript
import { getMcpBridge } from './compatibility';

const bridge = getMcpBridge();

// Check connection
console.log('Connected:', bridge.isConnected('myserver'));

// Get available tools
const tools = bridge.getServerTools('myserver');
console.log('Available tools:', tools.map(t => t.name));

// Try invocation with error details
const result = await bridge.invokeTool('myserver', 'tool-name', {});
if (!result.success) {
  console.error('Error:', result.error);
  console.error('Time:', result.executionTime, 'ms');
}
```

## 最佳实践

1. **尽早初始化** - 启动时调用 `initializeCompatibility()`
2. **缓存注册表** - 复用 `getRegistry()` 实例，不要重复初始化
3. **优雅处理权限** - 调用危险工具前始终检查 `checkPermission()`
4. **监控事件** - 使用事件监听器跟踪插件/服务器状态变更
5. **版本检查** - 在插件清单中包含版本约束以保障兼容
6. **本地测试插件** - 发布前用本地发现路径测试
7. **使用命名空间** - 在清单中设置 `namespace` 以避免冲突
8. **文档化权限** - 清晰说明插件为何需要特定作用域
9. **处理错误** - MCP 连接可能失败；实现重试逻辑
10. **清理** - 关闭时调用 `disconnectAll()` 与 `resetMcpBridge()`
