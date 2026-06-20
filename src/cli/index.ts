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
  .description('Multi-agent orchestration system for Claude Agent SDK')
  .version(version)
  .allowUnknownOption()
  .action(defaultAction);

/**
 * Launch 命令 - 为 Claude Code 提供原生 tmux shell 启动
 */
program
  .command('launch [args...]')
  .description('Launch Claude Code with native tmux shell integration')
  .allowUnknownOption()
  .addHelpText('after', `
Examples:
  $ wise                                Launch Claude Code
  $ wise --madmax                       Launch with permissions bypass
  $ wise --yolo                         Launch with permissions bypass (alias)
  $ wise --notify false                 Launch without CCNotifier events
  $ wise launch                         Explicit launch subcommand (same as bare wise)
  $ wise launch --madmax                Explicit launch with flags

Options:
  --notify <bool>   Enable/disable CCNotifier events. false sets WISE_NOTIFY=0
                    and suppresses all stop/session-start/session-idle notifications.
                    Default: true

Environment:
  WISE_NOTIFY=0              Suppress all notifications (set by --notify false)
`)
  .action(async (args: string[]) => {
    await launchCommand(args);
  });

/**
 * Interop 命令 - WISE 与 OMX 的 tmux 分屏会话
 */
program
  .command('interop')
  .description('Launch split-pane tmux session with Claude Code (WISE) and Codex (OMX)')
  .addHelpText('after', `
Requirements:
  - Must be running inside a tmux session
  - Claude CLI must be installed
  - Codex CLI recommended (graceful fallback if missing)`)
  .action(() => {
    interopCommand();
  });

/**
 * Ask 命令 - 运行 provider advisor prompt（claude|gemini）
 */
program
  .command('ask [args...]')
  .description('Run provider advisor prompt and write an ask artifact')
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
  .description('Show current configuration')
  .option('-v, --validate', 'Validate configuration')
  .option('-p, --paths', 'Show configuration file paths')
  .addHelpText('after', `
Examples:
  $ wise config                   Show current configuration
  $ wise config --validate        Validate configuration files
  $ wise config --paths           Show config file locations

  }`)
  .action(async (options) => {
    if (options.paths) {
      const paths = getConfigPaths();
      console.log(chalk.blue('Configuration file paths:'));
      console.log(`  User:    ${paths.user}`);
      console.log(`  Project: ${paths.project}`);

      console.log(chalk.blue('\nFile status:'));
      console.log(`  User:    ${existsSync(paths.user) ? chalk.green('exists') : chalk.gray('not found')}`);
      console.log(`  Project: ${existsSync(paths.project) ? chalk.green('exists') : chalk.gray('not found')}`);
      return;
    }

    const config = loadConfig();

    if (options.validate) {
      console.log(chalk.blue('Validating configuration...\n'));

      // 检查必填字段
      const warnings: string[] = [];
      const errors: string[] = [];

      if (!process.env.ANTHROPIC_API_KEY) {
        warnings.push('ANTHROPIC_API_KEY environment variable not set');
      }

      if (config.mcpServers?.exa?.enabled && !process.env.EXA_API_KEY && !config.mcpServers.exa.apiKey) {
        warnings.push('Exa is enabled but EXA_API_KEY is not set');
      }

      if (errors.length > 0) {
        console.log(chalk.red('Errors:'));
        errors.forEach(e => console.log(chalk.red(`  - ${e}`)));
      }

      if (warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
      }

      if (errors.length === 0 && warnings.length === 0) {
        console.log(chalk.green('Configuration is valid!'));
      }

      return;
    }

    console.log(chalk.blue('Current configuration:\n'));
    console.log(JSON.stringify(config, null, 2));
  });

/**
 * Config stop-callback 子命令 - 配置 stop 钩子回调
 */
