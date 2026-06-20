#!/usr/bin/env node

/**
 * Wise CLI
 *
 * WISE 多 agent 系统的命令行接口。
 *
 * 命令：
 * - run：启动交互式会话
 * - config：显示或编辑配置
 * - setup：同步所有 WISE 组件（hooks、agents、skills）
 *
 * 说明：命令描述及帮助文本已全部中文化。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import { writeFileSync, existsSync } from 'fs';
import { getClaudeConfigDir } from '../utils/config-dir.js';
import { WISE_PLUGIN_ROOT_ENV } from '../lib/env-vars.js';
import {
  loadConfig,
  getConfigPaths,
} from '../config/loader.js';
import { createWiseSession } from '../index.js';
import {
  checkForUpdates,
  performUpdate,
  formatUpdateNotification,
  getInstalledVersion,
  getWiseConfig,
  reconcileUpdateRuntime,
  CONFIG_FILE,
  type WiseConfig,
} from '../features/auto-update.js';
import {
  install as installWise,
  isInstalled,
  getInstallInfo
} from '../installer/index.js';
import {
  waitCommand,
  waitStatusCommand,
  waitDaemonCommand,
  waitDetectCommand
} from './commands/wait.js';
import { doctorConflictsCommand } from './commands/doctor-conflicts.js';
import { doctorTeamRoutingCommand } from './commands/doctor-team-routing.js';
import { sessionSearchCommand } from './commands/session-search.js';
import { teamCommand } from './commands/team.js';
import { ralphthonCommand } from './commands/ralphthon.js';
import { ultragoalCommand, ULTRAGOAL_HELP } from './commands/ultragoal.js';
import {
  teleportCommand,
  teleportListCommand,
  teleportRemoveCommand
} from './commands/teleport.js';

import { getRuntimePackageVersion } from '../lib/version.js';
import { resolvePluginDirArg } from '../lib/plugin-dir.js';
import { launchCommand } from './launch.js';
import { interopCommand } from './interop.js';
import { askCommand, ASK_USAGE } from './ask.js';
import { warnIfWin32 } from './win32-warning.js';
import { autoresearchCommand } from './autoresearch.js';
import { runHudWatchLoop } from './hud-watch.js';

const version = getRuntimePackageVersion();

/**
 * 应用 --plugin-dir 选项值：解析为绝对路径，若与已存在的 WISE_PLUGIN_ROOT 环境变量不一致则告警，
 * 然后设置该环境变量，使本进程中后续所有代码都能看到正确的 plugin 根目录。
 *
 * 当 `rawPath` 为 undefined/空（未传入该选项）时为空操作。
 */
