/**
 * `wise doctor team-routing` — 探测已配置的 /team 角色路由提供方。
 *
 * 遍历 `team.roleRouting` 引用的每个唯一提供方（配置为空时兜底为
 * `claude`），检查其在 PATH 上的 CLI 是否存在。
 * 对缺失的二进制仅发出警告（而非错误）— AC-11。
 */

import { execSync } from 'child_process';
import { colors } from '../utils/formatting.js';
import { loadConfig } from '../../config/loader.js';
import type { TeamRoleProvider } from '../../shared/types.js';

interface ProviderProbe {
  provider: TeamRoleProvider;
  binary: string;
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
}

const PROVIDER_BINARY: Record<TeamRoleProvider, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  grok: 'grok',
  cursor: 'cursor-agent',
};

function probeProvider(provider: TeamRoleProvider): ProviderProbe {
  const binary = PROVIDER_BINARY[provider];
  const probe: ProviderProbe = { provider, binary, found: false };

  try {
    const resolved = execSync(`command -v ${binary}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    if (resolved) {
      probe.found = true;
      probe.path = resolved;
      try {
        const version = execSync(`${binary} --version`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
          .trim()
          .split('\n')[0];
        if (version) probe.version = version;
      } catch {
        // 版本探测为尽力而为；找到二进制即可。
      }
    }
  } catch (err) {
    probe.error = err instanceof Error ? err.message : String(err);
  }

  return probe;
}

function collectConfiguredProviders(): Set<TeamRoleProvider> {
  const cfg = loadConfig();
  const providers = new Set<TeamRoleProvider>();
  // 始终包含 claude，以便上报编排器存在性。
  providers.add('claude');

  const roleRouting = cfg.team?.roleRouting ?? {};
  for (const spec of Object.values(roleRouting)) {
    const provider = spec?.provider as TeamRoleProvider | undefined;
    if (provider === 'claude' || provider === 'codex' || provider === 'gemini' || provider === 'grok' || provider === 'cursor') {
      providers.add(provider);
    }
  }
  return providers;
}

export async function doctorTeamRoutingCommand(options: { json?: boolean }): Promise<number> {
  let providers: Set<TeamRoleProvider>;
  try {
    providers = collectConfiguredProviders();
  } catch (err) {
    console.error(`[WISE] Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const probes = [...providers].map(probeProvider);
  const missing = probes.filter((p) => !p.found);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          probes,
          missing: missing.map((p) => p.provider),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(colors.bold('Team role routing — provider CLI probe'));
    for (const p of probes) {
      if (p.found) {
        const version = p.version ? ` (${p.version})` : '';
        console.log(`  ${colors.green('✓')} ${p.provider}: ${p.path}${version}`);
      } else {
        console.log(`  ${colors.yellow('⚠')} ${p.provider}: not found on PATH — /team tasks routed to ${p.provider} will fall back to claude`);
      }
    }
    if (missing.length === 0) {
      console.log(colors.green('\nAll configured providers are available.'));
    } else {
      console.log(
        colors.yellow(
          `\n${missing.length} provider${missing.length === 1 ? '' : 's'} missing (warn only — /team falls back to claude).`,
        ),
      );
    }
  }

  // 提供方缺失时绝不报错 — AC-11 要求警告而非错误。
  return 0;
}
