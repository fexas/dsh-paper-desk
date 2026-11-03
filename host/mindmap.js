/**
 * Project mind-map templates and payload normalisation.
 *
 * A project has exactly one graph stored in `mindmap.json`. Research projects
 * start from a problem → method → evaluation skeleton; learning projects start
 * from a foundations → concepts → timeline → recall skeleton. Both templates
 * are only starting points: every node, edge and position is editable.
 */

export const PROJECT_TYPES = ['research', 'learning'];

export function normalizeProjectType(value) {
  return value === 'learning' ? 'learning' : 'research';
}

const now = () => new Date().toISOString();

function node(id, x, y, kind, title, markdown) {
  return {
    id,
    type: 'mapNode',
    position: { x, y },
    data: {
      kind,
      title,
      markdown,
      paperIds: [],
    },
  };
}

function edge(source, target) {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
  };
}

export function seedMindmap(project = {}) {
  const type = normalizeProjectType(project.type);
  const title = String(project.name || 'Untitled project');
  const createdAt = now();
  if (type === 'learning') return learningMindmap(title, createdAt);
  return researchMindmap(title, createdAt);
}

function researchMindmap(title, createdAt) {
  const nodes = [
    node('root', 0, 0, 'root', title, [
      '**研究型项目**',
      '',
      '把这张图当作项目的 research compass：从 motivating example 到可验证的方法与 benchmark。',
      '',
      '> 双击节点编辑；从论文库拖入论文节点；把节点连起来表达你的论证。',
    ].join('\n')),
    node('problem', 430, -300, 'problem', '1 · Motivate example / problem', [
      '**要解决什么问题？**',
      '',
      '- Motivating example：',
      '- 现有方法的失败模式：',
      '- 为什么重要，谁会受益：',
      '- 一句话 research question：',
    ].join('\n')),
    node('problem-example', 820, -410, 'problem', 'Motivating example', [
      '一个具体、可复现、能让人立刻感到痛点的例子。',
      '',
      '- 输入：',
      '- 期望输出：',
      '- 目前会在哪里失败：',
    ].join('\n')),
    node('problem-question', 820, -235, 'question', 'Problem to solve', [
      '把 motivating example 抽象成可检验的问题。',
      '',
      '- 形式化定义：',
      '- 约束与假设：',
      '- 成功标准：',
    ].join('\n')),
    node('methods', 430, 60, 'method', '2 · Our methods', [
      '**方法的总览**',
      '',
      '先把方法压缩成一张图，再展开每个模块。',
      '',
      '- 输入 → 表示 → 推断 → 输出：',
      '- 与已有方法最关键的区别：',
    ].join('\n')),
    node('method-framework', 820, -70, 'method', 'Methods framework', [
      '把方法拆成 3–5 个模块，并画出数据流。',
      '',
      '1. ',
      '2. ',
      '3. ',
    ].join('\n')),
    node('method-motivation', 820, 120, 'idea', 'Motivation / key idea', [
      '**Key motivating idea**',
      '',
      '- 为什么这个设计是必要的：',
      '- 一个 toy case / 反例：',
      '- 直觉解释：',
    ].join('\n')),
    node('method-superior', 820, 310, 'method', 'Why superior against other methods', [
      '逐条对比，不要只写“效果更好”。',
      '',
      '- 对比方法：',
      '- 在什么条件下更好：',
      '- 代价 / 新增假设：',
    ].join('\n')),
    node('evaluation', 430, 650, 'eval', '3 · How to evaluate performance', [
      '**如何证明它真的有效？**',
      '',
      '- 任务与数据：',
      '- 指标：',
      '- 必须比较的 baseline：',
      '- 什么结果会推翻你的主张：',
    ].join('\n')),
    node('eval-bench', 820, 560, 'eval', 'Datasets / benchmarks', [
      '选择能区分方法差异的 benchmark。',
      '',
      '- Dataset / simulator：',
      '- 规模与难度：',
      '- 为什么它适合这个问题：',
    ].join('\n')),
    node('eval-metric', 820, 745, 'eval', 'Metrics', [
      '指标要能对应 research question，而不是只追求高分。',
      '',
      '- 主指标：',
      '- 辅助指标：',
      '- 统计显著性与方差：',
    ].join('\n')),
    node('eval-ablation', 820, 930, 'eval', 'Baselines / ablations', [
      '列出最需要排除的替代解释。',
      '',
      '- Baseline：',
      '- Ablation：',
      '- Compute / data budget：',
    ].join('\n')),
  ];
  const edges = [
    edge('root', 'problem'),
    edge('root', 'methods'),
    edge('root', 'evaluation'),
    edge('problem', 'problem-example'),
    edge('problem', 'problem-question'),
    edge('methods', 'method-framework'),
    edge('methods', 'method-motivation'),
    edge('methods', 'method-superior'),
    edge('evaluation', 'eval-bench'),
    edge('evaluation', 'eval-metric'),
    edge('evaluation', 'eval-ablation'),
  ];
  return { version: 1, type: 'research', nodes, edges, createdAt, updatedAt: createdAt };
}

