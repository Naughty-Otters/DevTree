
# XSS Prevention

Apply when UI renders project paths, analysis messages, rule text, LLM output, or HTML.

## Rules

- Prefer `textContent` / safe DOM APIs over `innerHTML`
- Never assign unsanitized user/LLM/project strings to HTML sinks
- Encode on output; validation alone is not enough
- Avoid `javascript:` URLs and untrusted `href`/`src`
- Be careful with template literals that build HTML in panels/dialogs
- If markdown/HTML from AI is shown, sanitize or render as plain text by default

## Examples

```typescript
// ❌ BAD
el.innerHTML = `<span>${filePath}</span>`;

// ✅ GOOD
el.textContent = filePath;
// or createElement + textContent
```

## Severity

- 🔴 Untrusted data into HTML/JS sinks
- 🟡 Risky sink with partially trusted data
- 🟢 Hardening (CSP notes, defense in depth)