const _configStopCallback = program
  .command('config-stop-callback <type>')
  .description('Configure stop hook callbacks (file/telegram/discord/slack)')
  .option('--enable', 'Enable callback')
  .option('--disable', 'Disable callback')
  .option('--path <path>', 'File path (supports {session_id}, {date}, {time})')
  .option('--format <format>', 'File format: markdown | json')
  .option('--token <token>', 'Bot token (telegram or discord-bot)')
  .option('--chat <id>', 'Telegram chat ID')
  .option('--webhook <url>', 'Discord webhook URL')
  .option('--channel-id <id>', 'Discord bot channel ID (used with --profile)')
  .option('--tag-list <csv>', 'Replace tag list (comma-separated, telegram/discord only)')
  .option('--add-tag <tag>', 'Append one tag (telegram/discord only)')
  .option('--remove-tag <tag>', 'Remove one tag (telegram/discord only)')
  .option('--clear-tags', 'Clear all tags (telegram/discord only)')
  .option('--profile <name>', 'Named notification profile to configure')
  .option('--show', 'Show current configuration')
  .addHelpText('after', `
Types:
  file       File system callback (saves session summary to disk)
  telegram   Telegram bot notification
  discord    Discord webhook notification
  slack      Slack incoming webhook notification

Profile types (use with --profile):
  discord-bot  Discord Bot API (token + channel ID)
  slack        Slack incoming webhook
  webhook      Generic webhook (POST with JSON body)

Examples:
  $ wise config-stop-callback file --enable --path ${join(getClaudeConfigDir(), 'logs/{date}.md')}
  $ wise config-stop-callback telegram --enable --token <token> --chat <id>
  $ wise config-stop-callback discord --enable --webhook <url>
  $ wise config-stop-callback file --disable
  $ wise config-stop-callback file --show

  # Named profiles (stored in notificationProfiles):
  $ wise config-stop-callback discord --profile work --enable --webhook <url>
  $ wise config-stop-callback telegram --profile work --enable --token <tk> --chat <id>
  $ wise config-stop-callback discord-bot --profile ops --enable --token <tk> --channel-id <id>

  # Select profile at launch:
  $ WISE_NOTIFY_PROFILE=work claude`)
  .action(async (type: string, options) => {
    // 当使用 --profile 时，路由到基于 profile 的配置
    if (options.profile) {
      const profileValidTypes = ['file', 'telegram', 'discord', 'discord-bot', 'slack', 'webhook'];
      if (!profileValidTypes.includes(type)) {
        console.error(chalk.red(`Invalid type for profile: ${type}`));
        console.error(chalk.gray(`Valid types: ${profileValidTypes.join(', ')}`));
        process.exit(1);
      }

      const config = getWiseConfig() as WiseConfig & { notificationProfiles?: Record<string, any> };
      config.notificationProfiles = config.notificationProfiles || {};
      const profileName = options.profile as string;
      const profile = config.notificationProfiles[profileName] || { enabled: true };

      // 显示当前 profile 配置
      if (options.show) {
        if (config.notificationProfiles[profileName]) {
          console.log(chalk.blue(`Profile "${profileName}" — ${type} configuration:`));
          const platformConfig = profile[type];
          if (platformConfig) {
            console.log(JSON.stringify(platformConfig, null, 2));
          } else {
            console.log(chalk.yellow(`No ${type} platform configured in profile "${profileName}".`));
          }
        } else {
          console.log(chalk.yellow(`Profile "${profileName}" not found.`));
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
            console.error(chalk.red('Discord requires --webhook <webhook_url>'));
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
            console.error(chalk.red('Discord bot requires --token <bot_token>'));
            process.exit(1);
          }
          if (enabled === true && (!options.channelId && !current?.channelId)) {
            console.error(chalk.red('Discord bot requires --channel-id <channel_id>'));
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
            console.error(chalk.red('Telegram requires --token <bot_token>'));
            process.exit(1);
          }
          if (enabled === true && (!options.chat && !current?.chatId)) {
            console.error(chalk.red('Telegram requires --chat <chat_id>'));
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
            console.error(chalk.red('Slack requires --webhook <webhook_url>'));
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
            console.error(chalk.red('Webhook requires --webhook <url>'));
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
          console.error(chalk.yellow('File callbacks are not supported in notification profiles.'));
          console.error(chalk.gray('Use without --profile for file callbacks.'));
          process.exit(1);
          break;
        }
      }

      config.notificationProfiles[profileName] = profile;

      try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green(`\u2713 Profile "${profileName}" — ${type} configured`));
        console.log(JSON.stringify(profile[type], null, 2));
      } catch (error) {
        console.error(chalk.red('Failed to write configuration:'), error);
        process.exit(1);
      }
      return;
    }

    // 旧版（非 profile）路径
    const validTypes = ['file', 'telegram', 'discord', 'slack'];
    if (!validTypes.includes(type)) {
      console.error(chalk.red(`Invalid callback type: ${type}`));
      console.error(chalk.gray(`Valid types: ${validTypes.join(', ')}`));
      process.exit(1);
    }

    const config = getWiseConfig();
    config.stopHookCallbacks = config.stopHookCallbacks || {};

    // 显示当前配置
    if (options.show) {
      const current = config.stopHookCallbacks[type as keyof typeof config.stopHookCallbacks];
      if (current) {
        console.log(chalk.blue(`Current ${type} callback configuration:`));
        console.log(JSON.stringify(current, null, 2));
      } else {
        console.log(chalk.yellow(`No ${type} callback configured.`));
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
          console.error(chalk.red('Telegram requires --token <bot_token>'));
          process.exit(1);
        }
        if (enabled === true && (!options.chat && !current?.chatId)) {
          console.error(chalk.red('Telegram requires --chat <chat_id>'));
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
          console.error(chalk.red('Discord requires --webhook <webhook_url>'));
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
          console.error(chalk.red('Slack requires --webhook <webhook_url>'));
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
      console.log(chalk.green(`\u2713 Stop callback '${type}' configured`));
      console.log(JSON.stringify(config.stopHookCallbacks[type as keyof typeof config.stopHookCallbacks], null, 2));
    } catch (error) {
      console.error(chalk.red('Failed to write configuration:'), error);
      process.exit(1);
    }
  });

