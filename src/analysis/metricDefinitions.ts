/**
 * Human-readable definitions for quality metrics (module details + architecture report).
 */
import { getLocale, type Locale } from "../i18n";
import type { MetricDirection, MetricId } from "./codeQualityMetrics";

type Localized = Record<Locale, string>;

export interface MetricDefinition {
  id: string;
  /** One-line what it measures. */
  summary: Localized;
  /** Longer explanation: meaning. */
  body: Localized;
  /** Explicit calculation / formula used by DevTree. */
  formula: Localized;
  direction: MetricDirection;
  /** External reference (Wikipedia / paper / docs). */
  learnMoreUrl?: string;
}

function L(en: string, zh: string): Localized {
  return { en, "zh-CN": zh };
}

const DEFS: Record<string, MetricDefinition> = {
  complexity: {
    id: "complexity",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Cyclomatic_complexity",
    summary: L(
      "McCabe cyclomatic complexity — decision points in control flow.",
      "McCabe 圈复杂度——控制流中的决策点数量。",
    ),
    body: L(
      "Higher values mean more paths to test and reason about. DevTree estimates this from keywords in source (or a structural proxy before source loads).",
      "越高表示路径越多、越难测与理解。DevTree 根据源码关键字估算（源码未加载时用结构代理）。",
    ),
    formula: L(
      "CC = 1 + count(if|elif|for|while|case|catch|switch|&&|||?)",
      "CC = 1 + 统计(if|elif|for|while|case|catch|switch|&&|||?)",
    ),
  },
  cyclomaticDensity: {
    id: "cyclomaticDensity",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Software_metric",
    summary: L(
      "Cyclomatic complexity density — CC divided by non-comment lines (NLOC).",
      "圈复杂度密度——圈复杂度除以非注释行（NLOC）。",
    ),
    body: L(
      "Gill–Kemerer style density: complexity per line of real code. A small file with many branches scores high even if absolute CC looks modest.",
      "Gill–Kemerer 风格密度：单位有效代码行的复杂度。短文件若分支多，即便绝对 CC 不大，密度也会偏高。",
    ),
    formula: L("density = CC / NLOC", "密度 = CC / NLOC"),
  },
  abc: {
    id: "abc",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/ABC_Software_Metric",
    summary: L(
      "ABC magnitude — Assignments, Branches, and Conditions size.",
      "ABC 量级——赋值、分支与条件的综合规模。",
    ),
    body: L(
      "Fitzpatrick metric from source heuristics. UI shows magnitude; detail text includes ⟨A, B, C⟩ counts.",
      "基于源码启发式的 Fitzpatrick 指标。界面显示量级，详情含 ⟨A, B, C⟩ 计数。",
    ),
    formula: L(
      "A = assignments (=, +=, …); B ≈ calls + return/throw; C = if/while/for/&&/||/?\n|ABC| = √(A² + B² + C²)",
      "A = 赋值 (=, +=, …)；B ≈ 调用 + return/throw；C = if/while/for/&&/||/?\n|ABC| = √(A² + B² + C²)",
    ),
  },
  halstead: {
    id: "halstead",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Halstead_complexity_measures",
    summary: L(
      "Halstead volume — vocabulary × length of operators and operands.",
      "Halstead 体积——运算符与操作数的词汇量×长度。",
    ),
    body: L(
      "Tokenizes source into operators and operands. Higher volume usually means denser, harder-to-read code.",
      "将源码分词为运算符与操作数。体积越高通常越难读。",
    ),
    formula: L(
      "n = n1 + n2;  N = N1 + N2\nV = N · log₂(n)\nD = (n1/2) · (N2/n2);  E = D · V",
      "n = n1 + n2； N = N1 + N2\nV = N · log₂(n)\nD = (n1/2) · (N2/n2)； E = D · V",
    ),
  },
  cognitive: {
    id: "cognitive",
    direction: "lower-better",
    learnMoreUrl:
      "https://www.sonarsource.com/docs/CognitiveComplexity.pdf",
    summary: L(
      "Cognitive complexity — how hard the control flow is for a human to follow.",
      "认知复杂度——人脑跟随控制流的难度。",
    ),
    body: L(
      "Sonar-inspired score with nesting weight. Prefer this over raw cyclomatic when judging readability.",
      "参考 Sonar，并对嵌套加权。判断可读性时往往比裸圈复杂度更合适。",
    ),
    formula: L(
      "score += (1 + nesting) per control structure\nscore += 1 per else / logical op (&& || ??)\nscore += ternary × (1 + nesting)",
      "每个控制结构 += (1 + 嵌套深度)\n每个 else / 逻辑运算 (&& || ??) += 1\n三元运算 += 次数 × (1 + 嵌套深度)",
    ),
  },
  maintainability: {
    id: "maintainability",
    direction: "higher-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Maintainability",
    summary: L(
      "Maintainability Index (0–100) from volume, complexity, and size.",
      "可维护性指数（0–100），综合体积、复杂度与规模。",
    ),
    body: L(
      "Visual Studio / Radon style index. Higher is easier to maintain.",
      "Visual Studio / Radon 风格指数。越高越易维护。",
    ),
    formula: L(
      "raw = 171 − 5.2·ln(V) − 0.23·CC − 16.2·ln(LOC)\nMI = clamp(raw × 100 / 171, 0, 100)",
      "raw = 171 − 5.2·ln(V) − 0.23·CC − 16.2·ln(LOC)\nMI = clamp(raw × 100 / 171, 0, 100)",
    ),
  },
  dit: {
    id: "dit",
    direction: "lower-better",
    learnMoreUrl:
      "https://en.wikipedia.org/wiki/Software_package_metrics#Depth_of_Inheritance_Tree_(DIT)",
    summary: L(
      "Depth of Inheritance Tree — how deep local type hierarchies go.",
      "继承树深度——本地类型继承有多深。",
    ),
    body: L(
      "Heuristic from extends / Python bases / trait bounds in this file. Cross-file chains are not fully resolved.",
      "根据本文件中的 extends / Python 基类 / trait 约束启发式统计。跨文件链未完整解析。",
    ),
    formula: L(
      "DIT ≈ max local inheritance depth in file (extends / bases / trait bounds)",
      "DIT ≈ 本文件中最大本地继承深度（extends / 基类 / trait 约束）",
    ),
  },
  cbo: {
    id: "cbo",
    direction: "lower-better",
    learnMoreUrl:
      "https://en.wikipedia.org/wiki/Coupling_(computer_programming)",
    summary: L(
      "Coupling Between Objects — unique files this module depends on or is tied to.",
      "对象间耦合（CBO）——本模块依赖或关联的唯一定文件数。",
    ),
    body: L(
      "High CBO means changes elsewhere are more likely to ripple here (and vice versa).",
      "CBO 高表示外部变更更容易波及此处（反之亦然）。",
    ),
    formula: L(
      "CBO = |unique imported files ∪ files reached via symbol edges|",
      "CBO = |唯一 import 文件 ∪ 经符号边到达的文件|",
    ),
  },
  cohesion: {
    id: "cohesion",
    direction: "higher-better",
    learnMoreUrl:
      "https://en.wikipedia.org/wiki/Cohesion_(computer_science)",
    summary: L(
      "Cohesion — how connected symbols inside the file are to each other.",
      "内聚——文件内符号彼此关联的紧密程度。",
    ),
    body: L(
      "Proxy from the symbol graph (not classic LCOM): tightness of weakly connected components.",
      "基于符号图的代理（非经典 LCOM）：弱连通分量的紧密度。",
    ),
    formula: L(
      "cohesion% = 100 × (1 − (components − 1) / max(symbols − 1, 1))\n(1 component → 100%; all isolated → 0%)",
      "内聚% = 100 × (1 − (连通分量数 − 1) / max(符号数 − 1, 1))\n（1 个分量 → 100%；全孤立 → 0%）",
    ),
  },
  churn: {
    id: "churn",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Code_churn",
    summary: L(
      "Code churn — lines added + deleted in recent git history.",
      "代码流失——近期 git 历史中增删行数。",
    ),
    body: L(
      "From git log --numstat over the lookback window (default 90 days).",
      "来自回看窗口（默认 90 天）的 git log --numstat。",
    ),
    formula: L(
      "churn = Σ (lines_added + lines_deleted) over commits in last N days",
      "churn = Σ (新增行 + 删除行)，统计最近 N 天提交",
    ),
  },
  ccp: {
    id: "ccp",
    direction: "lower-better",
    learnMoreUrl: "https://arxiv.org/abs/2007.10912",
    summary: L(
      "Corrective Commit Probability — share of commits that look like bug fixes.",
      "修正提交概率（CCP）——看起来像缺陷修复的提交占比。",
    ),
    body: L(
      "Amit & Feitelson style keyword classification of commit subjects (fix/bug/defect/…).",
      "Amit & Feitelson 风格：用 fix/bug/defect/… 等关键词分类提交说明。",
    ),
    formula: L(
      "CCP% = 100 × corrective_commits / total_commits\n(corrective ≈ subject matches fix|bug|defect|hotfix|…)",
      "CCP% = 100 × 修正提交数 / 总提交数\n（修正 ≈ 说明匹配 fix|bug|defect|hotfix|…）",
    ),
  },
  coverage: {
    id: "coverage",
    direction: "higher-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Code_coverage",
    summary: L(
      "Test presence proxy — whether a companion test file exists (not line coverage).",
      "测试存在性代理——是否有配套测试文件（非行覆盖率）。",
    ),
    body: L(
      "This is not executed line/branch coverage — import a coverage report for that.",
      "这不是执行后的行/分支覆盖率——那需要覆盖率报告。",
    ),
    formula: L(
      "coverage = 100 if companion .test/.spec/_test/tests path exists, else 0",
      "coverage = 若存在配套 .test/.spec/_test/tests 路径则为 100，否则为 0",
    ),
  },
  security: {
    id: "security",
    direction: "lower-better",
    summary: L(
      "Security finding density — security-related issues per 1000 lines.",
      "安全发现密度——每千行安全相关问题数。",
    ),
    body: L(
      "Weighted fail/warn findings whose rules match security/XSS/secret/auth/… cues.",
      "规则名匹配 security/XSS/secret/auth/… 的加权 fail/warn 发现。",
    ),
    formula: L(
      "density = (Σ weights) / LOC × 1000\n(fail weight = 2, warn weight = 1)",
      "密度 = (Σ 权重) / LOC × 1000\n（fail 权重 = 2，warn 权重 = 1）",
    ),
  },
  documentation: {
    id: "documentation",
    direction: "higher-better",
    summary: L(
      "Documentation score — inverted pressure from doc/comment findings.",
      "文档评分——由文档/注释类发现反推。",
    ),
    body: L(
      "Without findings the score stays n/a (no full docstring analyzer yet).",
      "无发现时为 n/a（尚无完整 docstring 分析器）。",
    ),
    formula: L(
      "score = max(0, 100 − 25 × doc_finding_hits)  (n/a if no findings)",
      "score = max(0, 100 − 25 × 文档发现命中数)（无发现则为 n/a）",
    ),
  },
  duplication: {
    id: "duplication",
    direction: "lower-better",
    summary: L(
      "Duplication hits — DRY / duplication findings from validation rules.",
      "重复命中——校验规则中的 DRY/重复发现数。",
    ),
    body: L(
      "Prefer the Duplicated % metric for clone fingerprint overlap.",
      "克隆指纹重叠请看「Duplicated %」。",
    ),
    formula: L(
      "hits = count(validation items tagged DRY / duplication)",
      "hits = 统计标记为 DRY / duplication 的校验项",
    ),
  },
  duplicatedCode: {
    id: "duplicatedCode",
    direction: "lower-better",
    summary: L(
      "Duplicated code % — share of NLOC matching project-wide clone fingerprints.",
      "重复代码 %——与项目内克隆指纹重合的 NLOC 占比。",
    ),
    body: L(
      "Normalized code lines are fingerprinted across the repo.",
      "对归一化代码行做全库指纹。",
    ),
    formula: L(
      "duplicated% = 100 × (lines with fingerprint count ≥ 2) / NLOC",
      "duplicated% = 100 × (指纹出现次数 ≥ 2 的行数) / NLOC",
    ),
  },
  deadCode: {
    id: "deadCode",
    direction: "lower-better",
    summary: L(
      "Dead code % — symbols in this file with no inbound references.",
      "死代码 %——本文件中无入边引用的符号占比。",
    ),
    body: L(
      "Uses the project symbol graph. Dynamic calls / reflection may false-positive.",
      "基于项目符号图。动态调用 / 反射可能误报。",
    ),
    formula: L(
      "dead% = 100 × (symbols with zero inbound edges) / symbols_in_file",
      "dead% = 100 × (入边为 0 的符号数) / 文件内符号数",
    ),
  },
  staleDecisions: {
    id: "staleDecisions",
    direction: "lower-better",
    summary: L(
      "Stale decisions — TODO/FIXME/HACK/DEPRECATED markers per kLOC.",
      "陈旧决策——每千行 TODO/FIXME/HACK/DEPRECATED 标记数。",
    ),
    body: L(
      "High density suggests unfinished design choices.",
      "密度高暗示未完成的设计决策。",
    ),
    formula: L(
      "density = count(TODO|FIXME|HACK|XXX|DEPRECATED|…) / LOC × 1000",
      "密度 = 统计(TODO|FIXME|HACK|XXX|DEPRECATED|…) / LOC × 1000",
    ),
  },
  issues: {
    id: "issues",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Software_metric",
    summary: L(
      "Issue density — weighted fail/warn findings per 1000 lines (defect proxy).",
      "问题密度——每千行加权 fail/warn 发现（缺陷代理）。",
    ),
    body: L(
      "Closest built-in stand-in for bugs-per-LOC / defect density from the last analysis.",
      "最接近「每行缺陷 / 缺陷密度」的内置代理，来自上次分析。",
    ),
    formula: L(
      "density = (2×fails + 1×warns) / LOC × 1000",
      "密度 = (2×fail + 1×warn) / LOC × 1000",
    ),
  },
  aiQuality: {
    id: "aiQuality",
    direction: "lower-better",
    summary: L(
      "AI quality density — AI review / clean-code / architecture findings per kLOC.",
      "AI 质量密度——每千行 AI 审查 / 整洁代码 / 架构发现。",
    ),
    body: L(
      "Findings from rules prefixed ai_/review_/arch_/clean_.",
      "来自 ai_/review_/arch_/clean_ 前缀规则的发现。",
    ),
    formula: L(
      "density = (Σ AI-rule weights) / LOC × 1000",
      "密度 = (Σ AI 规则权重) / LOC × 1000",
    ),
  },
  nloc: {
    id: "nloc",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Source_lines_of_code",
    summary: L(
      "NLOC — non-comment lines of code (executable / declarative lines).",
      "NLOC——非注释代码行（可执行/声明行）。",
    ),
    body: L(
      "Prefer NLOC over raw LOC when comparing code size.",
      "比较代码规模时优先用 NLOC 而非裸 LOC。",
    ),
    formula: L(
      "NLOC = physical lines − blank − comment-only",
      "NLOC = 物理行 − 空行 − 纯注释行",
    ),
  },
  cloc: {
    id: "cloc",
    direction: "higher-better",
    summary: L(
      "CLOC — comment lines of code.",
      "CLOC——注释行数。",
    ),
    body: L(
      "Useful with comment density; very low CLOC may mean under-documented code.",
      "可与注释密度一起看；CLOC 过低可能表示文档不足。",
    ),
    formula: L(
      "CLOC = count(comment-only lines: //, /* */, #, …)",
      "CLOC = 统计纯注释行：//、/* */、# 等",
    ),
  },
  codeDensity: {
    id: "codeDensity",
    direction: "higher-better",
    summary: L(
      "Code density — NLOC / LOC × 100.",
      "代码密度——NLOC / LOC × 100。",
    ),
    body: L(
      "Low density often means lots of blanks/comments or generated noise.",
      "过低通常表示空行/注释很多或生成物噪音。",
    ),
    formula: L("codeDensity% = 100 × NLOC / LOC", "代码密度% = 100 × NLOC / LOC"),
  },
  commentDensity: {
    id: "commentDensity",
    direction: "higher-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Software_metric",
    summary: L(
      "Comment density — CLOC / (NLOC + CLOC) × 100.",
      "注释密度——CLOC / (NLOC + CLOC) × 100。",
    ),
    body: L(
      "Sonar-style ratio of comments among non-blank lines.",
      "Sonar 风格：非空行中注释占比。",
    ),
    formula: L(
      "commentDensity% = 100 × CLOC / (NLOC + CLOC)",
      "注释密度% = 100 × CLOC / (NLOC + CLOC)",
    ),
  },
  size: {
    id: "size",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Source_lines_of_code",
    summary: L(
      "Size — physical lines of code including blanks and comments.",
      "规模——含空行与注释的物理行数。",
    ),
    body: L(
      "Raw LOC for the file or total LOC for a package.",
      "文件的裸 LOC，或包的合计 LOC。",
    ),
    formula: L(
      "LOC = NLOC + CLOC + blank  (package = Σ file LOC)",
      "LOC = NLOC + CLOC + 空行（包 = Σ 文件 LOC）",
    ),
  },

  // ── DSM / Modularity health ──────────────────────────────────────────
  cycles: {
    id: "cycles",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Circular_dependency",
    summary: L(
      "Dependency cycles — strongly connected groups in the module graph.",
      "依赖环——模块图中的强连通组数量。",
    ),
    body: L(
      "Counted from the Design Structure Matrix after ordering. Cycles make build order and change impact harder to reason about.",
      "在设计结构矩阵（DSM）排序后统计。环会让构建顺序与变更影响更难推理。",
    ),
    formula: L(
      "cycles = number of SCCs with size ≥ 2\nnodesInCycles = Σ |SCC| for those cycles",
      "cycles = 大小 ≥ 2 的强连通分量个数\nnodesInCycles = 这些环中的节点总数",
    ),
  },
  upperTriangle: {
    id: "upperTriangle",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Design_structure_matrix",
    summary: L(
      "Upper-triangle density — reverse / upward dependencies after partitioning.",
      "上三角密度——分区后的反向 / 向上依赖占比。",
    ),
    body: L(
      "After hierarchical ordering, dependencies above the diagonal point “the wrong way” (layer violations).",
      "层次排序后，对角线上侧的依赖指向“错误方向”（层违规）。",
    ),
    formula: L(
      "upperTriangleDensity = upper_triangle_deps / upper_triangle_slots",
      "upperTriangleDensity = 上三角依赖数 / 上三角可填格数",
    ),
  },
  coupling: {
    id: "coupling",
    direction: "lower-better",
    learnMoreUrl:
      "https://en.wikipedia.org/wiki/Coupling_(computer_programming)",
    summary: L(
      "Coupling density — share of off-diagonal DSM cells that are nonzero.",
      "耦合密度——DSM 非对角非零单元格占比。",
    ),
    body: L(
      "How densely modules depend on each other. High density means a more tangled dependency graph.",
      "模块彼此依赖的密集程度。密度高表示依赖图更缠结。",
    ),
    formula: L(
      "couplingDensity = nonzero_off_diagonal_cells / (N² − N)",
      "couplingDensity = 非对角非零格 / (N² − N)",
    ),
  },
  propagation: {
    id: "propagation",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Design_structure_matrix",
    summary: L(
      "Propagation cost — MacCormack visibility density (change fan-out).",
      "传播代价——MacCormack 可见性密度（变更波及范围）。",
    ),
    body: L(
      "Fraction of module pairs that can reach each other through the dependency graph. Higher means changes ripple farther.",
      "可通过依赖图互相到达的模块对占比。越高表示变更波及越远。",
    ),
    formula: L(
      "propagationCost = reachability_pairs / N²\n(transitive closure of the DSM adjacency)",
      "propagationCost = 可达模块对数 / N²\n（DSM 邻接的传递闭包）",
    ),
  },
  clustered: {
    id: "clustered",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Design_structure_matrix",
    summary: L(
      "Clustered cost — MacCormack cost with buses (λ=2), normalized.",
      "聚类代价——含总线的 MacCormack 代价（λ=2），已归一化。",
    ),
    body: L(
      "Penalizes dependencies that cross cluster boundaries more than local ones. Normalized by deps × N^λ.",
      "跨聚类依赖的惩罚高于局部依赖。按 deps × N^λ 归一化。",
    ),
    formula: L(
      "clusteredCost = Σ dep_cost(i→j) with λ=2 clustering\nnormalized = clusteredCost / (deps × N^λ)",
      "clusteredCost = Σ 依赖代价(i→j)，λ=2 聚类\nnormalized = clusteredCost / (deps × N^λ)",
    ),
  },
  buses: {
    id: "buses",
    direction: "lower-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Design_structure_matrix",
    summary: L(
      "Vertical buses — shared modules with high fan-in (≥10% of callers).",
      "纵向总线——扇入很高的共享模块（≥10% 调用方）。",
    ),
    body: L(
      "Bus modules are widely depended on. A few are normal (utilities); many suggest a “god module” / hub architecture.",
      "总线模块被广泛依赖。少量正常（工具库）；过多暗示“上帝模块”/中心辐射架构。",
    ),
    formula: L(
      "bus = module with fan-in ≥ 10% of other modules\nbuses = count(bus modules)",
      "bus = 扇入 ≥ 其他模块 10% 的模块\nbuses = 总线模块个数",
    ),
  },
  modularityHealth: {
    id: "modularityHealth",
    direction: "higher-better",
    learnMoreUrl: "https://en.wikipedia.org/wiki/Design_structure_matrix",
    summary: L(
      "Modularity health (0–100) — blended DSM score for the module graph.",
      "模块化健康度（0–100）——模块图的综合 DSM 评分。",
    ),
    body: L(
      "Starts at 100 and subtracts penalties for cycles, upper-triangle deps, propagation, clustered cost, and coupling.",
      "从 100 起，按环、上三角依赖、传播、聚类代价与耦合扣分。",
    ),
    formula: L(
      "health = clamp(100 − cyclePenalty − upperPenalty − propPenalty − clusterPenalty − couplePenalty, 0, 100)\ncyclePenalty = (nodesInCycles/N)×45 + min(cycles,10)×2\nupperPenalty = upperTriangleDensity×20\npropPenalty = propagationCost×15\nclusterPenalty = clusteredCostNormalized×15\ncouplePenalty = couplingDensity×5",
      "health = clamp(100 − 环惩罚 − 上三角惩罚 − 传播惩罚 − 聚类惩罚 − 耦合惩罚, 0, 100)\n环惩罚 = (环中节点/N)×45 + min(环数,10)×2\n上三角惩罚 = upperTriangleDensity×20\n传播惩罚 = propagationCost×15\n聚类惩罚 = clusteredCostNormalized×15\n耦合惩罚 = couplingDensity×5",
    ),
  },
};

export function metricDefinition(id: string): MetricDefinition | null {
  return DEFS[id] ?? null;
}

export function metricDefinitionText(
  def: MetricDefinition,
  field: "summary" | "body" | "formula",
  locale: Locale = getLocale(),
): string {
  return def[field][locale] ?? def[field].en;
}

/** All known quality metric ids that have definitions. */
export function definedMetricIds(): string[] {
  return Object.keys(DEFS);
}

export type { MetricId };