export function applyPluginDirOption(rawPath: string | undefined): void {
  if (!rawPath) return;
  let resolved: string;
  try {
    resolved = resolvePluginDirArg(rawPath);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
  const existing = process.env[WISE_PLUGIN_ROOT_ENV];
  if (existing && existing !== resolved) {
    console.warn(
      chalk.yellow(
        `Warning: --plugin-dir "${resolved}" overrides ${WISE_PLUGIN_ROOT_ENV}="${existing}"`
      )
    );
  }
  process.env[WISE_PLUGIN_ROOT_ENV] = resolved;
}

const program = new Command();

// Win32 平台告警 - WISE 依赖 tmux，原生 Windows 上不可用
warnIfWin32();

// 不带子命令直接运行 'wise' 时的默认动作
// 将所有参数转发给 launchCommand，使 'wise --notify false --madmax' 等可直接生效
async function defaultAction() {
  // 将所有 CLI 参数透传给 launch（去掉 node 和脚本路径）
  const args = process.argv.slice(2);

  // 防御性兜底：wrapper/bridge 调用必须保留显式的 ask 路由，
  // 使嵌套的 Claude 启动检查仅对真正的 Claude 启动生效。
  if (args[0] === 'ask') {
    await askCommand(args.slice(1));
    return;
  }

  await launchCommand(args);
}


program
  .name('wise')
  .description('Claude Code 自进化多智能体编排系统')
  .version(version)
  .allowUnknownOption()
  .action(defaultAction);

/**
 * Launch 命令 - 为 Claude Code 提供原生 tmux shell 启动
 */
program
  .command('launch [args...]')
  .description('启动 Claude Code 并集成原生 tmux shell')
  .allowUnknownOption()
  .addHelpText('after', `
示例：
  $ wise                                启动 Claude Code
  $ wise --madmax                       以权限绕过模式启动
  $ wise --yolo                         以权限绕过模式启动（别名）
  $ wise --notify false                 启动但不发送 CCNotifier 事件
  $ wise launch                         显式启动子命令（与裸 wise 相同）
  $ wise launch --madmax                带标志显式启动

选项：
  --notify <bool>   启用/禁用 CCNotifier 事件。false 设置 WISE_NOTIFY=0
                    并抑制所有 stop/session-start/session-idle 通知。
                    默认值：true

环境变量：
  WISE_NOTIFY=0              抑制所有通知（由 --notify false 设置）
`)
  .action(async (args: string[]) => {
    await launchCommand(args);
  });

/**
 * Interop 命令 - WISE 与 OMX 的 tmux 分屏会话
 */
program
  .command('interop')
  .description('启动 Claude Code (WISE) 与 Codex (OMX) 的 tmux 分屏会话')
  .addHelpText('after', `
前置条件：
  - 必须在 tmux 会话中运行
  - 需要已安装 Claude CLI
  - 推荐安装 Codex CLI（未安装时会优雅降级）`)
  .action(() => {
    interopCommand();
  });

/**
 * Ask 命令 - 运行 provider advisor prompt（claude|gemini）
 */
program
  .command('ask [args...]')
  .description('运行 provider advisor prompt 并写入 ask 制品')
  .allowUnknownOption()
  .addHelpText('after', `\n${ASK_USAGE}`)
  .action(async (args: string[]) => {
    await askCommand(args || []);
  });


/**
 * Config 命令 - 显示或校验配置
 */
program
  .command('config')
  .description('显示当前配置')
  .option('-v, --validate', '校验配置')
  .option('-p, --paths', '显示配置文件路径')
  .addHelpText('after', `
示例：
  $ wise config                   显示当前配置
  $ wise config --validate         校验配置文件
  $ wise config --paths           显示配置文件路径

  }`)
  .action(async (options) => {
    if (options.paths) {
      const paths = getConfigPaths();
      console.log(chalk.blue('配置文件路径：'));
      console.log(`  用户：    ${paths.user}`);
      console.log(`  项目：${paths.project}`);

      console.log(chalk.blue('\n文件状态：'));
      console.log(`  用户：    ${existsSync(paths.user) ? chalk.green('已存在') : chalk.gray('未找到')}`);
      console.log(`  项目：${existsSync(paths.project) ? chalk.green('已存在') : chalk.gray('未找到')}`);
      return;
    }

    const config = loadConfig();

    if (options.validate) {
      console.log(chalk.blue('正在校验配置…\n'));

      // 检查必填字段
      const warnings: string[] = [];
      const errors: string[] = [];

      if (!process.env.ANTHROPIC_API_KEY) {
        warnings.push('ANTHROPIC_API_KEY 环境变量未设置');
      }

      if (config.mcpServers?.exa?.enabled && !process.env.EXA_API_KEY && !config.mcpServers.exa.apiKey) {
        warnings.push('Exa 已启用但 EXA_API_KEY 未设置');
      }

      if (errors.length > 0) {
        console.log(chalk.red('错误：'));
        errors.forEach(e => console.log(chalk.red(`  - ${e}`)));
      }

      if (warnings.length > 0) {
        console.log(chalk.yellow('警告：'));
        warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
      }

      if (errors.length === 0 && warnings.length === 0) {
        console.log(chalk.green('配置有效！'));
      }

      return;
    }

    console.log(chalk.blue('当前配置：\n'));
    console.log(JSON.stringify(config, null, 2));
  });

/**
 * Config stop-callback 子命令 - 配置 stop 钩子回调
 */
const _configStopCallback = program
  .command('config-stop-callback <type>')
  .description('配置 stop 钩子回调（file/telegram/discord/slack）')
  .option('--enable', '启用回调')
  .option('--disable', '禁用回调')
  .option('--path <path>', '文件路径（支持 {session_id}, {date}, {time}）')
  .option('--format <format>', '文件格式：markdown | json')
  .option('--token <token>', 'Bot 令牌（telegram 或 discord-bot）')
  .option('--chat <id>', 'Telegram 聊天 ID')
  .option('--webhook <url>', 'Discord webhook URL')
  .option('--channel-id <id>', 'Discord bot 频道 ID（与 --profile 一起使用）')
  .option('--tag-list <csv>', '替换标签列表（逗号分隔，仅 telegram/discord）')
  .option('--add-tag <tag>', '添加一个标签（仅 telegram/discord）')
  .option('--remove-tag <tag>', '移除一个标签（仅 telegram/discord）')
  .option('--clear-tags', '清空所有标签（仅 telegram/discord）')
  .option('--profile <name>', '要配置的通知 profile 名称')
  .option('--show', '显示当前配置')
  .addHelpText('after', `
类型：
  file       文件系统回调（将会话摘要保存到磁盘）
  telegram   Telegram bot 通知
  discord    Discord webhook 通知
  slack      Slack incoming webhook 通知

Profile 类型（与 --profile 一起使用）：
  discord-bot  Discord Bot API（token + 频道 ID）
  slack        Slack incoming webhook
  webhook      通用 webhook（POST JSON 请求体）

示例：
  $ wise config-stop-callback file --enable --path ${join(getClaudeConfigDir(), 'logs/{date}.md')}
  $ wise config-stop-callback telegram --enable --token <token> --chat <id>
  $ wise config-stop-callback discord --enable --webhook <url>
  $ wise config-stop-callback file --disable
  $ wise config-stop-callback file --show

  # 命名 profile（存储在 notificationProfiles 中）：
  $ wise config-stop-callback discord --profile work --enable --webhook <url>
  $ wise config-stop-callback telegram --profile work --enable --token <tk> --chat <id>
  $ wise config-stop-callback discord-bot --profile ops --enable --token <tk> --channel-id <id>

  # 启动时选择 profile：
  $ WISE_NOTIFY_PROFILE=work claude`)
  .action(async (type: string, options) => {
    // 当使用 --profile 时，路由到基于 profile 的配置
    if (options.profile) {
      const profileValidTypes = ['file', 'telegram', 'discord', 'discord-bot', 'slack', 'webhook'];
      if (!profileValidTypes.includes(type)) {
        console.error(chalk.red(`无效的 profile 类型：${type}`));
        console.error(chalk.gray(`有效类型：${profileValidTypes.join(', ')}`));
        process.exit(1);
      }

      const config = getWiseConfig() as WiseConfig & { notificationProfiles?: Record<string, any> };
      config.notificationProfiles = config.notificationProfiles || {};
      const profileName = options.profile as string;
      const profile = config.notificationProfiles[profileName] || { enabled: true };

      // 显示当前 profile 配置
      if (options.show) {
        if (config.notificationProfiles[profileName]) {
          console.log(chalk.blue(`Profile "${profileName}" — ${type} 配置：`));
          const platformConfig = profile[type];
          if (platformConfig) {
            console.log(JSON.stringify(platformConfig, null, 2));
          } else {
            console.log(chalk.yellow(`Profile "${profileName}" 中未配置 ${type} 平台。`));
          }
        } else {
          console.log(chalk.yellow(`未找到 Profile "${profileName}"。`));
        }
        return;
      }

      let enabled: boolean | undefined;
      if (options.enable) enabled = true;
      else if (options.disable) enabled = false;

      switch (type) {
        case 'discord': {
          const current = profile.discord;
          if (enabled === true && (!options.webhook && !current?.webhookUrl)) {
            console.error(chalk.red('Discord 需要 --webhook <webhook_url>'));
            process.exit(1);
          }
          profile.discord = {
            ...current,
            enabled: enabled ?? current?.enabled ?? false,
            webhookUrl: options.webhook ?? current?.webhookUrl,
          };
          break;
        }
        case 'discord-bot': {
          const current = profile['discord-bot'];
          if (enabled === true && (!options.token && !current?.botToken)) {
            console.error(chalk.red('Discord bot 需要 --token <bot_token>'));
            process.exit(1);
          }
          if (enabled === true && (!options.channelId && !current?.channelId)) {
            console.error(chalk.red('Discord bot 需要 --channel-id <channel_id>'));
            process.exit(1);
          }
          profile['discord-bot'] = {
            ...current,
            enabled: enabled ?? current?.enabled ?? false,
            botToken: options.token ?? current?.botToken,
            channelId: options.channelId ?? current?.channelId,
          };
          break;
        }
        case 'telegram': {
          const current = profile.telegram;
          if (enabled === true && (!options.token && !current?.botToken)) {
            console.error(chalk.red('Telegram 需要 --token <bot_token>'));
            process.exit(1);
          }
          if (enabled === true && (!options.chat && !current?.chatId)) {
            console.error(chalk.red('Telegram 需要 --chat <chat_id>'));
            process.exit(1);
          }
          profile.telegram = {
            ...current,
            enabled: enabled ?? current?.enabled ?? false,
            botToken: options.token ?? current?.botToken,
            chatId: options.chat ?? current?.chatId,
          };
          break;
        }
        case 'slack': {
          const current = profile.slack;
          if (enabled === true && (!options.webhook && !current?.webhookUrl)) {
            console.error(chalk.red('Slack 需要 --webhook <webhook_url>'));
            process.exit(1);
          }
          profile.slack = {
            ...current,
            enabled: enabled ?? current?.enabled ?? false,
            webhookUrl: options.webhook ?? current?.webhookUrl,
          };
          break;
        }
        case 'webhook': {
          const current = profile.webhook;
          if (enabled === true && (!options.webhook && !current?.url)) {
            console.error(chalk.red('Webhook 需要 --webhook <url>'));
            process.exit(1);
          }
          profile.webhook = {
            ...current,
            enabled: enabled ?? current?.enabled ?? false,
            url: options.webhook ?? current?.url,
          };
          break;
        }
        case 'file': {
          console.error(chalk.yellow('通知 profile 不支持 file 回调。'));
          console.error(chalk.gray('请不使用 --profile 来配置 file 回调。'));
          process.exit(1);
          break;
        }
      }

      config.notificationProfiles[profileName] = profile;

      try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green(`\u2713 Profile "${profileName}" — ${type} 已配置`));
        console.log(JSON.stringify(profile[type], null, 2));
      } catch (error) {
        console.error(chalk.red('写入配置失败：'), error);
        process.exit(1);
      }
      return;
    }

    // 旧版（非 profile）路径
    const validTypes = ['file', 'telegram', 'discord', 'slack'];
    if (!validTypes.includes(type)) {
      console.error(chalk.red(`无效的回调类型：${type}`));
      console.error(chalk.gray(`有效类型：${validTypes.join(', ')}`));
      process.exit(1);
    }

    const config = getWiseConfig();
    config.stopHookCallbacks = config.stopHookCallbacks || {};

    // 显示当前配置
    if (options.show) {
      const current = config.stopHookCallbacks[type as keyof typeof config.stopHookCallbacks];
      if (current) {
        console.log(chalk.blue(`当前 ${type} 回调配置：`));
        console.log(JSON.stringify(current, null, 2));
      } else {
        console.log(chalk.yellow(`未配置 ${type} 回调。`));
      }
      return;
    }

    // 判断启用状态
    let enabled: boolean | undefined;
    if (options.enable) {
      enabled = true;
    } else if (options.disable) {
      enabled = false;
    }

    const hasTagListChanges = options.tagList !== undefined
      || options.addTag !== undefined
      || options.removeTag !== undefined
      || options.clearTags;

    const parseTagList = (value: string): string[] => value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const resolveTagList = (currentTagList?: string[]): string[] => {
      let next = options.tagList !== undefined
        ? parseTagList(options.tagList)
        : [...(currentTagList ?? [])];

      if (options.clearTags) {
        next = [];
      }

      if (options.addTag !== undefined) {
        const tagToAdd = String(options.addTag).trim();
        if (tagToAdd && !next.includes(tagToAdd)) {
          next.push(tagToAdd);
        }
      }

      if (options.removeTag !== undefined) {
        const tagToRemove = String(options.removeTag).trim();
        if (tagToRemove) {
          next = next.filter((tag) => tag !== tagToRemove);
        }
      }

      return next;
    };

    // 根据 type 更新配置
    switch (type) {
      case 'file': {
        const current = config.stopHookCallbacks.file;
        config.stopHookCallbacks.file = {
          enabled: enabled ?? current?.enabled ?? false,
          path: options.path ?? current?.path ?? join(getClaudeConfigDir(), 'session-logs/{session_id}.md'),
          format: (options.format as 'markdown' | 'json') ?? current?.format ?? 'markdown',
        };
        break;
      }

      case 'telegram': {
        const current = config.stopHookCallbacks.telegram;
        if (enabled === true && (!options.token && !current?.botToken)) {
          console.error(chalk.red('Telegram 需要 --token <bot_token>'));
          process.exit(1);
        }
        if (enabled === true && (!options.chat && !current?.chatId)) {
          console.error(chalk.red('Telegram 需要 --chat <chat_id>'));
          process.exit(1);
        }
        config.stopHookCallbacks.telegram = {
          ...current,
          enabled: enabled ?? current?.enabled ?? false,
          botToken: options.token ?? current?.botToken,
          chatId: options.chat ?? current?.chatId,
          tagList: hasTagListChanges ? resolveTagList(current?.tagList) : current?.tagList,
        };
        break;
      }

      case 'discord': {
        const current = config.stopHookCallbacks.discord;
        if (enabled === true && (!options.webhook && !current?.webhookUrl)) {
          console.error(chalk.red('Discord 需要 --webhook <webhook_url>'));
          process.exit(1);
        }
        config.stopHookCallbacks.discord = {
          ...current,
          enabled: enabled ?? current?.enabled ?? false,
          webhookUrl: options.webhook ?? current?.webhookUrl,
          tagList: hasTagListChanges ? resolveTagList(current?.tagList) : current?.tagList,
        };
        break;
      }

      case 'slack': {
        const current = config.stopHookCallbacks.slack;
        if (enabled === true && (!options.webhook && !current?.webhookUrl)) {
          console.error(chalk.red('Slack 需要 --webhook <webhook_url>'));
          process.exit(1);
        }
        config.stopHookCallbacks.slack = {
          ...current,
          enabled: enabled ?? current?.enabled ?? false,
          webhookUrl: options.webhook ?? current?.webhookUrl,
          tagList: hasTagListChanges ? resolveTagList(current?.tagList) : current?.tagList,
        };
        break;
      }
    }

    // \u5199\u5165\u914d\u7f6e
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      console.log(chalk.green(`\u2713 Stop 回调 '${type}' 已配置`));
      console.log(JSON.stringify(config.stopHookCallbacks[type as keyof typeof config.stopHookCallbacks], null, 2));
    } catch (error) {
      console.error(chalk.red('写入配置失败：'), error);
      process.exit(1);
    }
  });

