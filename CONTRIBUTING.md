# Contributing to Grammarly for Obsidian

This project is open to the community. The plugin connects to Grammarly's WebSocket API, displays suggestions as wavy underlines, and can apply replacements on click. The two problems that remain unsolved after significant effort are described below. If you can crack either one, this plugin becomes genuinely useful.

## What the project needs most

### 1. Apply corrupts the document text

When you click the Apply button in the tooltip, the replacement text gets inserted incorrectly. It merges into the surrounding word instead of replacing the original range cleanly. For example, clicking Apply on a suggestion turns `"hopefully to improve"` into `"hopefullyprove"`. The original text is partially deleted but the boundaries are wrong, so the replacement fuses with whatever character is adjacent.

The apply logic is in `GrammarlyTooltip.ts` (`getLivePos()` and the `view.dispatch()` call). The replacement positions come from `GrammarlyExtension.getPosForAlert()`, which reads from the `DecorationSet`. The positions look correct at hover time but appear to be off-by-one or misaligned at the moment of dispatch.

### 2. Underlines land on the wrong words

Grammarly returns alert positions in the coordinate space of the plain text it received (after Markdown syntax is stripped). `MarkdownStripper.ts` builds a `grammarlyToOrig` array that maps those positions back to CM6 document positions. This mapping works for simple prose but breaks for some documents. Underlines appear on the wrong word, sometimes several words away from the actual issue.

The mapping strips YAML frontmatter, ATX headings (`# ## ###`), unordered list markers (`- * +`), ordered list markers (`1. 2.`), and blockquotes (`>`). It does **not** strip inline Markdown (bold `**`, italic `*`, wikilinks `[[...]]`, inline `code`). Any document that mixes these with plain prose will accumulate position drift.

Other areas where contributions would help:
- Automatic session refresh when the `grauth` token expires
- Coverage for inline Markdown in `MarkdownStripper.ts`
- Test coverage for the position mapping logic

## How to contribute

1. Fork the repository
2. Create a branch for your change (`git checkout -b fix/apply-position-bug`)
3. Make your changes inside `grammarly-plugin/`
4. Test by building (`npm run build` inside `grammarly-plugin/`) and copying the output to your Obsidian vault
5. Open a pull request with a clear description of what you changed and why

## Building and testing

```bash
cd grammarly-plugin
npm install
npm run dev     # watch mode | rebuilds on save
npm run build   # production build
```

Copy `main.js`, `styles.css`, and `manifest.json` into `.obsidian/plugins/grammarly-plugin/` in your test vault, then reload Obsidian.

## Code style

The project uses TypeScript with strict mode. No linter is configured yet | contributions that add one are welcome. Match the style of the surrounding code.

## Reporting bugs

Open a GitHub issue. Include your Obsidian version, your operating system, and the steps to reproduce. If you see errors in the developer console (Ctrl+Shift+I), include those too.