/**
 * Config notify-profile 子命令 - 列出、显示和删除通知 profile
 */
program
  .command('config-notify-profile [name]')
  .description('Manage notification profiles')
  .option('--list', 'List all profiles')
  .option('--show', 'Show profile configuration')
  .option('--delete', 'Delete a profile')
  .addHelpText('after', `
Examples:
  $ wise config-notify-profile --list
  $ wise config-notify-profile work --show
  $ wise config-notify-profile work --delete

  # Create/update profiles via config-stop-callback --profile:
  $ wise config-stop-callback discord --profile work --enable --webhook <url>

  # Select profile at launch:
  $ WISE_NOTIFY_PROFILE=work claude`)
  .action(async (name: string | undefined, options) => {
    const config = getWiseConfig() as WiseConfig & { notificationProfiles?: Record<string, any> };
    const profiles = config.notificationProfiles || {};

    if (options.list || !name) {
      const names = Object.keys(profiles);
      if (names.length === 0) {
        console.log(chalk.yellow('No notification profiles configured.'));
        console.log(chalk.gray('Create one with: wise config-stop-callback <type> --profile <name> --enable ...'));
      } else {
        console.log(chalk.blue('Notification profiles:'));
        for (const pName of names) {
          const p = profiles[pName];
          const platforms = ['discord', 'discord-bot', 'telegram', 'slack', 'webhook']
            .filter((plat) => p[plat]?.enabled)
            .join(', ');
          const status = p.enabled !== false ? chalk.green('enabled') : chalk.red('disabled');
          console.log(`  ${chalk.bold(pName)} [${status}] — ${platforms || 'no platforms'}`);
        }
      }
      const activeProfile = process.env.WISE_NOTIFY_PROFILE;
      if (activeProfile) {
        console.log(chalk.gray(`\nActive profile (WISE_NOTIFY_PROFILE): ${activeProfile}`));
      }
      return;
    }

    if (options.show) {
      if (profiles[name]) {
        console.log(chalk.blue(`Profile "${name}":`));
        console.log(JSON.stringify(profiles[name], null, 2));
      } else {
        console.log(chalk.yellow(`Profile "${name}" not found.`));
      }
      return;
    }

    if (options.delete) {
      if (!profiles[name]) {
        console.log(chalk.yellow(`Profile "${name}" not found.`));
        return;
      }
      delete profiles[name];
      config.notificationProfiles = profiles;
      if (Object.keys(profiles).length === 0) {
        delete config.notificationProfiles;
      }
      try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        console.log(chalk.green(`\u2713 Profile "${name}" deleted`));
      } catch (error) {
        console.error(chalk.red('Failed to write configuration:'), error);
        process.exit(1);
      }
      return;
    }

    // 默认：显示指定的 profile
    if (profiles[name]) {
      console.log(chalk.blue(`Profile "${name}":`));
      console.log(JSON.stringify(profiles[name], null, 2));
    } else {
      console.log(chalk.yellow(`Profile "${name}" not found.`));
      console.log(chalk.gray('Create it with: wise config-stop-callback <type> --profile ' + name + ' --enable ...'));
    }
  });


/**
 * Info 命令 - 显示系统信息
 */