function learningMindmap(title, createdAt) {
  const nodes = [
    node('root', 0, 0, 'root', title, [
      '**学习型项目**',
      '',
      '把学习方向当作一张可复习的路线图：先建立依赖关系，再补论文、例子和练习。',
      '',
      '> 双击节点编辑；从论文库拖入必读论文；用连线表示前置关系。',
    ].join('\n')),
    node('foundations', 430, -620, 'foundation', '1 · Foundations / prerequisites', [
      '学习这个方向之前，必须掌握什么？',
      '',
      '- 数学基础：',
      '- 编程 / 工具：',
      '- 前置概念：',
    ].join('\n')),
    node('foundations-math', 820, -760, 'foundation', 'Math & background', [
      '列出最小必要的数学背景，并为每一项写一个可检查的理解标准。',
      '',
      '- 概率 / 统计：',
      '- 线性代数 / 微积分：',
      '- 优化 / 数值方法：',
    ].join('\n')),
    node('foundations-terms', 820, -520, 'foundation', 'Key terminology', [
      '用一个术语表统一概念，避免不同论文里的同名异义。',
      '',
      '- 术语：',
      '- 定义：',
      '- 常见混淆：',
    ].join('\n')),
    node('concepts', 430, -40, 'concept', '2 · Core concepts', [
      '这一方向最核心的概念和它们之间的关系。',
      '',
      '- 核心对象：',
      '- 核心问题：',
      '- 概念之间的依赖：',
    ].join('\n')),
    node('concepts-map', 820, -280, 'concept', 'Concept map', [
      '把一个概念拆成定义、直觉、例子和边界条件。',
      '',
      '- 定义：',
      '- 直觉：',
      '- 例子：',
    ].join('\n')),
    node('concepts-example', 820, -40, 'idea', 'Canonical examples', [
      '每个核心概念至少配一个可以手算或画出来的例子。',
      '',
      '- 最小例子：',
      '- 反例：',
      '- 可视化：',
    ].join('\n')),
    node('concepts-misconception', 820, 200, 'question', 'Common misconceptions', [
      '记录你曾经误解、或者论文之间说法冲突的地方。',
      '',
      '- 误解：',
      '- 为什么容易误解：',
      '- 正确理解：',
    ].join('\n')),
    node('timeline', 430, 880, 'timeline', '3 · Development timeline', [
      '梳理这个方向的发展脉络，而不是只收集论文。',
      '',
      '- 起点：',
      '- 关键转折：',
      '- 当前 frontier：',
    ].join('\n')),
    node('timeline-early', 820, 640, 'timeline', 'Early approaches', [
      '最早的方法试图解决什么？它们的局限是什么？',
      '',
      '- 代表工作：',
      '- 核心假设：',
      '- 局限：',
    ].join('\n')),
    node('timeline-turn', 820, 880, 'timeline', 'Turning points', [
      '哪些论文或技术改变了问题的表述方式？',
      '',
      '- 转折点：',
      '- 改变了什么假设：',
      '- 为什么重要：',
    ].join('\n')),
    node('timeline-frontier', 820, 1120, 'timeline', 'Current frontier', [
      '今天最活跃的问题、方法和 benchmark。',
      '',
      '- 当前 SOTA：',
      '- 仍未解决：',
      '- 值得追踪的组 / 论文：',
    ].join('\n')),
    node('papers', 430, 1480, 'paper', '4 · Paper queue', [
      '从论文库拖入必读论文，并把它们放到发展脉络上。',
      '',
      '- Must read：',
      '- Skim next：',
    ].join('\n')),
    node('recall', 430, 1720, 'recall', '5 · Recall & exercises', [
      '复习不是重读，而是主动回忆和输出。',
      '',
      '- 三个层次解释：',
      '- 练习题：',
      '- 还能追问什么：',
    ].join('\n')),
    node('recall-explain', 820, 1360, 'recall', 'Explain it back', [
      '用 1 句话、1 段话、1 页纸分别解释这个方向。',
      '',
      '- 一句话：',
      '- 一段话：',
      '- 一页纸：',
    ].join('\n')),
    node('recall-practice', 820, 1600, 'recall', 'Practice problems', [
      '设计能检验理解、而不是记忆的练习。',
      '',
      '- 推导题：',
      '- 实现题：',
      '- 比较题：',
    ].join('\n')),
    node('recall-open', 820, 1840, 'question', 'Open questions', [
      '把仍然不确定的问题变成下一轮阅读的入口。',
      '',
      '- 问题：',
      '- 需要读什么：',
      '- 可以问谁 / 查什么：',
    ].join('\n')),
  ];
  const edges = [
    edge('root', 'foundations'),
    edge('root', 'concepts'),
    edge('root', 'timeline'),
    edge('root', 'papers'),
    edge('root', 'recall'),
    edge('foundations', 'foundations-math'),
    edge('foundations', 'foundations-terms'),
    edge('concepts', 'concepts-map'),
    edge('concepts', 'concepts-example'),
    edge('concepts', 'concepts-misconception'),
    edge('timeline', 'timeline-early'),
    edge('timeline', 'timeline-turn'),
    edge('timeline', 'timeline-frontier'),
    edge('recall', 'recall-explain'),
    edge('recall', 'recall-practice'),
    edge('recall', 'recall-open'),
  ];
  return { version: 1, type: 'learning', nodes, edges, createdAt, updatedAt: createdAt };
}

