/**
 * Tests for platform activation gating in getEnabledPlatforms.
 *
 * Covers:
 * - Telegram requires WISE_TELEGRAM=1 to be included
 * - Discord and discord-bot require WISE_DISCORD=1 to be included
 * - Slack requires WISE_SLACK=1 to be included
 * - Webhook requires WISE_WEBHOOK=1 to be included
 * - Combined env vars enable all platforms
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getEnabledPlatforms } from '../config.js';
import type { NotificationConfig } from '../types.js';

/**
 * A full notification config with all platforms enabled.
 * Used as the base for gating tests.
 */
function makeFullConfig(): NotificationConfig {
  return {
    enabled: true,
    telegram: {
      enabled: true,
      botToken: 'test-bot-token',
      chatId: 'test-chat-id',
    },
    discord: {
      enabled: true,
      webhookUrl: 'https://discord.com/api/webhooks/test',
    },
    'discord-bot': {
      enabled: true,
      botToken: 'test-discord-bot-token',
      channelId: 'test-channel-id',
    },
    slack: {
      enabled: true,
      webhookUrl: 'https://hooks.slack.com/services/test',
    },
    webhook: {
      enabled: true,
      url: 'https://example.com/webhook',
    },
  };
}

describe('platform gating via getEnabledPlatforms', () => {
  beforeEach(() => {
    // Clear all platform gate env vars before each test
    vi.stubEnv('WISE_TELEGRAM', '');
    vi.stubEnv('WISE_DISCORD', '');
    vi.stubEnv('WISE_SLACK', '');
    vi.stubEnv('WISE_WEBHOOK', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // Telegram gating
  // ---------------------------------------------------------------------------

  it('excludes telegram when WISE_TELEGRAM is not set', () => {
    vi.stubEnv('WISE_TELEGRAM', '');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).not.toContain('telegram');
  });

  it('includes telegram when WISE_TELEGRAM=1', () => {
    vi.stubEnv('WISE_TELEGRAM', '1');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).toContain('telegram');
  });

  // ---------------------------------------------------------------------------
  // Discord gating
  // ---------------------------------------------------------------------------

  it('excludes discord when WISE_DISCORD is not set', () => {
    vi.stubEnv('WISE_DISCORD', '');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).not.toContain('discord');
  });

  it('excludes discord-bot when WISE_DISCORD is not set', () => {
    vi.stubEnv('WISE_DISCORD', '');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).not.toContain('discord-bot');
  });

  it('includes discord when WISE_DISCORD=1', () => {
    vi.stubEnv('WISE_DISCORD', '1');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).toContain('discord');
  });

  it('includes discord-bot when WISE_DISCORD=1', () => {
    vi.stubEnv('WISE_DISCORD', '1');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).toContain('discord-bot');
  });

  // ---------------------------------------------------------------------------
  // Slack gating
  // ---------------------------------------------------------------------------

  it('excludes slack when WISE_SLACK is not set', () => {
    vi.stubEnv('WISE_SLACK', '');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).not.toContain('slack');
  });

  it('includes slack when WISE_SLACK=1', () => {
    vi.stubEnv('WISE_SLACK', '1');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).toContain('slack');
  });

  // ---------------------------------------------------------------------------
  // Webhook gating
  // ---------------------------------------------------------------------------

  it('excludes webhook when WISE_WEBHOOK is not set', () => {
    vi.stubEnv('WISE_WEBHOOK', '');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).not.toContain('webhook');
  });

  it('includes webhook when WISE_WEBHOOK=1', () => {
    vi.stubEnv('WISE_WEBHOOK', '1');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).toContain('webhook');
  });

  // ---------------------------------------------------------------------------
  // No platforms when no env vars set
  // ---------------------------------------------------------------------------

  it('returns empty array when no platform env vars are set', () => {
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Combined: all gates open
  // ---------------------------------------------------------------------------

  it('includes all platforms when all env vars are set', () => {
    vi.stubEnv('WISE_TELEGRAM', '1');
    vi.stubEnv('WISE_DISCORD', '1');
    vi.stubEnv('WISE_SLACK', '1');
    vi.stubEnv('WISE_WEBHOOK', '1');
    const platforms = getEnabledPlatforms(makeFullConfig(), 'session-end');
    expect(platforms).toContain('telegram');
    expect(platforms).toContain('discord');
    expect(platforms).toContain('discord-bot');
    expect(platforms).toContain('slack');
    expect(platforms).toContain('webhook');
  });
});