/**
 * Config notify-profile 子命令 - 列出、显示和删除通知 profile
 */
program
  .command('config-notify-profile [name]')
  .description('管理通知 profile')
  .option('--list', '列出所有 profile')
  .option('--show', '显示 profile 配置')
  .option('--delete', '删除一个 profile')
  .addHelpText('after', `
示例：
  $ wise config-notify-profile --list
  $ wise config-notify-profile work --show
  $ wise config-notify-profile work --delete

  # 通过 config-stop-callback --profile 创建/更新 profile：
  $ wise config-stop-callback discord --profile work --enable --webhook <url>

  # 启动时选择 profile：
  $ WISE_NOTIFY_PROFILE=work claude`)
  .action(async (name: string | undefined, options) => {
    const config = getWiseConfig() as WiseConfig & { notificationProfiles?: Record<string, any> };
    const profiles = config.notificationProfiles || {};

    if (options.list || !name) {
      const names = Object.keys(profiles);
      if (names.length === 0) {
        console.log(chalk.yellow('未配置通知 profile。'));
        console.log(chalk.gray('使用以下命令创建：wise config-stop-callback <type> --profile <name> --enable ...'));
      } else {
        console.log(chalk.blue('通知 profile：'));
        for (const pName of names) {
          const p = profiles[pName];
          const platforms = ['discord', 'discord-bot', 'telegram', 'slack', 'webhook']
            .filter((plat) => p[plat]?.enabled)
            .join(', ');
          const status = p.enabled !== false ? chalk.green('已启用') : chalk.red('已禁用');
          console.log(`  ${chalk.bold(pName)} [${status}] — ${platforms || '无平台'}`);
        }
      }
      const activeProfile = process.env.WISE_NOTIFY_PROFILE;
      if (activeProfile) {
        console.log(chalk.gray(`\n活动 profile (WISE_NOTIFY_PROFILE)： ${activeProfile}`));
      }
      return;
    }

    if (options.show) {
      if (profiles[name]) {
        console.log(chalk.blue(`Profile "${name}":`));
        console.log(JSON.stringify(profiles[name], null, 2));
      } else {
        console.log(chalk.yellow(`未找到 Profile "${name}"。`));
      }
      return;
    }

    if (options.delete) {
      if (!profiles[name]) {
        console.log(chalk.yellow(`未找到 Profile "${name}"。`));
        return;
      }
      delete profiles[name];
      config.notificationProfiles = profiles;
      if (Object.keys(profiles).length === 0) {
        delete config.notificationProfiles;
      }
      try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green(`\u2713 Profile "${name}" 已删除`));
      } catch (error) {
        console.error(chalk.red('写入配置失败：'), error);
        process.exit(1);
      }
      return;
    }

    // 默认：显示指定的 profile
    if (profiles[name]) {
      console.log(chalk.blue(`Profile "${name}":`));
      console.log(JSON.stringify(profiles[name], null, 2));
    } else {
      console.log(chalk.yellow(`未找到 Profile "${name}"。`));
      console.log(chalk.gray('使用 wise config-stop-callback <type> --profile ' + name + ' --enable ... 创建'));
    }
  });


