/**
 * 目录 README 注入器类型
 *
 * 用于按会话追踪已注入 README 文件的类型定义。
 *
 * 移植自 oh-my-opencode 的 directory-readme-injector 钩子。
 */

/**
 * 用于追踪哪些目录 README 已被注入到会话上下文的存储数据。
 */
export interface InjectedPathsData {
  /** 会话标识符 */
  sessionID: string;
  /** 已注入 README 的目录路径列表 */
  injectedPaths: string[];
  /** 最后更新的时间戳 */
  updatedAt: number;
}
