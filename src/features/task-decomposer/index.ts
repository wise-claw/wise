/**
 * 任务分解引擎
 *
 * 分析任务并将其拆分为可并行的组件，各组件拥有不重叠的文件所有权。
 */

import type {
  TaskAnalysis,
  Component,
  Subtask,
  SharedFile,
  DecompositionResult,
  ProjectContext,
  TaskType,
  ComponentRole,
  DecompositionStrategy
} from './types.js';

// 重新导出类型
export type {
  TaskAnalysis,
  Component,
  Subtask,
  SharedFile,
  DecompositionResult,
  ProjectContext,
  TaskType,
  ComponentRole,
  FileOwnership,
  DecompositionStrategy
} from './types.js';

/**
 * 主入口：将任务分解为可并行的子任务
 */
export async function decomposeTask(
  task: string,
  projectContext: ProjectContext = { rootDir: process.cwd() }
): Promise<DecompositionResult> {
  // 步骤 1：分析任务
  const analysis = analyzeTask(task, projectContext);

  // 步骤 2：识别可并行的组件
  const components = identifyComponents(analysis, projectContext);

  // 步骤 3：识别共享文件
  const sharedFiles = identifySharedFiles(components, projectContext);

  // 步骤 4：生成带文件所有权的子任务
  const subtasks = generateSubtasks(components, analysis, projectContext);

  // 步骤 5：分配不重叠的文件所有权
  assignFileOwnership(subtasks, sharedFiles, projectContext);

  // 步骤 6：确定执行顺序
  const executionOrder = calculateExecutionOrder(subtasks);

  // 步骤 7：校验分解结果
  const warnings = validateDecomposition(subtasks, sharedFiles);

  return {
    analysis,
    components,
    subtasks,
    sharedFiles,
    executionOrder,
    strategy: explainStrategy(analysis, components),
    warnings
  };
}

/**
 * 分析任务以理解其结构和需求
 */
export function analyzeTask(
  task: string,
  context: ProjectContext
): TaskAnalysis {
  const lower = task.toLowerCase();

  // 检测任务类型
  const type = detectTaskType(lower);

  // 检测复杂度信号
  const complexity = estimateComplexity(lower, type);

  // 提取领域和技术
  const areas = extractAreas(lower, type);
  const technologies = extractTechnologies(lower, context);
  const filePatterns = extractFilePatterns(lower, context);

  // 检测依赖关系
  const dependencies = analyzeDependencies(areas, type);

  // 判断是否可并行
  const isParallelizable = complexity > 0.3 && areas.length >= 2;
  const estimatedComponents = isParallelizable
    ? Math.max(2, Math.min(areas.length, 6))
    : 1;

  return {
    task,
    type,
    complexity,
    isParallelizable,
    estimatedComponents,
    areas,
    technologies,
    filePatterns,
    dependencies
  };
}

/**
 * 从分析结果中识别可并行的组件
 */
export function identifyComponents(
  analysis: TaskAnalysis,
  context: ProjectContext
): Component[] {
  if (!analysis.isParallelizable) {
    // 不可并行任务使用单一组件
    return [
      {
        id: 'main',
        name: 'Main Task',
        role: 'module',
        description: analysis.task,
        canParallelize: false,
        dependencies: [],
        effort: analysis.complexity,
        technologies: analysis.technologies
      }
    ];
  }

  // 选择合适的策略
  const strategy = selectStrategy(analysis);
  const result = strategy.decompose(analysis, context);

  return result.components;
}

/**
 * 从组件生成子任务
 */
export function generateSubtasks(
  components: Component[],
  analysis: TaskAnalysis,
  context: ProjectContext
): Subtask[] {
  return components.map((component) => {
    const subtask: Subtask = {
      id: component.id,
      name: component.name,
      component,
      prompt: generatePromptForComponent(component, analysis, context),
      ownership: {
        componentId: component.id,
        patterns: [],
        files: [],
        potentialConflicts: []
      },
      blockedBy: component.dependencies,
      agentType: selectAgentType(component),
      modelTier: selectModelTier(component),
      acceptanceCriteria: generateAcceptanceCriteria(component, analysis),
      verification: generateVerificationSteps(component, analysis)
    };

    return subtask;
  });
}

/**
 * 为子任务分配不重叠的文件所有权
 */