const KIND_VALUES = new Set([
  'root', 'section', 'problem', 'method', 'eval', 'idea', 'question',
  'foundation', 'concept', 'timeline', 'paper', 'recall', 'note',
]);

function cleanString(value, max) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, max);
}

/**
 * Keep the persisted graph bounded and structurally safe. Unknown/old fields
 * are dropped, but node positions, kinds, markdown and paper references stay.
 */
export function normalizeMindmap(raw, project = {}) {
  const fallback = seedMindmap(project);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) return fallback;
  const seen = new Set();
  const nodes = [];
  for (const item of raw.nodes.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue;
    const id = cleanString(item.id, 120);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const data = item.data && typeof item.data === 'object' ? item.data : {};
    const x = Number(item.position?.x);
    const y = Number(item.position?.y);
    nodes.push({
      id,
      type: 'mapNode',
      position: { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 },
      data: {
        kind: KIND_VALUES.has(data.kind) ? data.kind : 'note',
        title: cleanString(data.title, 300) || 'Untitled node',
        markdown: cleanString(data.markdown, 30_000),
        paperIds: Array.isArray(data.paperIds)
          ? [...new Set(data.paperIds.map((v) => cleanString(v, 120)).filter(Boolean))].slice(0, 40)
          : [],
      },
    });
  }
  if (nodes.length === 0) return fallback;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [];
  const edgeIds = new Set();
  for (const item of raw.edges && Array.isArray(raw.edges) ? raw.edges.slice(0, 800) : []) {
    if (!item || typeof item !== 'object') continue;
    const source = cleanString(item.source, 120);
    const target = cleanString(item.target, 120);
    if (!ids.has(source) || !ids.has(target) || source === target) continue;
    let id = cleanString(item.id, 180) || `e-${source}-${target}`;
    if (edgeIds.has(id)) id = `${id}-${edgeIds.size}`;
    edgeIds.add(id);
    edges.push({ id, source, target, type: 'smoothstep' });
  }
  return {
    version: 1,
    type: normalizeProjectType(project.type),
    nodes,
    edges,
    createdAt: cleanString(raw.createdAt, 40) || fallback.createdAt,
    updatedAt: cleanString(raw.updatedAt, 40) || now(),
  };
}
