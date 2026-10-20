# JCode

**A calmer, more organized code editor, built on [Code - OSS](https://github.com/microsoft/vscode).**

JCode keeps everything you know from VS Code (extensions, settings, keyboard shortcuts) and adds the tools that keep a busy workspace tidy: tab groups, vertical tabs, workspace colors, bookmarks, and built-in SSH/SFTP.

> JCode is independently maintained and is not affiliated with or endorsed by Microsoft.

## Contents

- [Highlights](#highlights)
- [Install](#install)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Updating and uninstalling](#updating-and-uninstalling)
- [Getting started](#getting-started)
- [Features](#features)
  - [Tab groups](#tab-groups)
  - [Auto-grouping rules](#auto-grouping-rules)
  - [Tab sessions and search](#tab-sessions-and-search)
  - [Vertical tabs](#vertical-tabs)
  - [Workspace colors](#workspace-colors)
  - [Bookmarks](#bookmarks)
  - [Remote files over SSH/SFTP](#remote-files-over-sshsftp)
  - [AI features](#ai-features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Tips](#tips)
- [Troubleshooting](#troubleshooting)
- [Build from source](#build-from-source)
- [Contributing and support](#contributing-and-support)
- [License](#license)

## Highlights

| | |
| --- | --- |
| 🗂️ **Tab groups** | Named, colored, collapsible groups of tabs, saved groups, and rules that group files for you. |
| 📚 **Sessions and search** | Save your whole tab layout and bring it back later; search every open tab at once. |
| ↔️ **Vertical tabs** | Tabs beside the editor, with a filter and a compact icon rail for narrow layouts. |
| 🎨 **Workspace colors** | Give each project its own color so you always know which window you are in. |
| 🔖 **Bookmarks** | Mark important lines, add notes and colors, and jump back from anywhere. |
| 🌐 **SSH/SFTP** | Open folders on remote servers right in the Explorer. |
| 🧭 **Personalization** | One friendly page for the choices that matter most. |
| 🔕 **AI off by default** | Chat and inline suggestions stay hidden until you turn them on. |

## Install

Download the latest version from **[GitHub Releases](https://github.com/Jchnc/jcode/releases)**.

| Platform | Download | Architectures |
| --- | --- | --- |
| Windows | `.exe` installer (per user, no admin needed) | x64 |
| macOS | `.zip` containing `JCode.app` | Apple Silicon (arm64), Intel (x64) |
| Linux | `.deb` package or `.tar.gz` archive | x64, arm64 |

### Windows

1. Download `JCodeSetup-x64-<version>.exe` and run it.
2. Keep **Add to PATH** checked so you can open folders from a terminal.
3. Open a **new** terminal and run `jcode .` in any folder.

If Windows SmartScreen warns about an unrecognized app, choose **More info** > **Run anyway**.

### macOS

1. Download the `.zip` for your Mac: `arm64` for Apple Silicon (M1 and newer) or `x64` for Intel.
2. Unzip it and drag **JCode.app** into **Applications**.
3. Open JCode. If macOS says it cannot be opened, see [Troubleshooting](#troubleshooting).
4. To use the `jcode` command, open the Command Palette (`Cmd+Shift+P`), run **Shell Command: Install 'jcode' command in PATH**, and open a new terminal.

### Linux

**Debian and Ubuntu:** install with one command. It picks the right package for your machine, verifies it, and adds the `jcode` command.

```sh
curl -fsSL https://jchnc.github.io/jcode/install.sh | bash
```

To install a specific version, add `-s -- --version 1.2.3` after `bash`.

<details>
<summary>Install the .deb manually</summary>

Download `JCode-linux-<x64|arm64>-<version>.deb` and run:

```sh
sudo apt install ./JCode-linux-x64-<version>.deb
```

</details>

<details>
<summary>Other distributions (.tar.gz)</summary>

Extract the archive into a folder of its own and link the command onto your PATH:

```sh
mkdir -p ~/.local/share/jcode ~/.local/bin
tar -xzf JCode-linux-x64-<version>.tar.gz -C ~/.local/share/jcode
ln -sf ~/.local/share/jcode/bin/jcode ~/.local/bin/jcode
```

Make sure `~/.local/bin` is on your PATH.

</details>

### Updating and uninstalling

| Platform | Update | Uninstall |
| --- | --- | --- |
| Windows | JCode downloads and installs updates for you. | **Settings** > **Apps** > **JCode** > **Uninstall** |
| macOS | JCode tells you when an update is ready. Download it and replace `JCode.app`. | Move `JCode.app` to the Trash. |
| Linux (Debian/Ubuntu) | Run the install command again. | `sudo apt remove jcode` |
| Linux (.tar.gz) | Replace the extracted folder with the new version. | Delete the folder and the `~/.local/bin/jcode` link. |

## Getting started

- **Open a project from a terminal:** `jcode .` opens the current folder, and `jcode <file>` opens a file. Running it again reuses the open window.
- **Make it yours:** run **Preferences: Personalize JCode** from the Command Palette (`Ctrl+Shift+P`, or `Cmd+Shift+P` on macOS), or use the gear menu. It covers the theme, workspace color, tab style and position, tab groups, auto-grouping rules, and layout.
- **Coming from VS Code?** Your favorite extensions install from the Extensions view, which uses the [Open VSX](https://open-vsx.org) marketplace. JCode keeps its settings separate from VS Code, so the two can be installed side by side.

## Features

> JCode shortcuts use `Shift+Alt` (`Shift+Option` on macOS). See [Keyboard shortcuts](#keyboard-shortcuts).

### Tab groups

Keep related files together in named, colored groups, like tab groups in a browser.

- **Create one:** right-click a tab and choose **Add to New Tab Group**. Select several tabs first to group them together.
- **Add tabs:** use **Move to Tab Group…** or drag a tab onto the group's header.
- **Collapse:** click the group header. The tab you are working in stays visible.
- **Customize:** right-click the header to rename it, pick a color or icon, save, lock, close, or ungroup it.
- **Save for later:** choose **Save Group** in the header menu. Closed saved groups come back with **View: Show Saved Tab Groups…**.

Good to know:

- Tabs in a group stay next to each other and are pinned automatically.
- New files open next to the group, not inside it. To have them join the group you are working in, turn on **Open in Active Group** in Settings (`workbench.editor.tabGroups.openInActiveGroup`).
- A **locked** group keeps its tabs exactly as they are.

### Auto-grouping rules

Let JCode sort files into groups as you open them. Open **Personalize JCode** > **Auto-grouping** and add a rule with a group name and the files it covers:

- A folder: `src/components` (everything inside it, subfolders included)
- A pattern: `**/*.test.ts` (all test files)

Rules apply to the tabs you already have open and to every file you open afterwards. The first matching rule wins, and a tab you remove from a group stays out of it.

<details>
<summary>Prefer settings.json?</summary>

```json
{
	"workbench.editor.tabGroups.autoGroupRules": [
		{ "name": "Components", "pattern": "src/components", "color": "yellow" },
		{ "name": "Tests", "pattern": "**/*.test.ts", "color": "teal", "icon": "beaker" }
	]
}
```

</details>

### Tab sessions and search

- **Save a session:** **View: Save Tab Session…** remembers your editor groups, tabs, and tab groups under a name.
- **Restore it:** **View: Open Tab Session…** brings them back. Unsaved changes are never lost.
- **Search tabs:** **View: Search Open Tabs…** (`Shift+Alt+T`) finds any open tab across all editor groups, plus your saved groups.

Sessions are stored per workspace on your device.

### Vertical tabs

Move the tabs beside the editor. On the Personalization page set **Tab position** to **Left** or **Right**, or use this setting:

```json
{
	"workbench.editor.tabPosition": "left"
}
```

- Drag the edge of the strip to resize it; double-click the edge to reset.
- Select **Filter Tabs** in the strip's toolbar to filter tabs by name or path.
- In a narrow editor group, the strip shrinks to a compact rail of file icons.

### Workspace colors

Tell windows apart at a glance. Run **Preferences: Workspace Color...**, pick a color, choose **Subtle** or **Rich**, and select **Apply**. The color tints the title bar and status bar of that workspace only.

Remote SSH/SFTP workspaces get a color automatically. Turn that off on the Personalization page.

### Bookmarks

- **Toggle a bookmark:** `Shift+Alt+B`, or Alt+click the margin next to the line numbers.
- **Jump to one:** **Go to Bookmark...** (`Shift+Alt+L`) searches by note, file, or color. `Shift+Alt+J` and `Shift+Alt+K` step through bookmarks.
- **Organize:** add notes with **Bookmark with Note...** and color tags from the list. The **Bookmarks** view in the Explorer shows them all.

Bookmarks follow their line as you edit. If the line is deleted, the bookmark is marked stale so you can relocate or remove it.

### Remote files over SSH/SFTP

Open a folder on a server and edit it like a local one.

1. Open the **Remote** view, or run **JCode Remote: Manage SSH/SFTP Connections...**.
2. Create a connection (password, private key, or SSH agent), or import hosts with **JCode Remote: Import Connections from SSH Config...**.
3. Choose the remote folder and select **Save and Connect**.

The status bar shows the connection state; select it to reconnect or edit the connection. Jump hosts (like `ssh -J`) are supported. Remote terminals and language servers are not; JCode edits remote files over SFTP. See the [SSH/SFTP guide](extensions/jcode-sftp/README.md) for details.

### AI features

Chat, inline suggestions, and the Copilot sign-in are **off by default**. To turn them on, open Settings and clear **Chat: Disable AI Features**, or set:

```json
{
	"chat.disableAIFeatures": false
}
```

## Keyboard shortcuts

Every JCode shortcut is a single press of **Shift+Alt** plus a letter (**Shift+Option** on macOS). They are free on Windows, Linux, and macOS, so they never override another command.

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Search open tabs | `Shift+Alt+T` | `Shift+Option+T` |
| New tab group from selected tabs | `Shift+Alt+G` | `Shift+Option+G` |
| Collapse or expand the tab group | `Shift+Alt+E` | `Shift+Option+E` |
| Next / previous tab group | `Shift+Alt+N` / `Shift+Alt+P` | `Shift+Option+N` / `Shift+Option+P` |
| Close the tab group | `Shift+Alt+W` | `Shift+Option+W` |
| Toggle bookmark | `Shift+Alt+B` | `Shift+Option+B` |
| Bookmark list | `Shift+Alt+L` | `Shift+Option+L` |
| Next / previous bookmark | `Shift+Alt+J` / `Shift+Alt+K` | `Shift+Option+J` / `Shift+Option+K` |

On macOS, `Shift+Option` with a letter normally types a special character (such as `` for `Shift+Option+K`); in JCode these keys run the shortcuts instead.

`Ctrl+F` (`Cmd+F` on macOS) always searches your code. To change a shortcut, open **Preferences: Open Keyboard Shortcuts** and search for the command.

Find every other JCode command in the Command Palette by typing **Tab Group**, **Tab Session**, **Bookmark**, or **JCode Remote**.

## Tips

- **One project per color.** Give your main projects distinct workspace colors; switching windows becomes effortless.
- **Let rules do the sorting.** A couple of auto-grouping rules (for example `src/components` and `**/*.test.ts`) keep large projects tidy with zero effort.
- **Sessions for context switches.** Save a session before jumping to another task, and restore it when you come back.
- **Vertical tabs on wide screens.** With many files open, vertical tabs show full names instead of squeezed ones.
- **Notes on bookmarks.** A short note ("fix after release") turns bookmarks into a lightweight to-do list.

## Troubleshooting

<details>
<summary><b>macOS: "JCode can't be opened" or "is damaged"</b></summary>

Builds that are not notarized by Apple are blocked the first time. Right-click **JCode.app** in Applications, choose **Open**, then **Open** again. If macOS still refuses, run:

```sh
xattr -dr com.apple.quarantine /Applications/JCode.app
```

</details>

<details>
<summary><b>Windows: SmartScreen blocks the installer</b></summary>

Choose **More info** > **Run anyway**. SmartScreen warns about apps it has not seen often yet.

</details>

<details>
<summary><b>The <code>jcode</code> command is not found</b></summary>

- **Windows:** reinstall with **Add to PATH** checked, then open a new terminal.
- **macOS:** run **Shell Command: Install 'jcode' command in PATH** from the Command Palette, then open a new terminal.
- **Linux:** the `.deb` installs `/usr/bin/jcode`. For the `.tar.gz`, check that `~/.local/bin` is on your PATH.

</details>

<details>
<summary><b>Linux on WSL asks to install the Windows version</b></summary>

Inside WSL, install JCode on Windows instead and run `jcode .` from your WSL terminal; it opens the folder in Windows JCode.

</details>

<details>
<summary><b>I want AI features back</b></summary>

See [AI features](#ai-features).

</details>

## Build from source

You need Git, the Node.js version in [`.nvmrc`](.nvmrc), and your platform's build tools:

| Platform | Build tools |
| --- | --- |
| Windows | Visual Studio Build Tools with **Desktop development with C++**, and Python 3 |
| macOS | Xcode Command Line Tools (`xcode-select --install`) and Python 3 |
| Linux | `build-essential`, `pkg-config`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev`, `libkrb5-dev`, and Python 3 |

```sh
git clone --branch custom/main https://github.com/Jchnc/jcode.git
cd jcode
npm run install-fast
npm run build-fast
```

Then start the development build, which runs as **JCode Dev** with its own settings:

```sh
./scripts/code.sh      # macOS and Linux
.\scripts\code.bat     # Windows
```

More for maintainers: [releases and updates](docs/jcode-releases.md), [keeping JCode in sync with upstream](docs/upstream-sync.md), and the [upstream contribution guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute) for detailed prerequisites.

## Contributing and support

- **Bugs, questions, and ideas:** [open an issue](https://github.com/Jchnc/jcode/issues).
- **Pull requests:** target `custom/main`; see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Security issues:** report them privately through [GitHub security advisories](https://github.com/Jchnc/jcode/security/advisories/new); see [SECURITY.md](SECURITY.md).

## License

JCode is available under the [MIT License](LICENSE.txt) and keeps Microsoft's Code - OSS copyright and license notices. Upstream and third-party work remains credited to its authors; see the [third-party notices](ThirdPartyNotices.txt) and [licensing and distribution](docs/LICENSING.md).

Visual Studio Code and the Microsoft logos are trademarks of their respective owners.