export function assignFileOwnership(
  subtasks: Subtask[],
  sharedFiles: SharedFile[],
  context: ProjectContext
): void {
  const assignments = new Map<string, Set<string>>();

  for (const subtask of subtasks) {
    const patterns = inferFilePatterns(subtask.component, context);
    const files = inferSpecificFiles(subtask.component, context);

    subtask.ownership.patterns = patterns;
    subtask.ownership.files = files;

    // 跟踪分配情况以检测冲突
    for (const pattern of patterns) {
      if (!assignments.has(pattern)) {
        assignments.set(pattern, new Set());
      }
      assignments.get(pattern)!.add(subtask.id);
    }
  }

  // 检测冲突
  for (const subtask of subtasks) {
    const conflicts: string[] = [];

    for (const pattern of subtask.ownership.patterns) {
      const owners = assignments.get(pattern);
      if (owners && owners.size > 1) {
        // 检查是否为共享文件
        const isShared = sharedFiles.some((sf) => sf.pattern === pattern);
        if (!isShared) {
          conflicts.push(pattern);
        }
      }
    }

    subtask.ownership.potentialConflicts = conflicts;
  }
}

/**
 * 识别需要协调的文件（跨组件共享）
 */
export function identifySharedFiles(
  components: Component[],
  context: ProjectContext
): SharedFile[] {
  const sharedFiles: SharedFile[] = [];

  // 常见共享文件
  const commonShared = [
    'package.json',
    'tsconfig.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'README.md',
    '.gitignore',
    '.env',
    '.env.example',
    'docker-compose.yml',
    'Dockerfile'
  ];

  for (const file of commonShared) {
    const sharedBy = components.map((c) => c.id);

    if (sharedBy.length > 0) {
      sharedFiles.push({
        pattern: file,
        reason: 'Common configuration file',
        sharedBy,
        requiresOrchestration: true
      });
    }
  }

  // 检测框架特定的共享文件
  if (context.technologies?.includes('react') || context.technologies?.includes('next')) {
    sharedFiles.push({
      pattern: 'src/types/**',
      reason: 'Shared TypeScript types',
      sharedBy: components.map((c) => c.id),
      requiresOrchestration: false
    });
  }

  return sharedFiles;
}

// ============================================================================
// 辅助函数
// ============================================================================

function detectTaskType(task: string): TaskType {
  if (
    task.includes('fullstack') ||
    task.includes('full stack') ||
    (task.includes('frontend') && task.includes('backend'))
  ) {
    return 'fullstack-app';
  }

  if (task.includes('refactor') || task.includes('restructure')) {
    return 'refactoring';
  }

  // 需 2 个以上不同信号才归类为 bug-fix，以避免误报
  // （例如 "resolve the performance issue" 不应被归类为 bug-fix）
  const bugFixSignals = [
    /\bfix\b/,
    /\bbug\b/,
    /\berror\b/,
    /\bissue\b/,
    /\bbroken\b/,
    /\bcrash\b/,
    /\bfailure\b/,
    /\bregression\b/,
  ];
  const bugFixMatches = bugFixSignals.filter((re) => re.test(task)).length;
  if (bugFixMatches >= 2) {
    return 'bug-fix';
  }

  if (
    task.includes('feature') ||
    task.includes('add') ||
    task.includes('implement')
  ) {
    return 'feature';
  }

  if (task.includes('test') || task.includes('testing')) {
    return 'testing';
  }

  if (task.includes('document') || task.includes('docs')) {
    return 'documentation';
  }

  if (
    task.includes('deploy') ||
    task.includes('infra') ||
    task.includes('ci/cd')
  ) {
    return 'infrastructure';
  }

  if (task.includes('migrate') || task.includes('migration')) {
    return 'migration';
  }

  if (task.includes('optimize') || task.includes('performance')) {
    return 'optimization';
  }

  return 'unknown';
}

function estimateComplexity(task: string, type: TaskType): number {
  let score = 0.3; // 基础复杂度

  // 任务类型复杂度
  const typeComplexity: Record<TaskType, number> = {
    'fullstack-app': 0.9,
    refactoring: 0.7,
    'bug-fix': 0.4,
    feature: 0.6,
    testing: 0.5,
    documentation: 0.3,
    infrastructure: 0.8,
    migration: 0.8,
    optimization: 0.7,
    unknown: 0.5
  };

  score = typeComplexity[type];

  // 长度因子
  if (task.length > 200) score += 0.1;
  if (task.length > 500) score += 0.1;

  // 复杂度关键词
  const complexKeywords = [
    'multiple',
    'complex',
    'advanced',
    'integrate',
    'system',
    'architecture',
    'scalable',
    'real-time',
    'distributed'
  ];

  for (const keyword of complexKeywords) {
    if (task.includes(keyword)) {
      score += 0.05;
    }
  }

  return Math.min(1, score);
}