/**
 * Info 命令 - 显示系统信息
 */
program
  .command('info')
  .description('显示系统和 agent 信息')
  .addHelpText('after', `
示例：
  $ wise info                     显示 agents、features 和 MCP servers`)
  .action(async () => {
    const session = createWiseSession();

    console.log(chalk.blue.bold('\nWise 系统信息\n'));
    console.log(chalk.gray('━'.repeat(50)));

    console.log(chalk.blue('\n可用 Agent：'));
    const agents = session.queryOptions.options.agents;
    for (const [name, agent] of Object.entries(agents)) {
      console.log(`  ${chalk.green(name)}`);
      console.log(`    ${chalk.gray(agent.description.split('\n')[0])}`);
    }

    console.log(chalk.blue('\n已启用功能：'));
    const features = session.config.features;
    if (features) {
      console.log(`  并行执行：          ${features.parallelExecution ? chalk.green('已启用') : chalk.gray('已禁用')}`);
      console.log(`  LSP 工具：          ${features.lspTools ? chalk.green('已启用') : chalk.gray('已禁用')}`);
      console.log(`  AST 工具：          ${features.astTools ? chalk.green('已启用') : chalk.gray('已禁用')}`);
      console.log(`  续行强制：          ${features.continuationEnforcement ? chalk.green('已启用') : chalk.gray('已禁用')}`);
      console.log(`  自动上下文注入：    ${features.autoContextInjection ? chalk.green('已启用') : chalk.gray('已禁用')}`);
    }

    console.log(chalk.blue('\nMCP 服务器：'));
    const mcpServers = session.queryOptions.options.mcpServers;
    for (const name of Object.keys(mcpServers)) {
      console.log(`  ${chalk.green(name)}`);
    }

    console.log(chalk.blue('\n魔法关键词：'));
    console.log(`  Ultrawork：${chalk.cyan(session.config.magicKeywords?.ultrawork?.join(', ') ?? 'ultrawork, ulw, uw')}`);
    console.log(`  Search：   ${chalk.cyan(session.config.magicKeywords?.search?.join(', ') ?? 'search, find, locate')}`);
    console.log(`  Analyze：  ${chalk.cyan(session.config.magicKeywords?.analyze?.join(', ') ?? 'analyze, investigate, examine')}`);

    console.log(chalk.gray('\n━'.repeat(50)));
    console.log(chalk.gray(`Version: ${version}`));
  });

/**
 * Test 命令 - 测试 prompt 增强
 */
program
  .command('test-prompt <prompt>')
  .description('测试 prompt 增强效果')
  .addHelpText('after', `
示例：
  $ wise test-prompt "ultrawork fix bugs"    查看魔法关键词检测效果
  $ wise test-prompt "analyze this code"     测试 prompt 增强效果`)
  .action(async (prompt: string) => {
    const session = createWiseSession();

    console.log(chalk.blue('原始 prompt：'));
    console.log(chalk.gray(prompt));

    const keywords = session.detectKeywords(prompt);
    if (keywords.length > 0) {
      console.log(chalk.blue('\n检测到魔法关键词：'));
      console.log(chalk.yellow(keywords.join(', ')));
    }

    console.log(chalk.blue('\n增强后的 prompt：'));
    console.log(chalk.green(session.processPrompt(prompt)));
  });

/**
 * Update 命令 - 检查并安装更新
 */
program
  .command('update')
  .description('检查并安装更新')
  .option('-c, --check', '仅检查更新，不安装')
  .option('-f, --force', '强制重新安装，即使已是最新版')
  .option('-q, --quiet', '静默输出，仅显示错误')
  .option('--standalone', '在插件模式下强制使用 npm 更新')
  .option('--clean', '立即清除旧插件缓存版本（跳过 24 小时宽限期）')
  .addHelpText('after', `
示例：
  $ wise update                   检查并安装更新
  $ wise update --check           仅检查，不安装
  $ wise update --force           强制重新安装
  $ wise update --standalone      在插件模式下强制使用 npm 更新`)
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('Wise 更新\n'));
    }

    try {
      // 显示当前版本
      const installed = getInstalledVersion();
      if (!options.quiet) {
        console.log(chalk.gray(`当前版本：${installed?.version ?? 'unknown'}`));
        console.log(chalk.gray(`安装方式：${installed?.installMethod ?? 'unknown'}`));
        console.log('');
      }

      // 检查更新
      if (!options.quiet) {
        console.log('正在检查更新…');
      }

      const checkResult = await checkForUpdates();

      if (!checkResult.updateAvailable && !options.force) {
        if (!options.quiet) {
          console.log(chalk.green(`\n✓ 你正在运行最新版本 (${checkResult.currentVersion})`));
        }
        return;
      }

      if (!options.quiet) {
        console.log(formatUpdateNotification(checkResult));
      }

      // 若为仅检查模式，到此为止
      if (options.check) {
        if (checkResult.updateAvailable) {
          console.log(chalk.yellow('\n不带 --check 运行以安装更新.'));
        }
        return;
      }

      // 执行更新
      if (!options.quiet) {
        console.log(chalk.blue('\n正在开始更新...\n'));
      }

      const result = await performUpdate({ verbose: !options.quiet, standalone: options.standalone, clean: options.clean });

      if (result.success) {
        if (!options.quiet) {
          console.log(chalk.green(`\n✓ ${result.message}`));
          console.log(chalk.gray('\n请重启你的 Claude Code 会话以使用新版本.'));
        }
      } else {
        console.error(chalk.red(`\n✗ ${result.message}`));
        if (result.errors) {
          result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
        }
        process.exit(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`更新失败： ${message}`));
      console.error(chalk.gray('使用 "wise update --force" 重试，或使用 "wise install --force" 重新安装。'));
      process.exit(1);
    }
  });