program
  .command('info')
  .description('Show system and agent information')
  .addHelpText('after', `
Examples:
  $ wise info                     Show agents, features, and MCP servers`)
  .action(async () => {
    const session = createWiseSession();

    console.log(chalk.blue.bold('\nWise System Information\n'));
    console.log(chalk.gray('━'.repeat(50)));

    console.log(chalk.blue('\nAvailable Agents:'));
    const agents = session.queryOptions.options.agents;
    for (const [name, agent] of Object.entries(agents)) {
      console.log(`  ${chalk.green(name)}`);
      console.log(`    ${chalk.gray(agent.description.split('\n')[0])}`);
    }

    console.log(chalk.blue('\nEnabled Features:'));
    const features = session.config.features;
    if (features) {
      console.log(`  Parallel Execution:      ${features.parallelExecution ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  LSP Tools:               ${features.lspTools ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  AST Tools:               ${features.astTools ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  Continuation Enforcement:${features.continuationEnforcement ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  Auto Context Injection:  ${features.autoContextInjection ? chalk.green('enabled') : chalk.gray('disabled')}`);
    }

    console.log(chalk.blue('\nMCP Servers:'));
    const mcpServers = session.queryOptions.options.mcpServers;
    for (const name of Object.keys(mcpServers)) {
      console.log(`  ${chalk.green(name)}`);
    }

    console.log(chalk.blue('\nMagic Keywords:'));
    console.log(`  Ultrawork: ${chalk.cyan(session.config.magicKeywords?.ultrawork?.join(', ') ?? 'ultrawork, ulw, uw')}`);
    console.log(`  Search:    ${chalk.cyan(session.config.magicKeywords?.search?.join(', ') ?? 'search, find, locate')}`);
    console.log(`  Analyze:   ${chalk.cyan(session.config.magicKeywords?.analyze?.join(', ') ?? 'analyze, investigate, examine')}`);

    console.log(chalk.gray('\n━'.repeat(50)));
    console.log(chalk.gray(`Version: ${version}`));
  });

/**
 * Test 命令 - 测试 prompt 增强
 */
program
  .command('test-prompt <prompt>')
  .description('Test how a prompt would be enhanced')
  .addHelpText('after', `
Examples:
  $ wise test-prompt "ultrawork fix bugs"    See how magic keywords are detected
  $ wise test-prompt "analyze this code"     Test prompt enhancement`)
  .action(async (prompt: string) => {
    const session = createWiseSession();

    console.log(chalk.blue('Original prompt:'));
    console.log(chalk.gray(prompt));

    const keywords = session.detectKeywords(prompt);
    if (keywords.length > 0) {
      console.log(chalk.blue('\nDetected magic keywords:'));
      console.log(chalk.yellow(keywords.join(', ')));
    }

    console.log(chalk.blue('\nEnhanced prompt:'));
    console.log(chalk.green(session.processPrompt(prompt)));
  });

/**
 * Update 命令 - 检查并安装更新
 */
program
  .command('update')
  .description('Check for and install updates')
  .option('-c, --check', 'Only check for updates, do not install')
  .option('-f, --force', 'Force reinstall even if up to date')
  .option('-q, --quiet', 'Suppress output except for errors')
  .option('--standalone', 'Force npm update even in plugin context')
  .option('--clean', 'Purge old plugin cache versions immediately (bypass 24h grace period)')
  .addHelpText('after', `
Examples:
  $ wise update                   Check and install updates
  $ wise update --check           Only check, don't install
  $ wise update --force           Force reinstall
  $ wise update --standalone      Force npm update in plugin context`)
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('Wise Update\n'));
    }

    try {
      // 显示当前版本
      const installed = getInstalledVersion();
      if (!options.quiet) {
        console.log(chalk.gray(`Current version: ${installed?.version ?? 'unknown'}`));
        console.log(chalk.gray(`Install method: ${installed?.installMethod ?? 'unknown'}`));
        console.log('');
      }

      // 检查更新
      if (!options.quiet) {
        console.log('Checking for updates...');
      }

      const checkResult = await checkForUpdates();

      if (!checkResult.updateAvailable && !options.force) {
        if (!options.quiet) {
          console.log(chalk.green(`\n✓ You are running the latest version (${checkResult.currentVersion})`));
        }
        return;
      }

      if (!options.quiet) {
        console.log(formatUpdateNotification(checkResult));
      }

      // 若为仅检查模式，到此为止
      if (options.check) {
        if (checkResult.updateAvailable) {
          console.log(chalk.yellow('\nRun without --check to install the update.'));
        }
        return;
      }

      // 执行更新
      if (!options.quiet) {
        console.log(chalk.blue('\nStarting update...\n'));
      }

      const result = await performUpdate({ verbose: !options.quiet, standalone: options.standalone, clean: options.clean });

      if (result.success) {
        if (!options.quiet) {
          console.log(chalk.green(`\n✓ ${result.message}`));
          console.log(chalk.gray('\nPlease restart your Claude Code session to use the new version.'));
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
      console.error(chalk.red(`Update failed: ${message}`));
      console.error(chalk.gray('Try again with "wise update --force", or reinstall with "wise install --force".'));
      process.exit(1);
    }
  });

