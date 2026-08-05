/**
 * Classic software metrics (heuristic / source-token based).
 * Halstead, Cognitive Complexity, Maintainability Index, DIT, CBO.
 */

export interface HalsteadMetrics {
  /** Distinct operators (n1) */
  distinctOperators: number;
  /** Distinct operands (n2) */
  distinctOperands: number;
  /** Total operators (N1) */
  totalOperators: number;
  /** Total operands (N2) */
  totalOperands: number;
  /** Vocabulary n = n1 + n2 */
  vocabulary: number;
  /** Length N = N1 + N2 */
  length: number;
  /** Volume V = N * log2(n) */
  volume: number;
  /** Difficulty D = (n1/2) * (N2/n2) */
  difficulty: number;
  /** Effort E = D * V */
  effort: number;
}

/** Fitzpatrick ABC: Assignments, Branches, Conditions. */
export interface AbcMetrics {
  assignments: number;
  branches: number;
  conditions: number;
  /** √(A² + B² + C²) */
  magnitude: number;
}

export interface SourceClassicMetrics {
  halstead: HalsteadMetrics;
  /** Sonar-style cognitive complexity (simplified). */
  cognitiveComplexity: number;
  /** 0–100 maintainability index (Visual Studio style). */
  maintainabilityIndex: number;
  /** Max inheritance depth observed in this file (local heuristic). */
  depthOfInheritance: number;
  /** Keyword cyclomatic estimate (decision points + 1). */
  cyclomaticComplexity: number;
  abc: AbcMetrics;
}

const OPERATOR_KEYWORDS = new Set([
  "if",
  "else",
  "elif",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "return",
  "throw",
  "catch",
  "try",
  "finally",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "in",
  "of",
  "await",
  "yield",
  "typeof",
  "void",
  "with",
  "and",
  "or",
  "not",
]);