/**
 * Update reconcile 命令 - 用于更新后对账的内部命令
 * 在 npm install 后自动调用，以确保 hooks/settings 随新代码一起更新
 */
program
  .command('update-reconcile')
  .description('内部命令：更新后对账运行时状态（由 update 命令调用）')
  .option('-v, --verbose', '显示详细输出')
  .option('--skip-grace-period', '跳过缓存清除的 24 小时宽限期')
  .action(async (options) => {
    try {
      const reconcileResult = reconcileUpdateRuntime({ verbose: options.verbose, skipGracePeriod: options.skipGracePeriod });
      if (!reconcileResult.success) {
        console.error(chalk.red('对账失败:'));
        if (reconcileResult.errors) {
          reconcileResult.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
        }
        process.exit(1);
      }
      if (options.verbose) {
        console.log(chalk.green(reconcileResult.message));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`对账错误: ${message}`));
      process.exit(1);
    }
  });

/**
 * Version 命令 - 显示版本信息
 */
program
  .command('version')
  .description('显示详细版本信息')
  .addHelpText('after', `
示例：
  $ wise version                  显示版本、安装方式和提交哈希`)
  .action(async () => {
    const installed = getInstalledVersion();

    console.log(chalk.blue.bold('\nWise 版本信息\n'));
    console.log(chalk.gray('━'.repeat(50)));

    console.log(`\n  包版本：   ${chalk.green(version)}`);

    if (installed) {
      console.log(`  已安装版本： ${chalk.green(installed.version)}`);
      console.log(`  安装方式：    ${chalk.cyan(installed.installMethod)}`);
      console.log(`  安装位置：      ${chalk.gray(installed.installedAt)}`);
      if (installed.lastCheckAt) {
        console.log(`  上次更新检查： ${chalk.gray(installed.lastCheckAt)}`);
      }
      if (installed.commitHash) {
        console.log(`  提交哈希：       ${chalk.gray(installed.commitHash)}`);
      }
    } else {
      console.log(chalk.yellow('  未找到安装元数据'));
      console.log(chalk.gray('  （运行安装脚本以创建版本元数据）'));
    }

    console.log(chalk.gray('\n━'.repeat(50)));
    console.log(chalk.gray('\n运行 wise update --check 检查更新'));
  });

/**
 * Install 命令 - 安装 agents 与 commands（默认：~/.claude/）
 */
program
  .command('install')
  .description('安装 WISE agents 和 commands 到 Claude Code 配置目录（默认：~/.claude/）')
  .option('-f, --force', '覆盖已有文件')
  .option('-q, --quiet', '静默输出，仅显示错误')
  .option('--skip-claude-check', '跳过 Claude Code 安装检查')
  .addHelpText('after', `
示例：
  $ wise install                  安装到配置目录（默认：~/.claude/）
  $ wise install --force          重新安装，覆盖已有文件
  $ wise install --quiet          静默安装，适用于脚本
  $ CLAUDE_CONFIG_DIR=$HOME/.claude-isolated-workspace wise install  隔离配置目录`)
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('╔═══════════════════════════════════════════════════════════╗'));
      console.log(chalk.blue('║         Wise 安装程序                        ║'));
      console.log(chalk.blue('║   Claude Code 的多 Agent 编排系统               ║'));
      console.log(chalk.blue('╚═══════════════════════════════════════════════════════════╝'));
      console.log('');
    }

    // 检查是否已安装
    if (isInstalled() && !options.force) {
      const info = getInstallInfo();
      if (!options.quiet) {
        console.log(chalk.yellow('WISE 已安装。'));
        if (info) {
          console.log(chalk.gray(`  Version: ${info.version}`));
          console.log(chalk.gray(`  Installed: ${info.installedAt}`));
        }
        console.log(chalk.gray('\n使用 --force 重新安装。'));
      }
      return;
    }

    // 执行安装
    const result = installWise({
      force: options.force,
      verbose: !options.quiet,
      skipClaudeCheck: options.skipClaudeCheck
    });

    if (result.success) {
      if (!options.quiet) {
        console.log('');
        console.log(chalk.green('╔═══════════════════════════════════════════════════════════╗'));
        console.log(chalk.green('║         安装完成！                            ║'));
        console.log(chalk.green('╚═══════════════════════════════════════════════════════════╝'));
        console.log('');
        console.log(chalk.gray(`安装到：${getClaudeConfigDir()}`));
        console.log('');
        console.log(chalk.yellow('用法：'));
        console.log('  claude                        # 正常启动 Claude Code');
        console.log('');
        console.log(chalk.yellow('斜杠命令：'));
        console.log('  /wise <task>              # 激活 WISE 编排模式');
        console.log('  /wise-default             # 为当前项目配置');
        console.log('  /wise-default-global      # 全局配置');
        console.log('  /ultrawork <task>             # 最高性能模式');
        console.log('  /deepsearch <query>           # 深度代码库搜索');
        console.log('  /analyze <target>             # 深度分析模式');
        console.log('  /plan <description>           # 使用 Planner 开始规划');
        console.log('  /review [plan-path]           # 使用 Critic 审查计划');
        console.log('');
        console.log(chalk.yellow('可用 Agent（通过 Task 工具）：'));
        console.log(chalk.gray('  基础 Agent：'));
        console.log('    architect              - 架构与调试（Opus）');
        console.log('    document-specialist   - 外部文档与参考查找（Sonnet）');
        console.log('    explore             - 快速模式匹配（Haiku）');
        console.log('    designer            - UI/UX 专家（Sonnet）');
        console.log('    writer              - 技术写作（Haiku）');
        console.log('    vision              - 视觉分析（Sonnet）');
        console.log('    critic               - 计划审查（Opus）');
        console.log('    analyst               - 预规划分析（Opus）');
        console.log('    debugger            - 根因诊断（Sonnet）');
        console.log('    executor            - 专注执行（Sonnet）');
        console.log('    planner          - 战略规划（Opus）');
        console.log('    qa-tester           - 交互式 CLI 测试（Sonnet）');
        console.log(chalk.gray('  分层变体（智能路由）：'));
        console.log('    architect-medium       - 简单分析（Sonnet）');
        console.log('    architect-low          - 快速问题（Haiku）');
        console.log('    executor-high       - 复杂任务（Opus）');
        console.log('    executor-low        - 简单任务（Haiku）');
        console.log('    designer-high       - 设计系统（Opus）');
        console.log('    designer-low        - 简单样式（Haiku）');
        console.log('');
        console.log(chalk.yellow('更新后：'));
        console.log('  运行 \'/wise-default\'（项目）或 \'/wise-default-global\'（全局）');
        console.log('  下载最新的 CLAUDE.md 配置。');
        console.log('  这确保你获得最新的功能和 agent 行为。');
        console.log('');
        console.log(chalk.blue('快速开始：'));
        console.log('  1. 运行 \'claude\' 启动 Claude Code');
        console.log('  2. 输入 \'/wise-default\'（项目）或 \'/wise-default-global\'（全局）');
        console.log('  3. 或使用 \'/wise <task>\' 进行一次性激活');
      }
    } else {
      console.error(chalk.red(`安装失败： ${result.message}`));
      if (result.errors.length > 0) {
        result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
      }
      console.error(chalk.gray('\n使用 "wise install --force" 覆盖已有文件。'));
      console.error(chalk.gray('运行 "wise doctor conflicts" 获取更多诊断信息。'));
      process.exit(1);
    }
  });

