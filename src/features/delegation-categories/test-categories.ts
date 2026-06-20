/**
 * 委派类别的手动测试
 *
 * 运行方式：npx tsx src/features/delegation-categories/test-categories.ts
 */

import {
  resolveCategory,
  isValidCategory,
  getAllCategories,
  getCategoryDescription,
  detectCategoryFromPrompt,
  getCategoryForTask,
  getCategoryTier,
  getCategoryTemperature,
  getCategoryThinkingBudget,
  getCategoryThinkingBudgetTokens,
  enhancePromptWithCategory,
  CATEGORY_CONFIGS,
} from './index.js';

console.log('=== Delegation Categories Test ===\n');

// 测试 1：解析所有类别
console.log('1. Testing resolveCategory():');
for (const category of getAllCategories()) {
  const resolved = resolveCategory(category);
  console.log(`  ${category}:`);
  console.log(`    tier: ${resolved.tier}`);
  console.log(`    temperature: ${resolved.temperature}`);
  console.log(`    thinkingBudget: ${resolved.thinkingBudget}`);
  console.log(`    description: ${resolved.description}`);
}
console.log();

// 测试 2：isValidCategory
console.log('2. Testing isValidCategory():');
console.log(`  isValidCategory('ultrabrain'): ${isValidCategory('ultrabrain')}`);
console.log(`  isValidCategory('invalid'): ${isValidCategory('invalid')}`);
console.log();

// 测试 3：getCategoryDescription
console.log('3. Testing getCategoryDescription():');
console.log(`  ultrabrain: ${getCategoryDescription('ultrabrain')}`);
console.log(`  quick: ${getCategoryDescription('quick')}`);
console.log();

// 测试 4：detectCategoryFromPrompt
console.log('4. Testing detectCategoryFromPrompt():');
const testPrompts = [
  'Design a beautiful dashboard with responsive layout',
  'Debug this complex race condition in the system',
  'Find where the authentication function is defined',
  'Write comprehensive documentation for the API',
  'Come up with innovative solutions for this problem',
  'Simple task with no keywords',
];

for (const prompt of testPrompts) {
  const detected = detectCategoryFromPrompt(prompt);
  console.log(`  "${prompt}"`);
  console.log(`    -> ${detected || 'null'}`);
}
console.log();

// 测试 5：getCategoryForTask
console.log('5. Testing getCategoryForTask():');

// 显式 tier
const explicitTier = getCategoryForTask({
  taskPrompt: 'Some task',
  explicitTier: 'LOW',
});
console.log(`  Explicit tier=LOW: ${explicitTier.category} (tier: ${explicitTier.tier})`);

// 显式类别
const explicitCategory = getCategoryForTask({
  taskPrompt: 'Some task',
  explicitCategory: 'ultrabrain',
});
console.log(`  Explicit category=ultrabrain: ${explicitCategory.category} (tier: ${explicitCategory.tier})`);

// 自动检测
const autoDetect = getCategoryForTask({
  taskPrompt: 'Design a beautiful UI component with animations',
});
console.log(`  Auto-detect from prompt: ${autoDetect.category} (tier: ${autoDetect.tier})`);
console.log();

// 测试 6：tier 提取
console.log('6. Testing tier extraction:');
console.log(`  getCategoryTier('ultrabrain'): ${getCategoryTier('ultrabrain')}`);
console.log(`  getCategoryTier('quick'): ${getCategoryTier('quick')}`);
console.log(`  getCategoryTemperature('artistry'): ${getCategoryTemperature('artistry')}`);
console.log(`  getCategoryThinkingBudget('ultrabrain'): ${getCategoryThinkingBudget('ultrabrain')}`);
console.log(`  getCategoryThinkingBudgetTokens('ultrabrain'): ${getCategoryThinkingBudgetTokens('ultrabrain')}`);
console.log();

// 测试 7：prompt 增强
console.log('7. Testing enhancePromptWithCategory():');
const basePrompt = 'Create a login form';
const enhanced = enhancePromptWithCategory(basePrompt, 'visual-engineering');
console.log(`  Base: ${basePrompt}`);
console.log(`  Enhanced: ${enhanced}`);
console.log();

// 测试 8：向后兼容
console.log('8. Testing backward compatibility with ComplexityTier:');
console.log('  Categories map to tiers:');
for (const [category, config] of Object.entries(CATEGORY_CONFIGS)) {
  console.log(`    ${category} -> ${config.tier}`);
}
console.log();

console.log('=== All tests completed ===');
