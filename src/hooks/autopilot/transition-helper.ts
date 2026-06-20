/**
 * 事务式转换辅助器
 *
 * 以原子方式执行一系列步骤：若任一步骤失败，
 * 所有先前已完成的步骤都按逆序回滚。
 */

export interface TransitionStep {
  name: string;
  execute: () => Promise<void>;
  rollback: () => Promise<void>;
}

export interface TransitionResult {
  success: boolean;
  failedStep?: string;
  error?: string;
}

/**
 * 以事务方式执行一系列转换步骤。
 * 若任一步骤失败，所有先前已完成的步骤都按逆序回滚。
 */
export async function executeTransition(steps: TransitionStep[]): Promise<TransitionResult> {
  const completed: TransitionStep[] = [];
  for (const step of steps) {
    try {
      await step.execute();
      completed.push(step);
    } catch (error) {
      // 按逆序回滚
      for (const done of completed.reverse()) {
        try { await done.rollback(); } catch { /* 尽力回滚 */ }
      }
      return { success: false, failedStep: step.name, error: String(error) };
    }
  }
  return { success: true };
}
