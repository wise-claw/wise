/**
 * 韩语音译映射表，用于跨脚本的触发词匹配。
 *
 * 将小写英文触发短语映射到对应的韩语等价词。
 * 在 cache 加载时用于扩展 triggersLower 数组，使
 * promptLower.includes(triggerLower) 能匹配韩语用户输入。
 *
 * 范围：仅外语音译词，不含韩语原生翻译。
 * 仅对在 YAML frontmatter 中显式声明 `triggers:` 的技能生效，
 * 且限定在足够具体、不易误触的短语上。
 * 内置技能（autopilot、ralph 等）由 keyword-detector 的
 * 正则规则处理，不在本映射表范围内。
 *
 * 新增语言：创建新的映射文件（如 japanese-map.ts），
 * 并在 bridge.ts 中组合 expandTriggers 调用。
 */

/** 英文触发词 -> 韩语音译词（仅外语音译词，不含韩语原生翻译） */
const KOREAN_MAP: Record<string, string[]> = {
  // === deep-dive 技能 ===
  "deep dive": ["딥다이브", "딥 다이브"],
  "deep-dive": ["딥다이브"],
  "trace and interview": ["트레이스 앤 인터뷰"],

  // === deep-pipeline 技能 ===
  "deep-pipeline": ["딥파이프라인", "딥 파이프라인"],
  "deep-pipe": ["딥파이프"],
};

/**
 * 将小写英文触发词数组扩展以包含韩语音译词。
 * 返回一个新数组，包含原始触发词及所有映射的韩语等价词。
 * 通过 Set 去重。
 *
 * 注意：返回的触发词仅用于 triggersLower（用于子串匹配）。
 * 原始 triggers 数组（用于在 MatchedSkill 中展示）不会被扩展，
 * 因此韩语变体不会出现在面向用户的触发词列表中。
 *
 * @param triggersLower - 已小写化的英文触发词
 * @returns 扩展后的数组，包含韩语等价词
 */
export function expandTriggers(triggersLower: string[]): string[] {
  const expanded = new Set(triggersLower);

  for (const trigger of triggersLower) {
    const koreanVariants = KOREAN_MAP[trigger];
    if (koreanVariants) {
      for (const variant of koreanVariants) {
        expanded.add(variant);
      }
    }
  }

  return Array.from(expanded);
}
