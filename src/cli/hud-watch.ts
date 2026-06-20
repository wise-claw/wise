import { registerStandaloneShutdownHandlers } from '../mcp/standalone-shutdown.js';

export interface HudMainLike {
  (watchMode: boolean, skipInit?: boolean): Promise<void>;
}

export interface HudWatchLoopOptions {
  intervalMs: number;
  hudMain: HudMainLike;
  registerShutdownHandlers?: typeof registerStandaloneShutdownHandlers;
}

/**
 * 以 watch 模式运行 HUD，直到观察到显式的关闭信号或父进程退出条件为止。
 */
export async function runHudWatchLoop(options: HudWatchLoopOptions): Promise<void> {
  const registerShutdownHandlers = options.registerShutdownHandlers ?? registerStandaloneShutdownHandlers;
  let skipInit = false;
  let shouldStop = false;
  let wakeSleep: (() => void) | null = null;

  registerShutdownHandlers({
    onShutdown: async () => {
      shouldStop = true;
      wakeSleep?.();
    },
  });

  while (!shouldStop) {
    await options.hudMain(true, skipInit);
    skipInit = true;

    if (shouldStop) {
      break;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wakeSleep = null;
        resolve();
      }, options.intervalMs);

      wakeSleep = () => {
        clearTimeout(timer);
        wakeSleep = null;
        resolve();
      };

      (timer as { unref?: () => void }).unref?.();
    });
  }
}
