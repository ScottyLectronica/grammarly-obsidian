# Grammarly for Obsidian

Unofficial Grammarly integration for Obsidian. Get real-time grammar, spelling, clarity, and style suggestions directly in your notes | no copy-pasting required.

**Desktop only.** Requires a free or premium Grammarly account.

---

## Features

- **Live suggestions** as you type, powered by the same engine as Grammarly's browser extension
- **Color-coded wavy underlines** by category | orange for grammar, teal for clarity, purple for style
- **Rich tooltips** showing the category, an inline diff of the suggested change, and a one-click Apply button
- **Per-note sessions** | each note has its own Grammarly session; switching notes shows cached suggestions instantly
- **Persistent dismissals** | dismissed suggestions are remembered per note and won't reappear on reconnect
- **Free and Premium** | works with whatever your Grammarly account is entitled to

---

## Installation

### From Obsidian Community Plugins *(when listed)*

Settings → Community Plugins → Browse → search "Grammarly" → Install → Enable

### Manual installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases/latest)
2. Create a folder called `grammarly-plugin` inside your vault's `.obsidian/plugins/` directory
3. Copy the three downloaded files into that folder
4. In Obsidian: Settings → Community Plugins → enable **Grammarly**

---

## Setup

1. Open the Command Palette (`Ctrl/Cmd + P`) and run **Grammarly: Login to Grammarly**
2. Sign in to your Grammarly account in the window that opens
3. The plugin authenticates automatically | suggestions will begin appearing as you write

To manually reconnect after a token expiry, run **Grammarly: Connect to Grammarly** from the Command Palette.

---

## Commands

| Command | Description |
|---|---|
| Login to Grammarly | Opens the authentication window |
| Connect to Grammarly | Reconnects the active note's session |
| Clear dismissed suggestions for this note | Restores all suggestions you have dismissed in the current note |

---

## Settings

**Account** | shows login status; button to switch accounts.

**Clear all dismissed suggestions** | restores every suggestion dismissed across all notes.

---

## How it works

The plugin connects to Grammarly's API over WebSocket and uses CodeMirror 6's `ChangeSet` to send precise operational transforms (retain/insert/delete) as you type. Each note maintains its own session; up to 5 notes can be live simultaneously, with older idle sessions paused automatically.

---

## Limitations

- Desktop only (requires Node.js WebSocket support)
- Uses Grammarly's unofficial API | may break if Grammarly changes their protocol
- The grauth session token expires periodically; re-login when suggestions stop appearing

---

## License

MIT