/**
 * Update reconcile 命令 - 用于更新后对账的内部命令
 * 在 npm install 后自动调用，以确保 hooks/settings 随新代码一起更新
 */
program
  .command('update-reconcile')
  .description('Internal: Reconcile runtime state after update (called by update command)')
  .option('-v, --verbose', 'Show detailed output')
  .option('--skip-grace-period', 'Bypass 24h grace period for cache purge')
  .action(async (options) => {
    try {
      const reconcileResult = reconcileUpdateRuntime({ verbose: options.verbose, skipGracePeriod: options.skipGracePeriod });
      if (!reconcileResult.success) {
        console.error(chalk.red('Reconciliation failed:'));
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
      console.error(chalk.red(`Reconciliation error: ${message}`));
      process.exit(1);
    }
  });

/**
 * Version 命令 - 显示版本信息
 */
program
  .command('version')
  .description('Show detailed version information')
  .addHelpText('after', `
Examples:
  $ wise version                  Show version, install method, and commit hash`)
  .action(async () => {
    const installed = getInstalledVersion();

    console.log(chalk.blue.bold('\nWise Version Information\n'));
    console.log(chalk.gray('━'.repeat(50)));

    console.log(`\n  Package version:   ${chalk.green(version)}`);

    if (installed) {
      console.log(`  Installed version: ${chalk.green(installed.version)}`);
      console.log(`  Install method:    ${chalk.cyan(installed.installMethod)}`);
      console.log(`  Installed at:      ${chalk.gray(installed.installedAt)}`);
      if (installed.lastCheckAt) {
        console.log(`  Last update check: ${chalk.gray(installed.lastCheckAt)}`);
      }
      if (installed.commitHash) {
        console.log(`  Commit hash:       ${chalk.gray(installed.commitHash)}`);
      }
    } else {
      console.log(chalk.yellow('  No installation metadata found'));
      console.log(chalk.gray('  (Run the install script to create version metadata)'));
    }

    console.log(chalk.gray('\n━'.repeat(50)));
    console.log(chalk.gray('\nTo check for updates, run: wise update --check'));
  });

/**
 * Install 命令 - 安装 agents 与 commands（默认：~/.claude/）
 */
program
  .command('install')
  .description('Install WISE agents and commands to Claude Code config directory (default: ~/.claude/)')
  .option('-f, --force', 'Overwrite existing files')
  .option('-q, --quiet', 'Suppress output except for errors')
  .option('--skip-claude-check', 'Skip checking if Claude Code is installed')
  .addHelpText('after', `
Examples:
  $ wise install                  Install to config directory (default: ~/.claude/)
  $ wise install --force          Reinstall, overwriting existing files
  $ wise install --quiet          Silent install for scripts
  $ CLAUDE_CONFIG_DIR=$HOME/.claude-isolated-workspace wise install  Isolated config directory`)
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('╔═══════════════════════════════════════════════════════════╗'));
      console.log(chalk.blue('║         Wise Installer                        ║'));
      console.log(chalk.blue('║   Multi-Agent Orchestration for Claude Code               ║'));
      console.log(chalk.blue('╚═══════════════════════════════════════════════════════════╝'));
      console.log('');
    }

    // 检查是否已安装
    if (isInstalled() && !options.force) {
      const info = getInstallInfo();
      if (!options.quiet) {
        console.log(chalk.yellow('WISE is already installed.'));
        if (info) {
          console.log(chalk.gray(`  Version: ${info.version}`));
          console.log(chalk.gray(`  Installed: ${info.installedAt}`));
        }
        console.log(chalk.gray('\nUse --force to reinstall.'));
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
        console.log(chalk.green('║         Installation Complete!                            ║'));
        console.log(chalk.green('╚═══════════════════════════════════════════════════════════╝'));
        console.log('');
        console.log(chalk.gray(`Installed to: ${getClaudeConfigDir()}`));
        console.log('');
        console.log(chalk.yellow('Usage:'));
        console.log('  claude                        # Start Claude Code normally');
        console.log('');
        console.log(chalk.yellow('Slash Commands:'));
        console.log('  /wise <task>              # Activate WISE orchestration mode');
        console.log('  /wise-default             # Configure for current project');
        console.log('  /wise-default-global      # Configure globally');
        console.log('  /ultrawork <task>             # Maximum performance mode');
        console.log('  /deepsearch <query>           # Thorough codebase search');
        console.log('  /analyze <target>             # Deep analysis mode');
        console.log('  /plan <description>           # Start planning with Planner');
        console.log('  /review [plan-path]           # Review plan with Critic');
        console.log('');
        console.log(chalk.yellow('Available Agents (via Task tool):'));
        console.log(chalk.gray('  Base Agents:'));
        console.log('    architect              - Architecture & debugging (Opus)');
        console.log('    document-specialist   - External docs & reference lookup (Sonnet)');
        console.log('    explore             - Fast pattern matching (Haiku)');
        console.log('    designer            - UI/UX specialist (Sonnet)');
        console.log('    writer              - Technical writing (Haiku)');
        console.log('    vision              - Visual analysis (Sonnet)');
        console.log('    critic               - Plan review (Opus)');
        console.log('    analyst               - Pre-planning analysis (Opus)');
        console.log('    debugger            - Root-cause diagnosis (Sonnet)');
        console.log('    executor            - Focused execution (Sonnet)');
        console.log('    planner          - Strategic planning (Opus)');
        console.log('    qa-tester           - Interactive CLI testing (Sonnet)');
        console.log(chalk.gray('  Tiered Variants (for smart routing):'));
        console.log('    architect-medium       - Simpler analysis (Sonnet)');
        console.log('    architect-low          - Quick questions (Haiku)');
        console.log('    executor-high       - Complex tasks (Opus)');
        console.log('    executor-low        - Trivial tasks (Haiku)');
        console.log('    designer-high       - Design systems (Opus)');
        console.log('    designer-low        - Simple styling (Haiku)');
        console.log('');
        console.log(chalk.yellow('After Updates:'));
        console.log('  Run \'/wise-default\' (project) or \'/wise-default-global\' (global)');
        console.log('  to download the latest CLAUDE.md configuration.');
        console.log('  This ensures you get the newest features and agent behaviors.');
        console.log('');
        console.log(chalk.blue('Quick Start:'));
        console.log('  1. Run \'claude\' to start Claude Code');
        console.log('  2. Type \'/wise-default\' for project or \'/wise-default-global\' for global');
        console.log('  3. Or use \'/wise <task>\' for one-time activation');
      }
    } else {
      console.error(chalk.red(`Installation failed: ${result.message}`));
      if (result.errors.length > 0) {
        result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
      }
      console.error(chalk.gray('\nTry "wise install --force" to overwrite existing files.'));
      console.error(chalk.gray('For more diagnostics, run "wise doctor conflicts".'));
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
  .description('Rate limit wait and auto-resume (just run "wise wait" to get started)')
  .option('--json', 'Output as JSON')
  .option('--start', 'Start the auto-resume daemon')
  .option('--stop', 'Stop the auto-resume daemon')
  .addHelpText('after', `
Examples:
  $ wise wait                     Show status and suggestions
  $ wise wait --start             Start auto-resume daemon
  $ wise wait --stop              Stop auto-resume daemon
  $ wise wait status              Show detailed rate limit status
  $ wise wait detect              Scan for blocked tmux sessions`)
  .action(async (options) => {
    await waitCommand(options);
  });

waitCmd
  .command('status')
  .description('Show detailed rate limit and daemon status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await waitStatusCommand(options);
  });

