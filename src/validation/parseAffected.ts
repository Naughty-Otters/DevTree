export interface ValidationAffectedEntry {
  raw: string;
  file: string;
  line?: number;
  severity?: string;
  message?: string;
}

/** Parse backend `affected` strings (paths, `path:line — msg`, linter/LSP formats). */
export function parseAffectedEntry(raw: string): ValidationAffectedEntry {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw, file: trimmed };
  }

  // path:line — [severity] message  (linter)
  const linterMatch = trimmed.match(
    /^(.+?):(\d+)\s+—\s+(?:\[(\w+)\]\s+)?(.+)$/,
  );
  if (linterMatch) {
    return {
      raw: trimmed,
      file: linterMatch[1],
      line: Number.parseInt(linterMatch[2], 10),
      severity: linterMatch[3],
      message: linterMatch[4],
    };
  }

  // path:line — message  (LSP / generic)
  const locMatch = trimmed.match(/^(.+?):(\d+)\s+—\s+(.+)$/);
  if (locMatch) {
    return {
      raw: trimmed,
      file: locMatch[1],
      line: Number.parseInt(locMatch[2], 10),
      message: locMatch[3],
    };
  }

  // path:line:col: message (flake8-style) or path:line
  const colonParts = trimmed.split(":");
  if (colonParts.length >= 2) {
    const maybeLine = Number.parseInt(colonParts[1], 10);
    if (!Number.isNaN(maybeLine) && colonParts[0].includes("/")) {
      const file = colonParts[0];
      const rest = colonParts.slice(2).join(":").trim();
      return {
        raw: trimmed,
        file,
        line: maybeLine,
        message: rest || undefined,
      };
    }
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
        for (const file of parts) {
          out.push({
            raw,
            file,
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
