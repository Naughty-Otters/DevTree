export interface ValidationAffectedEntry {
  raw: string;
  file: string;
  line?: number;
  severity?: string;
  message?: string;
}

export interface PathLocation {
  file: string;
  line?: number;
  lineEnd?: number;
}

/** Whether an affected entry looks like a project-relative file path. */
export function isOpenableValidationPath(path: string): boolean {
  const trimmed = splitPathAndLocation(path).file.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("```") ||
    trimmed.includes("\n") ||
    trimmed.includes("\"items\"")
  ) {
    return false;
  }
  return trimmed.includes("/") || trimmed.includes(".");
}

function looksLikeFilePath(path: string): boolean {
  return isOpenableValidationPath(path);
}

function isWindowsDrivePrefix(path: string): boolean {
  return path.length === 1 && /^[A-Za-z]$/.test(path);
}

function parseLineToken(token: string): { start: number; end: number } | null {
  if (!token) return null;
  const rangeMatch = token.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    let start = Number.parseInt(rangeMatch[1], 10);
    let end = Number.parseInt(rangeMatch[2], 10);
    if (start === 0 || end === 0) return null;
    if (start > end) [start, end] = [end, start];
    return { start, end };
  }
  const single = token.match(/^(\d+)$/);
  if (!single) return null;
  const start = Number.parseInt(single[1], 10);
  if (start === 0) return null;
  return { start, end: start };
}

/**
 * Strip editor-style location suffixes from a project-relative path.
 * Mirrors Rust `split_path_and_location`.
 */
export function splitPathAndLocation(input: string): PathLocation {
  const trimmed = input.trim();
  if (!trimmed) return { file: "" };

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0) {
    const afterLast = trimmed.slice(lastColon + 1);
    if (/^\d+$/.test(afterLast)) {
      const beforeLast = trimmed.slice(0, lastColon);
      const secondColon = beforeLast.lastIndexOf(":");
      if (secondColon > 0) {
        const pathPart = beforeLast.slice(0, secondColon);
        const linePart = beforeLast.slice(secondColon + 1);
        const range = parseLineToken(linePart);
        if (range && pathPart.includes("/") && !isWindowsDrivePrefix(pathPart)) {
          return { file: pathPart, line: range.start, lineEnd: range.end };
        }
      }
    }
  }

  if (lastColon > 0) {
    const pathPart = trimmed.slice(0, lastColon);
    const rest = trimmed.slice(lastColon + 1);
    const range = parseLineToken(rest);
    if (range && pathPart.includes("/") && !isWindowsDrivePrefix(pathPart)) {
      return { file: pathPart, line: range.start, lineEnd: range.end };
    }
  }

  return { file: trimmed };
}

/** Parse backend `affected` strings (paths, `path:line — msg`, linter/LSP formats). */
export function parseAffectedEntry(raw: string): ValidationAffectedEntry {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw, file: trimmed };
  }

  if (!looksLikeFilePath(trimmed) && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return { raw: trimmed, file: trimmed, message: trimmed };
  }

  // path:line:col: message (flake8-style)
  const flake8Match = trimmed.match(/^(.+?):(\d+):(\d+):\s*(.+)$/);
  if (flake8Match && looksLikeFilePath(flake8Match[1])) {
    return {
      raw: trimmed,
      file: flake8Match[1],
      line: Number.parseInt(flake8Match[2], 10),
      message: flake8Match[4].trim(),
    };
  }

  // path[:line] — [severity] message | path[:line] — message
  const dashMatch = trimmed.match(/^(.+?)\s+[—–]\s+(?:\[(\w+)\]\s+)?(.+)$/);
  if (dashMatch) {
    const loc = splitPathAndLocation(dashMatch[1].trim());
    if (looksLikeFilePath(loc.file)) {
      return {
        raw: trimmed,
        file: loc.file,
        line: loc.line,
        severity: dashMatch[2],
        message: dashMatch[3].trim(),
      };
    }
  }

  const loc = splitPathAndLocation(trimmed);
  if (looksLikeFilePath(loc.file) && (loc.line != null || loc.file !== trimmed)) {
    return {
      raw: trimmed,
      file: loc.file,
      line: loc.line,
    };
  }

  if (looksLikeFilePath(trimmed)) {
    return { raw: trimmed, file: trimmed };
  }

  return { raw: trimmed, file: trimmed, message: trimmed };
}

/** Expand circular-dependency affected lines into per-file entries when possible. */
export function expandAffectedForDisplay(
  affected: string[],
): ValidationAffectedEntry[] {
  const out: ValidationAffectedEntry[] = [];
  for (const raw of affected) {
    const trimmed = raw.trim();
    const cycleMatch = trimmed.match(/^\[[^\]]+\]\s+(.+)$/);
    if (cycleMatch) {
      const body = cycleMatch[1];
      if (body.includes("strongly connected group")) {
        out.push(parseAffectedEntry(raw));
        continue;
      }
      const parts = body
        .split("→")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        for (const part of parts) {
          const loc = splitPathAndLocation(part);
          out.push({
            raw,
            file: loc.file,
            line: loc.line,
            message: "Part of import cycle",
          });
        }
        continue;
      }
    }
    out.push(parseAffectedEntry(raw));
  }
  return out;
}

export function groupAffectedByFile(
  affected: string[],
): Map<string, ValidationAffectedEntry[]> {
  const groups = new Map<string, ValidationAffectedEntry[]>();
  for (const entry of expandAffectedForDisplay(affected)) {
    const file = entry.file || entry.raw;
    const list = groups.get(file) ?? [];
    list.push(entry);
    groups.set(file, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }
  return new Map(
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}