waitCmd
  .command('daemon <action>')
  .description('Start or stop the auto-resume daemon')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-f, --foreground', 'Run in foreground (blocking)')
  .option('-i, --interval <seconds>', 'Poll interval in seconds', '60')
  .addHelpText('after', `
Examples:
  $ wise wait daemon start            Start background daemon
  $ wise wait daemon stop             Stop the daemon
  $ wise wait daemon start -f         Run in foreground`)
  .action(async (action: string, options) => {
    if (action !== 'start' && action !== 'stop') {
      console.error(chalk.red(`Invalid action "${action}". Valid options: start, stop`));
      console.error(chalk.gray('Example: wise wait daemon start'));
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
  .description('Scan for blocked Claude Code sessions in tmux')
  .option('--json', 'Output as JSON')
  .option('-l, --lines <number>', 'Number of pane lines to analyze', '15')
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
  .description("Create git worktree for isolated development (e.g., wise teleport '#123')")
  .option('--worktree', 'Create worktree (default behavior, flag kept for compatibility)')
  .option('-p, --path <path>', 'Custom worktree path (default: ~/Workspace/wise-worktrees/)')
  .option('-b, --base <branch>', 'Base branch to create from (default: main)')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ wise teleport '#42'           Create worktree for issue/PR #42
  $ wise teleport add-auth        Create worktree for a feature branch
  $ wise teleport list            List existing worktrees
  $ wise teleport remove ./path   Remove a worktree

Note:
  In many shells, # starts a comment. Quote refs: wise teleport '#42'`)
  .action(async (ref: string | undefined, options) => {
    if (!ref) {
      // 未提供 ref，显示帮助
      console.log(chalk.blue('Teleport - Quick worktree creation\n'));
      console.log('Usage:');
      console.log('  wise teleport <ref>           Create worktree for issue/PR/feature');
      console.log('  wise teleport list            List existing worktrees');
      console.log('  wise teleport remove <path>   Remove a worktree');
      console.log('');
      console.log('Reference formats:');
      console.log("  '#123'                       Issue/PR in current repo (quoted for shell safety)");
      console.log('  owner/repo#123               Issue/PR in specific repo');
      console.log('  my-feature                   Feature branch name');
      console.log('  https://github.com/...       GitHub URL');
      console.log('');
      console.log(chalk.yellow("Note: In many shells, # starts a comment. Quote refs: wise teleport '#42'"));
      console.log('');
      console.log('Examples:');
      console.log("  wise teleport '#42'           Create worktree for issue #42");
      console.log('  wise teleport add-auth        Create worktree for feature "add-auth"');
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
  .description('List existing worktrees in ~/Workspace/wise-worktrees/')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await teleportListCommand(options);
  });

teleportCmd
  .command('remove <path>')
  .alias('rm')
  .description('Remove a worktree')
  .option('-f, --force', 'Force removal even with uncommitted changes')
  .option('--json', 'Output as JSON')
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
  .description('Inspect prior local session history')
  .addHelpText('after', `
Examples:
  $ wise session search "team leader stale"
  $ wise session search notify-hook --since 7d
  $ wise session search provider-routing --project all --json`);

sessionCmd
  .command('search <query>')
  .description('Search prior local session transcripts and WISE session artifacts')
  .option('-l, --limit <number>', 'Maximum number of matches to return', '10')
  .option('-s, --session <id>', 'Restrict search to a specific session id')
  .option('--since <duration|date>', 'Only include matches since a duration (e.g. 7d, 24h) or absolute date')
  .option('--project <scope>', 'Project scope. Defaults to current project. Use "all" to search all local projects')
  .option('--json', 'Output results as JSON')
  .option('--case-sensitive', 'Match query case-sensitively')
  .option('--context <chars>', 'Approximate snippet context on each side of a match', '120')
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
  .description('Diagnostic tools for troubleshooting WISE installation')
  .option('--plugin-dir <path>', 'Override WISE plugin root directory (sets WISE_PLUGIN_ROOT)')
  .option('--team-routing', 'Probe CLI presence for every provider referenced by team.roleRouting')
  .option('--json', 'Output as JSON (used with --team-routing)')
  .addHelpText('after', `
Examples:
  $ wise doctor conflicts                        Check for plugin conflicts
  $ wise doctor team-routing                     Probe /team role-routing provider CLIs
  $ wise doctor --team-routing                   Same as above (flag form)
  $ wise doctor --plugin-dir /path/to/plugin     Run diagnostics against a specific plugin dir`)
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
  .description('Probe CLI presence for every provider referenced by team.roleRouting')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ wise doctor team-routing                     Probe configured providers
  $ wise doctor team-routing --json              Output results as JSON`)
  .action(async (options) => {
    const exitCode = await doctorTeamRoutingCommand({ json: options.json ?? false });
    process.exit(exitCode);
  });

doctorCmd
  .command('conflicts')
  .description('Check for plugin coexistence issues and configuration conflicts')
  .option('--json', 'Output as JSON')
  .option('--plugin-dir <path>', 'Override WISE plugin root directory (sets WISE_PLUGIN_ROOT)')
  .addHelpText('after', `
Examples:
  $ wise doctor conflicts                        Check for configuration issues
  $ wise doctor conflicts --json                 Output results as JSON
  $ wise doctor conflicts --plugin-dir /tmp/foo  Check against a specific plugin dir`)
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
  .description('Run WISE setup to sync all components (hooks, agents, skills)')
  .option('-f, --force', 'Force reinstall even if already up to date')
  .option('-q, --quiet', 'Suppress output except for errors')
  .option('--no-plugin', 'Install bundled skills from the current package instead of relying on plugin-provided skills')
  .option('--plugin-dir-mode', 'Treat WISE as launched via --plugin-dir at runtime (skip agent/skill copy; HUD + hooks + CLAUDE.md still installed)')
  .option('--skip-hooks', 'Skip hook installation')
  .option('--force-hooks', 'Force reinstall hooks even if unchanged')
  .addHelpText('after', `
Examples:
  $ wise setup                     Sync all WISE components
  $ wise setup --force             Force reinstall everything
  $ wise setup --no-plugin         Force local bundled skill installation
  $ wise setup --plugin-dir-mode   Skip agent/skill copy (used with claude --plugin-dir)
  $ wise setup --quiet             Silent setup for scripts
  $ wise setup --skip-hooks        Install without hooks
  $ wise setup --force-hooks       Force reinstall hooks`)
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('Wise Setup\n'));
    }

    // 第 1 步：执行安装（涵盖 hooks、agents、skills）
    if (!options.quiet) {
      console.log(chalk.gray('Syncing WISE components...'));
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
      console.log(chalk.gray('Dev plugin-dir mode: skipping agent/skill sync (plugin provides them via --plugin-dir)'));
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
      console.log(chalk.green('Setup complete!'));
      console.log('');

      if (result.installedAgents.length > 0) {
        console.log(chalk.gray(`  Agents:   ${result.installedAgents.length} synced`));
      }
      if (result.installedCommands.length > 0) {
        console.log(chalk.gray(`  Commands: ${result.installedCommands.length} synced`));
      }
      if (result.installedSkills.length > 0) {
        console.log(chalk.gray(`  Skills:   ${result.installedSkills.length} synced`));
      }
      if (result.hooksConfigured) {
        console.log(chalk.gray('  Hooks:    configured'));
      }
      if (result.hookConflicts.length > 0) {
        console.log('');
        console.log(chalk.yellow('  Hook conflicts detected:'));
        result.hookConflicts.forEach(c => {
          console.log(chalk.yellow(`    - ${c.eventType}: ${c.existingCommand}`));
        });
      }

      const installed = getInstalledVersion();
      const reportedVersion = installed?.version ?? version;

      console.log('');
      console.log(chalk.gray(`Version: ${reportedVersion}`));
      if (reportedVersion !== version) {
        console.log(chalk.gray(`CLI package version: ${version}`));
      }
      console.log(chalk.gray('Start Claude Code and use /wise:wise-setup for interactive setup.'));
    }
  });

/**
 * Postinstall 命令 - 供 npm postinstall 钩子调用的静默安装
 */
program
  .command('postinstall', { hidden: true })
  .description('Run post-install setup (called automatically by npm)')
  .action(async () => {
    // 静默安装 - 仅显示错误
    const result = installWise({
      force: false,
      verbose: false,
      skipClaudeCheck: true
    });

    if (result.success) {
      console.log(chalk.green('✓ Wise installed successfully!'));
      console.log(chalk.gray('  Run "wise info" to see available agents.'));
      console.log(chalk.yellow('  Run "/wise-default" (project) or "/wise-default-global" (global) in Claude Code.'));
    } else {
      // 不让 npm install 失败，仅告警
      console.warn(chalk.yellow('⚠ Could not complete WISE setup:'), result.message);
      console.warn(chalk.gray('  Run "wise install" manually to complete setup.'));
    }
  });

/**
 * HUD 命令 - 运行 WISE HUD 状态栏渲染器
 * 在 --watch 模式下持续循环，适用于 tmux 面板。
 */
program
  .command('hud')
  .description('Run the WISE HUD statusline renderer')
  .option('--watch', 'Run in watch mode (continuous polling for tmux pane)')
  .option('--interval <ms>', 'Poll interval in milliseconds', '1000')
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
  .description('Render the opt-in mission board snapshot for the current workspace')
  .option('--json', 'Print raw mission-board JSON')
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

    console.log(lines.length > 0 ? lines.join('\n') : '(no active missions)');
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
  .description('Team CLI API for worker lifecycle operations')
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
  .description('Hard-deprecated shim that redirects users to deep-interview + autoresearch skill')
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
  .description('Autonomous hackathon lifecycle: interview -> execute -> harden -> done')
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
  .description('Durable repo-native multi-goal workflow with Claude Code /goal handoff (see wise ultragoal help)')
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
