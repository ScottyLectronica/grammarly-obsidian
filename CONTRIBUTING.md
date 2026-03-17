# Contributing to Grammarly for Obsidian

This project is open to the community. The core plugin works | it connects to Grammarly's WebSocket API, displays suggestions as wavy underlines, and lets you apply or dismiss them. The outstanding challenge that nobody has cracked yet is getting the plugin to consistently deliver premium suggestions to paid Grammarly subscribers.

If you can help solve that, or improve anything else, contributions are very welcome.

## What the project needs most

**Premium authentication** | The plugin captures the `grauth` and `csrf-token` session cookies after the user logs in and sends them with each WebSocket connection to `wss://capi.grammarly.com/freews`. Premium subscribers log in successfully but may still receive only free-tier suggestions. If you know how Grammarly's official browser extension establishes a premium session (different endpoint, different handshake, additional headers), that knowledge would be transformative.

Other areas where contributions would help:
- Automatic session refresh when the `grauth` token expires
- Support for additional Markdown syntax in the position mapper (`MarkdownStripper.ts`)
- Inline-suggestion UI (show replacement text directly in the editor without hover)
- Test coverage

## How to contribute

1. Fork the repository
2. Create a branch for your change (`git checkout -b fix/premium-endpoint`)
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