/** Strip comments and string literals for tokenization. */
export function stripNoise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/'''[\s\S]*?'''/g, " ")
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, " 'str' ")
    .replace(/"(?:\\.|[^"\\])*"/g, ' "str" ')
    .replace(/`(?:\\.|[^`\\])*`/g, " `str` ");
}

/**
 * Halstead metrics from source tokens.
 * Operators: punctuation + control keywords; operands: identifiers + numbers.
 */
export function computeHalstead(source: string): HalsteadMetrics {
  const text = stripNoise(source);
  const operators = new Map<string, number>();
  const operands = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  // Multi-char operators first
  const opPattern =
    /=>|\+\+|--|&&|\|\||\?\?|\?=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=|===|!==|==|!=|<=|>=|<<|>>|\*\*|\/\/|::|\.\.\.|[+\-*/%&|^~!<>=?:;,.(){}\[\]]/g;
  for (const m of text.matchAll(opPattern)) {
    bump(operators, m[0]!);
  }

  const cleaned = text.replace(opPattern, " ");
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    if (/^\d+(\.\d+)?$/.test(raw)) {
      bump(operands, raw);
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
      const lower = raw.toLowerCase();
      if (OPERATOR_KEYWORDS.has(lower)) bump(operators, lower);
      else bump(operands, raw);
    }
  }

  const n1 = Math.max(1, operators.size);
  const n2 = Math.max(1, operands.size);
  let N1 = 0;
  let N2 = 0;
  for (const v of operators.values()) N1 += v;
  for (const v of operands.values()) N2 += v;
  N1 = Math.max(1, N1);
  N2 = Math.max(1, N2);

  const vocabulary = n1 + n2;
  const length = N1 + N2;
  const volume = length * Math.log2(Math.max(2, vocabulary));
  const difficulty = (n1 / 2) * (N2 / n2);
  const effort = difficulty * volume;

  return {
    distinctOperators: n1,
    distinctOperands: n2,
    totalOperators: N1,
    totalOperands: N2,
    vocabulary,
    length,
    volume,
    difficulty,
    effort,
  };
}

/** Keyword cyclomatic complexity ≈ decision points + 1. */
export function keywordComplexity(source: string): number {
  if (!source) return 1;
  const text = stripNoise(source);
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\belif\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\bswitch\b/g,
    /\?/g,
    /&&/g,
    /\|\|/g,
  ];
  let decisions = 0;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) decisions += m.length;
  }
  return 1 + decisions;
}

/**
 * Simplified Cognitive Complexity (Sonar-inspired):
 * +1 per control structure / logical operator, plus nesting increments.
 */
export function computeCognitiveComplexity(source: string): number {
  const text = stripNoise(source);
  let score = 0;
  let nesting = 0;

  // Walk roughly by lines / braces for nesting.
  const lines = text.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const opens = (trimmed.match(/[{]/g) ?? []).length;
    const closes = (trimmed.match(/[}]/g) ?? []).length;

    const control =
      /\b(if|else\s+if|elif|for|while|switch|catch|except)\b/.test(trimmed);
    const logical = (trimmed.match(/&&|\|\||\?\?/g) ?? []).length;
    const ternary = (trimmed.match(/\?/g) ?? []).length;
    const elseOnly = /\belse\b/.test(trimmed) && !/\belse\s+if\b/.test(trimmed);

    if (control) {
      score += 1 + nesting;
    } else if (elseOnly) {
      score += 1;
    }
    score += logical;
    // Ternary: avoid counting `?` from typescript types `x?:` — already stripped `?:` somewhat
    if (ternary > 0 && !trimmed.includes("?:")) {
      score += ternary * (1 + nesting);
    }

    nesting = Math.max(0, nesting + opens - closes);
  }

  return score;
}

/**
 * Maintainability Index (0–100), Visual Studio / Radon style:
 * MI = max(0, (171 - 5.2*ln(V) - 0.23*CC - 16.2*ln(LOC)) * 100 / 171)
 */
export function maintainabilityIndex(
  halsteadVolume: number,
  cyclomatic: number,
  loc: number,
): number {
  const V = Math.max(1, halsteadVolume);
  const CC = Math.max(1, cyclomatic);
  const L = Math.max(1, loc);
  const raw =
    171 - 5.2 * Math.log(V) - 0.23 * CC - 16.2 * Math.log(L);
  const normalized = (raw * 100) / 171;
  return Math.max(0, Math.min(100, normalized));
}

export function abcMagnitude(
  assignments: number,
  branches: number,
  conditions: number,
): number {
  return Math.sqrt(
    assignments * assignments + branches * branches + conditions * conditions,
  );
}

/** Fitzpatrick ABC metric from source heuristics. */
export function computeAbc(source: string): AbcMetrics {
  const text = stripNoise(source);
  let assignments = 0;
  let branches = 0;
  let conditions = 0;

  // Assignments: '=' not part of ==, ===, !=, !==, <=, >=, =>, :=
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const prev = i > 0 ? text[i - 1]! : "";
    const next = i + 1 < text.length ? text[i + 1]! : "";
    if (
      (c === "+" || c === "-" || c === "*" || c === "/" || c === "%" ||
        c === "|" || c === "&" || c === "^") &&
      next === "="
    ) {
      assignments += 1;
      i += 1;
      continue;
    }
    if (c === "=" && next !== "=" && next !== ">" && prev !== "=" && prev !== "!" &&
      prev !== "<" && prev !== ">" && prev !== ":") {
      assignments += 1;
    }
  }

  // Branches ≈ calls + return/throw
  branches += (text.match(/\b(return|goto|throw|raise)\b/g) ?? []).length;
  const callRe =
    /\b(?!(?:if|for|while|switch|catch|elif|elseif|function|fn|def|class|new|typeof|sizeof|return|throw|raise)\b)[A-Za-z_$][\w$]*\s*\(/g;
  branches += (text.match(callRe) ?? []).length;

  conditions += (
    text.match(/\b(if|elif|case|while|for|catch|except)\b/g) ?? []
  ).length;
  conditions += (text.match(/&&|\|\||\?/g) ?? []).length;

  return {
    assignments,
    branches,
    conditions,
    magnitude: abcMagnitude(assignments, branches, conditions),
  };
}

/**
 * Depth of Inheritance — max local inheritance depth in the file.
 * Counts `extends` / Python bases / Java `extends` chains declared here (not cross-file).
 */
export function depthOfInheritance(source: string): number {
  const text = stripNoise(source);
  let maxDepth = 0;

  // TS/JS/Java/Kotlin/C#: class Foo extends Bar
  for (const m of text.matchAll(
    /\b(?:class|interface)\s+[A-Za-z_]\w*\s+extends\s+([A-Za-z_][\w.]*)/g,
  )) {
    // Local declaration depth is at least 1 (has a parent). Cross-file chain unknown → 1+.
    void m;
    maxDepth = Math.max(maxDepth, 1);
  }

  // class Foo extends Bar implements ...
  // Already covered by extends.

  // Python: class Foo(Bar, Baz):
  for (const m of text.matchAll(
    /\bclass\s+[A-Za-z_]\w*\s*\(([^)]*)\)\s*:/g,
  )) {
    const bases = m[1]!
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "object" && !s.startsWith("metaclass"));
    if (bases.length > 0) maxDepth = Math.max(maxDepth, 1);
  }

  // Rust: struct Foo { } impl doesn't inherit; trait Foo: Bar
  for (const m of text.matchAll(/\btrait\s+[A-Za-z_]\w*\s*:\s*([^{]+)/g)) {
    const bases = m[1]!
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean);
    if (bases.length > 0) maxDepth = Math.max(maxDepth, 1);
  }

  // Nested class extends inside same file bump depth heuristically
  const extendsCount = (text.match(/\bextends\b/g) ?? []).length;
  if (extendsCount >= 2) maxDepth = Math.max(maxDepth, Math.min(extendsCount, 5));

  return maxDepth;
}

/** Analyze classic metrics from source text. */
export function analyzeSourceClassicMetrics(
  source: string,
  locHint?: number,
): SourceClassicMetrics {
  const loc =
    locHint && locHint > 0
      ? locHint
      : Math.max(1, source.split(/\n/).length);
  const halstead = computeHalstead(source);
  const cyclomaticComplexity = keywordComplexity(source);
  const cognitiveComplexity = computeCognitiveComplexity(source);
  const mi = maintainabilityIndex(
    halstead.volume,
    cyclomaticComplexity,
    loc,
  );
  return {
    halstead,
    cognitiveComplexity,
    maintainabilityIndex: mi,
    depthOfInheritance: depthOfInheritance(source),
    cyclomaticComplexity,
    abc: computeAbc(source),
  };
}

/** Hierarchy-only CBO: unique imported files + files reached via symbol edges. */
export function couplingBetweenObjects(
  filePath: string,
  fileImports: Record<string, string[]>,
  symbols: Record<
    string,
    Array<{ id: string; file: string }>
  >,
  symbolEdges: Array<{ source: string; target: string }>,
): number {
  const coupled = new Set<string>();
  for (const t of fileImports[filePath] ?? []) {
    if (t && t !== filePath) coupled.add(t);
  }

  const symbolFile = new Map<string, string>();
  for (const [file, list] of Object.entries(symbols)) {
    for (const s of list) {
      symbolFile.set(s.id, s.file || file);
    }
  }

  const local = new Set((symbols[filePath] ?? []).map((s) => s.id));
  for (const edge of symbolEdges) {
    const fromLocal = local.has(edge.source);
    const toLocal = local.has(edge.target);
    if (fromLocal === toLocal) continue;
    const otherId = fromLocal ? edge.target : edge.source;
    const otherFile = symbolFile.get(otherId);
    if (otherFile && otherFile !== filePath) coupled.add(otherFile);
  }

  return coupled.size;
}