/**
 * Wait 命令 - 速率限制等待与自动恢复
 *
 * 零学习成本设计：
 * - 单独 `wise wait` 即显示状态并建议下一步动作
 * - `wise wait --start` 启动守护进程（快捷方式）
 * - `wise wait --stop` 停止守护进程（快捷方式）
 * - 为高级用户提供子命令
 */
const waitCmd = program
  .command('wait')
  .description('速率限制等待与自动恢复（直接运行 wise wait 即可开始）')
  .option('--json', '输出为 JSON')
  .option('--start', '启动自动恢复守护进程')
  .option('--stop', '停止自动恢复守护进程')
  .addHelpText('after', `
示例：
  $ wise wait                     显示状态和建议
  $ wise wait --start             启动自动恢复守护进程
  $ wise wait --stop              停止自动恢复守护进程
  $ wise wait status              显示详细的速率限制状态
  $ wise wait detect              扫描被阻塞的 tmux 会话`)
  .action(async (options) => {
    await waitCommand(options);
  });

waitCmd
  .command('status')
  .description('显示详细的速率限制和守护进程状态')
  .option('--json', '输出为 JSON')
  .action(async (options) => {
    await waitStatusCommand(options);
  });

waitCmd
  .command('daemon <action>')
  .description('启动或停止自动恢复守护进程')
  .option('-v, --verbose', '启用详细日志')
  .option('-f, --foreground', '在前台运行（阻塞）')
  .option('-i, --interval <seconds>', '轮询间隔（秒）', '60')
  .addHelpText('after', `
示例：
  $ wise wait daemon start            启动后台守护进程
  $ wise wait daemon stop             停止守护进程
  $ wise wait daemon start -f         在前台运行`)
  .action(async (action: string, options) => {
    if (action !== 'start' && action !== 'stop') {
      console.error(chalk.red(`无效动作 "${action}"。有效选项：start、stop`));
      console.error(chalk.gray('示例：wise wait daemon start'));
      process.exit(1);
    }
    await waitDaemonCommand(action as 'start' | 'stop', {
      verbose: options.verbose,
      foreground: options.foreground,
      interval: parseInt(options.interval),
    });
  });

waitCmd
  .command('detect')
  .description('扫描 tmux 中被阻塞的 Claude Code 会话')
  .option('--json', '输出为 JSON')
  .option('-l, --lines <number>', '分析的 pane 行数', '15')
  .action(async (options) => {
    await waitDetectCommand({
      json: options.json,
      lines: parseInt(options.lines),
    });
  });


/**
 * Teleport 命令 - 快速创建 worktree
 *
 * 用法：
 * - `wise teleport '#123'` - 为 issue/PR #123 创建 worktree
 * - `wise teleport my-feature` - 为 feature 分支创建 worktree
 * - `wise teleport list` - 列出已存在的 worktree
 * - `wise teleport remove <path>` - 移除一个 worktree
 */
const teleportCmd = program
  .command('teleport [ref]')
  .description("创建 git worktree 用于隔离开发（例如 wise teleport '#123'）")
  .option('--worktree', '创建 worktree（默认行为，保留此标志用于兼容）')
  .option('-p, --path <path>', '自定义 worktree 路径（默认：~/Workspace/wise-worktrees/）')
  .option('-b, --base <branch>', '创建用的基准分支（默认：main）')
  .option('--json', '输出为 JSON')
  .addHelpText('after', `
示例：
  $ wise teleport '#42'           为 issue/PR #42 创建 worktree
  $ wise teleport add-auth        为 feature 分支创建 worktree
  $ wise teleport list            列出已有 worktree
  $ wise teleport remove ./path   移除一个 worktree

注意：
  在许多 shell 中，# 会启动注释。请给引用加上引号：wise teleport '#42'`)
  .action(async (ref: string | undefined, options) => {
    if (!ref) {
      // 未提供 ref，显示帮助
      console.log(chalk.blue('Teleport - 快速创建 worktree\n'));
      console.log('用法：');
      console.log('  wise teleport <ref>           为 issue/PR/feature 创建 worktree');
      console.log('  wise teleport list            列出已有 worktree');
      console.log('  wise teleport remove <path>   移除一个 worktree');
      console.log('');
      console.log('引用格式：');
      console.log("  '#123'                       当前仓库的 issue/PR（加引号以避免 shell 注释）");
      console.log('  owner/repo#123               指定仓库的 issue/PR');
      console.log('  my-feature                   Feature 分支名称');
      console.log('  https://github.com/...       GitHub URL');
      console.log('');
      console.log(chalk.yellow('注意：在许多 shell 中，# 会启动注释。请给引用加上引号：wise teleport \'#42\''));
      console.log('');
      console.log('示例：');
      console.log("  wise teleport '#42'           为 issue #42 创建 worktree");
      console.log('  wise teleport add-auth        为 feature "add-auth" 创建 worktree');
      console.log('');
      return;
    }

    await teleportCommand(ref, {
      worktree: true, // 始终创建 worktree
      worktreePath: options.path,
      base: options.base,
      json: options.json,
    });
  });

teleportCmd
  .command('list')
  .description('列出 ~/Workspace/wise-worktrees/ 中已有的 worktree')
  .option('--json', '输出为 JSON')
  .action(async (options) => {
    await teleportListCommand(options);
  });

teleportCmd
  .command('remove <path>')
  .alias('rm')
  .description('移除一个 worktree')
  .option('-f, --force', '即使有未提交的更改也强制移除')
  .option('--json', '输出为 JSON')
  .action(async (path: string, options) => {
    const exitCode = await teleportRemoveCommand(path, options);
    if (exitCode !== 0) process.exit(exitCode);
  });


/**
 * Session 命令 - 搜索本地历史会话
 */
const sessionCmd = program
  .command('session')
  .alias('sessions')
  .description('检查本地历史会话')
  .addHelpText('after', `
示例：
  $ wise session search "team leader stale"
  $ wise session search notify-hook --since 7d
  $ wise session search provider-routing --project all --json`);

