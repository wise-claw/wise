/**
 * Notepad Wisdom 类型
 *
 * 计划维度 notepad wisdom 系统的类型定义。
 */

export interface WisdomEntry {
  timestamp: string;
  content: string;
}

export type WisdomCategory = 'learnings' | 'decisions' | 'issues' | 'problems';

export interface PlanWisdom {
  planName: string;
  learnings: WisdomEntry[];
  decisions: WisdomEntry[];
  issues: WisdomEntry[];
  problems: WisdomEntry[];
}