function extractAreas(task: string, _type: TaskType): string[] {
  const areas: string[] = [];

  const areaKeywords: Record<string, string[]> = {
    frontend: ['frontend', 'ui', 'react', 'vue', 'angular', 'component'],
    backend: ['backend', 'server', 'api', 'endpoint', 'service'],
    database: ['database', 'db', 'schema', 'migration', 'model'],
    auth: ['auth', 'authentication', 'login', 'user'],
    testing: ['test', 'testing', 'spec', 'unit test'],
    docs: ['document', 'docs', 'readme', 'guide'],
    config: ['config', 'setup', 'environment']
  };

  for (const [area, keywords] of Object.entries(areaKeywords)) {
    if (keywords.some((kw) => task.includes(kw))) {
      areas.push(area);
    }
  }

  return areas.length > 0 ? areas : ['main'];
}

function extractTechnologies(
  task: string,
  context: ProjectContext
): string[] {
  const techs: string[] = [];

  const techKeywords = [
    'react',
    'vue',
    'angular',
    'next',
    'nuxt',
    'express',
    'fastify',
    'nest',
    'typescript',
    'javascript',
    'node',
    'postgres',
    'mysql',
    'mongodb',
    'redis',
    'docker',
    'kubernetes'
  ];

  for (const tech of techKeywords) {
    if (task.includes(tech)) {
      techs.push(tech);
    }
  }

  // 从上下文中补充
  if (context.technologies) {
    techs.push(...context.technologies);
  }

  return Array.from(new Set(techs));
}

function extractFilePatterns(task: string, _context: ProjectContext): string[] {
  const patterns: string[] = [];

  // 查找显式路径
  const pathRegex = /(?:^|\s)([\w\-/]+\.[\w]+)/g;
  let match;
  while ((match = pathRegex.exec(task)) !== null) {
    patterns.push(match[1]);
  }

  // 常见目录模式
  if (task.includes('src')) patterns.push('src/**');
  if (task.includes('test')) patterns.push('**/*.test.ts');
  if (task.includes('component')) patterns.push('**/components/**');

  return patterns;
}

function analyzeDependencies(
  areas: string[],
  _type: TaskType
): Array<{ from: string; to: string }> {
  const deps: Array<{ from: string; to: string }> = [];

  // 常见依赖关系
  if (areas.includes('frontend') && areas.includes('backend')) {
    deps.push({ from: 'frontend', to: 'backend' });
  }

  if (areas.includes('backend') && areas.includes('database')) {
    deps.push({ from: 'backend', to: 'database' });
  }

  if (areas.includes('testing')) {
    // 测试依赖其他所有领域
    for (const area of areas) {
      if (area !== 'testing') {
        deps.push({ from: 'testing', to: area });
      }
    }
  }

  return deps;
}

function selectStrategy(analysis: TaskAnalysis): DecompositionStrategy {
  switch (analysis.type) {
    case 'fullstack-app':
      return fullstackStrategy;
    case 'refactoring':
      return refactoringStrategy;
    case 'bug-fix':
      return bugFixStrategy;
    case 'feature':
      return featureStrategy;
    default:
      return defaultStrategy;
  }
}

// ============================================================================
// 分解策略
// ============================================================================

const fullstackStrategy: DecompositionStrategy = {
  name: 'Fullstack App',
  applicableTypes: ['fullstack-app'],
  decompose: (analysis, _context) => {
    const components: Component[] = [];

    // 前端组件
    if (analysis.areas.includes('frontend') || analysis.areas.includes('ui')) {
      // 仅当同时创建后端组件时才依赖 backend
      const frontendDeps = (analysis.areas.includes('backend') || analysis.areas.includes('api')) ? ['backend'] : [];
      components.push({
        id: 'frontend',
        name: 'Frontend',
        role: 'frontend',
        description: 'Frontend UI and components',
        canParallelize: true,
        dependencies: frontendDeps,
        effort: 0.4,
        technologies: analysis.technologies.filter((t) =>
          ['react', 'vue', 'angular', 'next'].includes(t)
        )
      });
    }

    // 后端组件
    if (analysis.areas.includes('backend') || analysis.areas.includes('api')) {
      components.push({
        id: 'backend',
        name: 'Backend',
        role: 'backend',
        description: 'Backend API and business logic',
        canParallelize: true,
        dependencies: analysis.areas.includes('database') ? ['database'] : [],
        effort: 0.4,
        technologies: analysis.technologies.filter((t) =>
          ['express', 'fastify', 'nest', 'node'].includes(t)
        )
      });
    }

    // 数据库组件
    if (analysis.areas.includes('database')) {
      components.push({
        id: 'database',
        name: 'Database',
        role: 'database',
        description: 'Database schema and migrations',
        canParallelize: true,
        dependencies: [],
        effort: 0.2,
        technologies: analysis.technologies.filter((t) =>
          ['postgres', 'mysql', 'mongodb'].includes(t)
        )
      });
    }

    // 共享组件
    components.push({
      id: 'shared',
      name: 'Shared',
      role: 'shared',
      description: 'Shared types, utilities, and configuration',
      canParallelize: true,
      dependencies: [],
      effort: 0.2,
      technologies: []
    });

    return { components, sharedFiles: [] };
  }
};