sessionCmd
  .command('search <query>')
  .description('搜索本地历史会话记录和 WISE 会话制品')
  .option('-l, --limit <number>', '返回的最大匹配数', '10')
  .option('-s, --session <id>', '限定在特定会话 ID 内搜索')
  .option('--since <duration|date>', '仅包含指定时间之后的匹配（如 7d、24h 或绝对日期）')
  .option('--project <scope>', '项目范围。默认为当前项目。使用 "all" 搜索所有本地项目')
  .option('--json', '以 JSON 输出结果')
  .option('--case-sensitive', '区分大小写匹配查询')
  .option('--context <chars>', '匹配两侧的大致上下文字符数', '120')
  .action(async (query: string, options) => {
    await sessionSearchCommand(query, {
      limit: parseInt(options.limit, 10),
      session: options.session,
      since: options.since,
      project: options.project,
      json: options.json,
      caseSensitive: options.caseSensitive,
      context: parseInt(options.context, 10),
      workingDirectory: process.cwd(),
    });
  });

/**
 * Doctor 命令 - 诊断工具
 */
const doctorCmd = program
  .command('doctor')
  .description('诊断 WISE 安装问题的排障工具')
  .option('--plugin-dir <path>', '覆盖 WISE 插件根目录（设置 WISE_PLUGIN_ROOT）')
  .option('--team-routing', '检测 team.roleRouting 中每个 provider 的 CLI 存在情况')
  .option('--json', '以 JSON 输出（与 --team-routing 一起使用）')
  .addHelpText('after', `
示例：
  $ wise doctor conflicts                        检查插件冲突
  $ wise doctor team-routing                     检测 /team 角色路由的 provider CLI
  $ wise doctor --team-routing                   同上（标志形式）
  $ wise doctor --plugin-dir /path/to/plugin     对指定插件目录运行诊断`)
  .hook('preAction', (thisCommand) => {
    applyPluginDirOption(thisCommand.opts().pluginDir as string | undefined);
  })
  .action(async (options) => {
    if (options.teamRouting) {
      const exitCode = await doctorTeamRoutingCommand({ json: options.json ?? false });
      process.exit(exitCode);
    }
    // 未指定 --team-routing 时，显示父命令的帮助文本。
    doctorCmd.help();
  });

doctorCmd
  .command('team-routing')
  .description('检测 team.roleRouting 中配置的每个 provider 的 CLI 存在情况')
  .option('--json', '以 JSON 输出结果')
  .addHelpText('after', `
示例：
  $ wise doctor team-routing                     检测已配置的 provider
  $ wise doctor team-routing --json              以 JSON 输出结果`)
  .action(async (options) => {
    const exitCode = await doctorTeamRoutingCommand({ json: options.json ?? false });
    process.exit(exitCode);
  });

doctorCmd
  .command('conflicts')
  .description('检查插件共存问题和配置冲突')
  .option('--json', '以 JSON 输出结果')
  .option('--plugin-dir <path>', '覆盖 WISE 插件根目录（设置 WISE_PLUGIN_ROOT）')
  .addHelpText('after', `
示例：
  $ wise doctor conflicts                        检查配置问题
  $ wise doctor conflicts --json                 以 JSON 输出结果
  $ wise doctor conflicts --plugin-dir /tmp/foo   检查指定插件目录`)
  .action(async (options) => {
    applyPluginDirOption(options.pluginDir);
    const exitCode = await doctorConflictsCommand(options);
    process.exit(exitCode);
  });

/**
 * Setup 命令 - wise-setup 的官方 CLI 入口
 *
 * 用户友好的命令，同步所有 WISE 组件：
 * - 安装/更新 hooks、agents 和 skills
 * - 更新后对账运行时状态
 * - 清晰展示已安装/更新的内容
 */
program
  .command('setup')
  .description('运行 WISE setup 同步所有组件（hooks、agents、skills）')
  .option('-f, --force', '强制重新安装，即使已是最新版')
  .option('-q, --quiet', '静默输出，仅显示错误')
  .option('--no-plugin', '使用当前包内置的 skills 而非插件提供的 skills')
  .option('--plugin-dir-mode', '将 WISE 视为通过 --plugin-dir 启动（跳过 agent/skill 拷贝；HUD + hooks + CLAUDE.md 仍会安装）')
  .option('--skip-hooks', '跳过 hook 安装')
  .option('--force-hooks', '强制重新安装 hooks 即使未更改')
  .addHelpText('after', `
示例：
  $ wise setup                     同步所有 WISE 组件
  $ wise setup --force             强制重新安装所有组件
  $ wise setup --no-plugin         强制使用本地内置 skill 安装
  $ wise setup --plugin-dir-mode   跳过 agent/skill 拷贝（与 claude --plugin-dir 一起使用）
  $ wise setup --quiet             静默安装，适用于脚本
  $ wise setup --skip-hooks        安装但跳过 hooks
  $ wise setup --force-hooks       强制重新安装 hooks`)
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('Wise Setup\n'));
    }

    // 第 1 步：执行安装（涵盖 hooks、agents、skills）
    if (!options.quiet) {
      console.log(chalk.gray('正在同步 WISE 组件…'));
    }

    // Commander 会把 `--no-plugin` 这类否定标志暴露为 `options.plugin === false`，
    // 而非 `options.noPlugin`。保持 installer API 显式明确。
    const useLocalBundledSkills = options.plugin === false;

    // 开发 plugin-dir 模式：跳过 agent/skill 拷贝，因为 plugin 已在运行时通过
    // `claude --plugin-dir <path>`（或 `wise --plugin-dir`）提供。
    // 从 WISE_PLUGIN_ROOT 自动检测（由 src/cli/launch.ts 中的 `wise --plugin-dir` 设置）。
    let pluginDirMode = !!options.pluginDirMode;
    if (!pluginDirMode && process.env[WISE_PLUGIN_ROOT_ENV]) {
      pluginDirMode = true;
      if (!options.quiet) {
        console.log(chalk.gray(`Detected ${WISE_PLUGIN_ROOT_ENV} — entering dev plugin-dir mode`));
      }
    }
    if (pluginDirMode && useLocalBundledSkills) {
      if (!options.quiet) {
        console.log(chalk.yellow('Warning: --plugin-dir-mode and --no-plugin conflict; --no-plugin takes precedence'));
      }
      pluginDirMode = false;
    }
    if (pluginDirMode && !options.quiet) {
      console.log(chalk.gray('开发 plugin-dir 模式：跳过 agent/skill 同步（plugin 通过 --plugin-dir 提供）'));
    }

    const result = installWise({
      force: !!options.force,
      verbose: !options.quiet,
      skipClaudeCheck: true,
      forceHooks: !!options.forceHooks,
      noPlugin: useLocalBundledSkills,
      pluginDirMode,
    });

    if (!result.success) {
      console.error(chalk.red(`Setup failed: ${result.message}`));
      if (result.errors.length > 0) {
        result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
      }
      process.exit(1);
    }

    // 第 2 步：显示摘要
    if (!options.quiet) {
      console.log('');
      console.log(chalk.green('安装完成！'));
      console.log('');

      if (result.installedAgents.length > 0) {
        console.log(chalk.gray(`  Agent：   ${result.installedAgents.length} 已同步`));
      }
      if (result.installedCommands.length > 0) {
        console.log(chalk.gray(`  命令：${result.installedCommands.length} 已同步`));
      }
      if (result.installedSkills.length > 0) {
        console.log(chalk.gray(`  Skill：  ${result.installedSkills.length} 已同步`));
      }
      if (result.hooksConfigured) {
        console.log(chalk.gray('  Hook：    已配置'));
      }
      if (result.hookConflicts.length > 0) {
        console.log('');
        console.log(chalk.yellow('  检测到 Hook 冲突:'));
        result.hookConflicts.forEach(c => {
          console.log(chalk.yellow(`    - ${c.eventType}: ${c.existingCommand}`));
        });
      }

      const installed = getInstalledVersion();
      const reportedVersion = installed?.version ?? version;

      console.log('');
      console.log(chalk.gray(`Version: ${reportedVersion}`));
      if (reportedVersion !== version) {
        console.log(chalk.gray(`CLI 包版本: ${version}`));
      }
      console.log(chalk.gray('启动 Claude Code 并运行 /wise:wise-setup 进行交互式设置.'));
    }
  });

