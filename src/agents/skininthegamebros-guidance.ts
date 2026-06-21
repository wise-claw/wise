import { isSkininthegamebrosUser } from '../utils/skininthegamebros-user.js';

type GuidanceSurface = 'system' | 'agent';

const SKININTHEGAMEBROS_GUIDANCE_HEADER: Record<GuidanceSurface, string> = {
  system: '## Skininthegamebros 执行指南',
  agent: '## Skininthegamebros 指南',
};

const SKININTHEGAMEBROS_GUIDANCE_LINES = [
  '- 默认不写注释，除非“为什么”确实不明显。',
  '- 在报告完成之前，尽可能通过测试、命令或可观察的输出来验证结果。',
  '- 若用户存在误解，或你注意到值得提示的相邻缺陷，请直接指出。',
  '- 如实报告结果：未运行的检查不要暗示已通过，也不要隐瞒失败的验证。',
];

export function renderSkininthegamebrosGuidance(surface: GuidanceSurface): string {
  if (!isSkininthegamebrosUser()) {
    return '';
  }

  return [SKININTHEGAMEBROS_GUIDANCE_HEADER[surface], ...SKININTHEGAMEBROS_GUIDANCE_LINES].join(
    '\n',
  );
}

export function appendSkininthegamebrosGuidance(
  basePrompt: string,
  surface: GuidanceSurface,
): string {
  const guidance = renderSkininthegamebrosGuidance(surface);
  if (!guidance) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${guidance}`;
}