const refactoringStrategy: DecompositionStrategy = {
  name: 'Refactoring',
  applicableTypes: ['refactoring'],
  decompose: (analysis, _context) => {
    const components: Component[] = [];

    // 按模块/目录分组
    for (const area of analysis.areas) {
      components.push({
        id: area,
        name: `Refactor ${area}`,
        role: 'module',
        description: `Refactor ${area} module`,
        canParallelize: true,
        dependencies: [],
        effort: analysis.complexity / analysis.areas.length,
        technologies: []
      });
    }

    return { components, sharedFiles: [] };
  }
};

const bugFixStrategy: DecompositionStrategy = {
  name: 'Bug Fix',
  applicableTypes: ['bug-fix'],
  decompose: (analysis, _context) => {
    // bug 修复通常不可并行
    const components: Component[] = [
      {
        id: 'bugfix',
        name: 'Fix Bug',
        role: 'module',
        description: analysis.task,
        canParallelize: false,
        dependencies: [],
        effort: analysis.complexity,
        technologies: []
      }
    ];

    return { components, sharedFiles: [] };
  }
};

const featureStrategy: DecompositionStrategy = {
  name: 'Feature',
  applicableTypes: ['feature'],
  decompose: (analysis, _context) => {
    const components: Component[] = [];

    // 按功能领域拆分
    for (const area of analysis.areas) {
      components.push({
        id: area,
        name: `Implement ${area}`,
        role: area as ComponentRole,
        description: `Implement ${area} for the feature`,
        canParallelize: true,
        dependencies: [],
        effort: analysis.complexity / analysis.areas.length,
        technologies: []
      });
    }

    return { components, sharedFiles: [] };
  }
};

const defaultStrategy: DecompositionStrategy = {
  name: 'Default',
  applicableTypes: [],
  decompose: (analysis, _context) => {
    const components: Component[] = [
      {
        id: 'main',
        name: 'Main Task',
        role: 'module',
        description: analysis.task,
        canParallelize: false,
        dependencies: [],
        effort: analysis.complexity,
        technologies: []
      }
    ];

    return { components, sharedFiles: [] };
  }
};

// ============================================================================
// 子任务生成辅助函数
// ============================================================================

function generatePromptForComponent(
  component: Component,
  analysis: TaskAnalysis,
  _context: ProjectContext
): string {
  let prompt = `${component.description}\n\n`;

  prompt += `CONTEXT:\n`;
  prompt += `- Task Type: ${analysis.type}\n`;
  prompt += `- Component Role: ${component.role}\n`;

  if (component.technologies.length > 0) {
    prompt += `- Technologies: ${component.technologies.join(', ')}\n`;
  }

  prompt += `\nYour responsibilities:\n`;
  prompt += `1. ${component.description}\n`;
  prompt += `2. Ensure code quality and follow best practices\n`;
  prompt += `3. Write tests for your changes\n`;
  prompt += `4. Update documentation as needed\n`;

  if (component.dependencies.length > 0) {
    prompt += `\nDependencies: This component depends on ${component.dependencies.join(', ')} completing first.\n`;
  }

  return prompt;
}

function selectAgentType(component: Component): string {
  const roleToAgent: Record<ComponentRole, string> = {
    frontend: 'wise:designer',
    backend: 'wise:executor',
    database: 'wise:executor',
    api: 'wise:executor',
    ui: 'wise:designer',
    shared: 'wise:executor',
    testing: 'wise:qa-tester',
    docs: 'wise:writer',
    config: 'wise:executor',
    module: 'wise:executor'
  };

  return roleToAgent[component.role] || 'wise:executor';
}

function selectModelTier(component: Component): 'low' | 'medium' | 'high' {
  if (component.effort < 0.3) return 'low';
  if (component.effort < 0.7) return 'medium';
  return 'high';
}