/**
 * Postinstall 命令 - 供 npm postinstall 钩子调用的静默安装
 */
program
  .command('postinstall', { hidden: true })
  .description('运行安装后设置（由 npm 自动调用）')
  .action(async () => {
    // 静默安装 - 仅显示错误
    const result = installWise({
      force: false,
      verbose: false,
      skipClaudeCheck: true
    });

    if (result.success) {
      console.log(chalk.green('✓ Wise 安装成功！'));
      console.log(chalk.gray('  运行 "wise info" 查看可用 agent.'));
      console.log(chalk.yellow('  Run "/wise-default" (project) or "/wise-default-global" (global) in Claude Code.'));
    } else {
      // 不让 npm install 失败，仅告警
      console.warn(chalk.yellow('⚠ 无法完成 WISE 设置:'), result.message);
      console.warn(chalk.gray('  手动运行 "wise install" 完成设置.'));
    }
  });

/**
 * HUD 命令 - 运行 WISE HUD 状态栏渲染器
 * 在 --watch 模式下持续循环，适用于 tmux 面板。
 */
program
  .command('hud')
  .description('运行 WISE HUD 状态栏渲染器')
  .option('--watch', '以监控模式运行（持续轮询 tmux 面板）')
  .option('--interval <ms>', '轮询间隔（毫秒）', '1000')
  .action(async (options) => {
    const { main: hudMain } = await import('../hud/index.js');
    if (options.watch) {
      const intervalMs = parseInt(options.interval, 10);
      await runHudWatchLoop({ intervalMs, hudMain });
    } else {
      await hudMain();
    }
  });

program
  .command('mission-board')
  .description('渲染当前工作区的可选任务面板快照')
  .option('--json', '输出原始任务面板 JSON')
  .action(async (options) => {
    const { refreshMissionBoardState, renderMissionBoard } = await import('../hud/mission-board.js');
    const state = refreshMissionBoardState(process.cwd());
    if (options.json) {
      console.log(JSON.stringify(state, null, 2));
      return;
    }

    const lines = renderMissionBoard(state, {
      enabled: true,
      maxMissions: 5,
      maxAgentsPerMission: 8,
      maxTimelineEvents: 8,
      persistCompletedForMinutes: 20,
    });

    console.log(lines.length > 0 ? lines.join('\n') : '(没有活动任务)');
  });

/**
 * Team 命令 - team worker 生命周期操作的 CLI API
 * 暴露 WISE 的 `wise team api` 接口。
 *
 * helpOption(false) 阻止 commander 拦截 --help；
 * 由我们的 teamCommand 处理器自行提供帮助输出。
 */
program
  .command('team')
  .description('Team CLI API，用于 worker 生命周期操作')
  .helpOption(false)
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .argument('[args...]', 'team subcommand arguments')
  .action(async (args: string[]) => {
    await teamCommand(args);
  });

/**
 * Autoresearch 命令 - 仅保留用于迁移提示的硬弃用垫片
 */
program
  .command('autoresearch')
  .description('硬弃用垫片，引导用户迁移到 deep-interview + autoresearch skill')
  .helpOption(false)
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .argument('[args...]', 'autoresearch subcommand arguments')
  .action(async (args: string[]) => {
    await autoresearchCommand(args);
  });

/**
 * Ralphthon 命令 - 自治式 hackathon 生命周期
 *
 * 深度访谈生成 PRD，ralph 循环执行任务，
 * 自动加固阶段，在干净的波次后终止。
 */
program
  .command('ralphthon')
  .description('自治式 hackathon 生命周期：访谈 → 执行 → 加固 → 完成')
  .helpOption(false)
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .argument('[args...]', 'ralphthon arguments')
  .action(async (args: string[]) => {
    await ralphthonCommand(args);
  });

/**
 * Ultragoal 命令 - 与 Claude /goal 交接的持久化仓库原生多目标工作流
 *
 * 将 plan/ledger 制品写入 .wise/ultragoal/ 下，并打印面向模型的交接文本，
 * 告知当前活动的 Claude agent 何时调用 /goal、记录进度检查点，
 * 并将最终完成度置于 ai-slop-cleaner + 校验 + $code-review 证据的把关之后。
 * shell 无法修改 Claude 会话的 /goal 指令；此命令仅持久化状态。
 */
program
  .command('ultragoal')
  .description('持久化仓库原生多目标工作流，与 Claude Code /goal 交接（详见 wise ultragoal help）')
  .helpOption(false)
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .argument('[args...]', 'ultragoal subcommand arguments')
  .addHelpText('after', `\n${ULTRAGOAL_HELP}`)
  .action(async (args: string[]) => {
    await ultragoalCommand(args);
  });

/**
 * 返回完全配置好的 commander program。
 *
 * 导出供测试驱动真实 CLI 流水线（例如
 * `await buildProgram().parseAsync(['node','wise','setup','--plugin-dir-mode'], { from: 'user' })`），
 * 无需派生子进程。program 在模块加载时构建一次（commander 不支持重复注册），
 * 因此这里只是返回该单例。
 */
export function buildProgram(): Command {
  return program;
}

// 解析参数 — 仅当导入此模块的测试通过 WISE_CLI_SKIP_PARSE 显式跳过时才不解析。
// 我们不以 process.env.VITEST 为判断依据，因为 CLI 也会在测试中被作为子进程派生
// （例如 cli-boot.test.ts），而子进程会从父 vitest worker 继承 VITEST 环境变量，
// 这会导致 CLI 静默退出且无任何输出。
if (!process.env.WISE_CLI_SKIP_PARSE) {
  program.parse();
}
