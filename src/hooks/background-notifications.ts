import { spawn } from "child_process";
import type { NotificationEvent, NotificationPayload } from "../notifications/types.js";

export type BackgroundNotificationData = Partial<NotificationPayload> & {
  sessionId: string;
  profileName?: string;
};

/**
 * 在一个独立的 detached Node 进程中派发由钩子触发的通知。
 *
 * 钩子前台进程有严格的 stdout JSON 协议，某些 CI 检查会在出现非预期 stderr 时
 * 失败。若在进程内执行通知工作，通知格式化器、传输失败、自定义集成或传递依赖
 * 模块产生的延迟控制台输出会污染前台钩子流。detached 子进程使用
 * stdio: "ignore"，使所有通知的 stdout/stderr 被隔离，同时前台钩子可迅速返回
 * 其协议载荷。
 */
export function dispatchNotificationInBackground(
  event: NotificationEvent,
  data: BackgroundNotificationData,
): void {
  if (process.env.WISE_NOTIFY === "0") return;

  let serializedEvent: string;
  let serializedData: string;
  try {
    serializedEvent = JSON.stringify(event);
    serializedData = JSON.stringify(data);
  } catch {
    return;
  }

  const notificationsModuleUrl = new URL(
    "../notifications/index.js",
    import.meta.url,
  ).href;

  const childSource = `import(${JSON.stringify(notificationsModuleUrl)})\n` +
    `  .then(({ notify }) => notify(${serializedEvent}, ${serializedData}))\n` +
    `  .catch(() => {});`;

  try {
    const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        WISE_HOOK_BACKGROUND_CHILD: "1",
      },
    });
    child.unref();
  } catch {
    // 仅尽力而为：通知派发绝不能中断钩子处理。
  }
}