function generateAcceptanceCriteria(
  component: Component,
  _analysis: TaskAnalysis
): string[] {
  const criteria: string[] = [];

  criteria.push(`${component.name} implementation is complete`);
  criteria.push('Code compiles without errors');
  criteria.push('Tests pass');

  if (component.role === 'frontend' || component.role === 'ui') {
    criteria.push('UI components render correctly');
    criteria.push('Responsive design works on all screen sizes');
  }

  if (component.role === 'backend' || component.role === 'api') {
    criteria.push('API endpoints return expected responses');
    criteria.push('Error handling is implemented');
  }

  if (component.role === 'database') {
    criteria.push('Database schema is correct');
    criteria.push('Migrations run successfully');
  }

  return criteria;
}

function generateVerificationSteps(
  component: Component,
  _analysis: TaskAnalysis
): string[] {
  const steps: string[] = [];

  steps.push('Run the project type check command');
  steps.push('Run the project lint command');
  steps.push('Run the project test command');

  if (component.role === 'frontend' || component.role === 'ui') {
    steps.push('Visual inspection of UI components');
  }

  if (component.role === 'backend' || component.role === 'api') {
    steps.push('Test API endpoints with curl or Postman');
  }

  return steps;
}

function inferFilePatterns(
  component: Component,
  _context: ProjectContext
): string[] {
  const patterns: string[] = [];

  switch (component.role) {
    case 'frontend':
    case 'ui':
      patterns.push('src/components/**', 'src/pages/**', 'src/styles/**');
      break;

    case 'backend':
    case 'api':
      patterns.push('src/api/**', 'src/routes/**', 'src/controllers/**');
      break;

    case 'database':
      patterns.push('src/db/**', 'src/models/**', 'migrations/**');
      break;

    case 'shared':
      patterns.push('src/types/**', 'src/utils/**', 'src/lib/**');
      break;

    case 'testing':
      patterns.push('**/*.test.ts', '**/*.spec.ts', 'tests/**');
      break;

    case 'docs':
      patterns.push('docs/**', '*.md');
      break;

    default:
      patterns.push(`src/${component.id}/**`);
  }

  return patterns;
}

function inferSpecificFiles(
  _component: Component,
  _context: ProjectContext
): string[] {
  const files: string[] = [];

  // 可在此添加组件特定的文件

  return files;
}

function calculateExecutionOrder(subtasks: Subtask[]): string[][] {
  const order: string[][] = [];
  const completed = new Set<string>();
  const remaining = new Set(subtasks.map((st) => st.id));

  while (remaining.size > 0) {
    const batch: string[] = [];

    for (const subtask of subtasks) {
      if (remaining.has(subtask.id)) {
        // 检查所有依赖是否已完成
        const canRun = subtask.blockedBy.every((dep) => completed.has(dep));

        if (canRun) {
          batch.push(subtask.id);
        }
      }
    }

    if (batch.length === 0) {
      // 循环依赖或错误
      order.push(Array.from(remaining));
      break;
    }

    order.push(batch);

    for (const id of batch) {
      remaining.delete(id);
      completed.add(id);
    }
  }

  return order;
}

function validateDecomposition(
  subtasks: Subtask[],
  sharedFiles: SharedFile[]
): string[] {
  const warnings: string[] = [];

  // 检查所有权重叠
  const patternOwners = new Map<string, string[]>();

  for (const subtask of subtasks) {
    for (const pattern of subtask.ownership.patterns) {
      if (!patternOwners.has(pattern)) {
        patternOwners.set(pattern, []);
      }
      patternOwners.get(pattern)!.push(subtask.id);
    }
  }

  for (const [pattern, owners] of Array.from(patternOwners.entries())) {
    if (owners.length > 1) {
      const isShared = sharedFiles.some((sf) => sf.pattern === pattern);
      if (!isShared) {
        warnings.push(
          `Pattern "${pattern}" is owned by multiple subtasks: ${owners.join(', ')}`
        );
      }
    }
  }

  // 检查没有文件所有权的子任务
  for (const subtask of subtasks) {
    if (
      subtask.ownership.patterns.length === 0 &&
      subtask.ownership.files.length === 0
    ) {
      warnings.push(`Subtask "${subtask.id}" has no file ownership assigned`);
    }
  }

  return warnings;
}

function explainStrategy(analysis: TaskAnalysis, components: Component[]): string {
  let explanation = `Task Type: ${analysis.type}\n`;
  explanation += `Parallelizable: ${analysis.isParallelizable ? 'Yes' : 'No'}\n`;
  explanation += `Components: ${components.length}\n\n`;

  if (analysis.isParallelizable) {
    explanation += `This task has been decomposed into ${components.length} parallel components:\n`;
    for (const component of components) {
      explanation += `- ${component.name} (${component.role})\n`;
    }
  } else {
    explanation += `This task is not suitable for parallelization and will be executed as a single component.\n`;
  }

  return explanation;
}
