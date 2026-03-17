# Grammarly for Obsidian

This is an Obsidian plugin that provides real-time Grammarly suggestions inside the Obsidian editor.  It was really hard to make, many people before me have tried and failed.  I got it to ALMOST work, but I got stuck at the very last part.  I was going to throw it out, but then I remembered I could just make it open-source, and invite other people to take a look at it and fix it.  It is ALMOST there.  Someone with a bigger brain than me is going to take it that extra few feet past the finish line.  This plug-in works with free and Premium Grammarly accounts and you don't have to enter an API key or anything annoying like that.  You just sign in and you get exactly the suggestions your subscription includes.

> **Community project.** This plugin is functional but unfinished. The biggest outstanding problem is that premium suggestions do not yet work reliably for all paid subscribers. The core plugin works | login, underlines, tooltips, apply/dismiss | but the premium authentication path needs community expertise to crack. See [CONTRIBUTING.md](CONTRIBUTING.md) if you want to help.

- Color-coded wavy underlines (spelling, grammar, clarity, style)
- Hover over any underline to see the suggestion and apply it with one click
- Suggestions update as you type
- Works in Live Preview mode

> **Desktop only.** Requires the Obsidian desktop app (Windows, macOS, Linux). Does not work on mobile.

---

## Installation

Until this plugin is listed in the Obsidian Community Plugins browser, you install it manually. It takes about two minutes.

### Step 1 | Download the files

Go to the [latest release](https://github.com/ScottyLectronica/grammarly-obsidian/releases/latest) and download these three files:

- `main.js`
- `manifest.json`
- `styles.css`

### Step 2 | Find your vault's plugin folder

Open your vault folder on your computer. Inside it there is a hidden folder called `.obsidian`. Inside that is a folder called `plugins`.

**On Windows**, hidden folders are invisible by default. To show them:
1. Open File Explorer
2. Click **View** in the top menu
3. Check **Hidden items**

The full path looks like: `C:\Users\YourName\Documents\YourVault\.obsidian\plugins\`

### Step 3 | Create the plugin folder

Inside the `plugins` folder, create a new folder named exactly:

```
grammarly-plugin
```

### Step 4 | Copy the files

Move the three files you downloaded (`main.js`, `manifest.json`, `styles.css`) into the `grammarly-plugin` folder.

### Step 5 | Enable the plugin in Obsidian

1. Open Obsidian
2. Go to **Settings** (gear icon)
3. Click **Community Plugins** in the left sidebar
4. If you see a "Safe mode" warning, click **Turn on community plugins**
5. Scroll down to find **Grammarly** and toggle it on

---

## Login

After enabling the plugin, connect your Grammarly account:

1. Press **Ctrl+P** (or Cmd+P on Mac) to open the command palette
2. Type **Login to Grammarly** and press Enter
3. A login window opens | sign in with your Grammarly account
4. When the Grammarly dashboard appears, the plugin captures your session automatically
5. You will see a "Grammarly connected!" message

The status bar at the bottom of Obsidian shows the connection state:
- `Grammarly ○` | not connected
- `Grammarly ◌` | analysing
- `Grammarly ●` | suggestions ready

---

## Usage

Open any note. Grammarly analyses it automatically. Hover over any wavy underline to see the suggestion. Click **Apply** to accept it or **✕** to dismiss it permanently for that note.

To re-analyse a note from scratch: **Ctrl+P** → **Re-analyse with Grammarly**

To restore dismissed suggestions: **Ctrl+P** → **Clear dismissed Grammarly suggestions for this note**

---

## Requirements

- Obsidian 0.15.0 or later (desktop app)
- A Grammarly account (free or Premium)

---

## Author

Christopher E. Scott | [GitHub](https://github.com/ScottyLectronica)
