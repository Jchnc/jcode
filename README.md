# JCode

JCode is a customized fork of [Code - OSS](https://github.com/microsoft/vscode), the open-source codebase behind Visual Studio Code. It adds tab groups with sessions and search, vertical tabs, workspace colors, a Personalization page, code bookmarks, and built-in SSH/SFTP file access while retaining the upstream editor and extension architecture.

**An independent editor, built on Code - OSS.** JCode is maintained in this repository and is not affiliated with or endorsed by Microsoft.

## Custom Features

| Feature | What it does |
| --- | --- |
| Tab groups | Organize tabs into named, colored groups with optional icons. Collapse, lock, move, save, and ungroup them, undo the last group change, add tabs to groups automatically with rules, and do it all from the keyboard. |
| Tab sessions | Save the editor groups, tabs, and tab groups of a workspace under a name and restore them later. |
| Tab search | Search open tabs and saved tab groups across editor groups, jump to one, or close tabs without leaving the list. |
| Vertical tabs | Place tabs to the left or right of the editor, resize the strip, filter it, and fall back to a compact icon rail in narrow editor groups. The traditional top layout is also available. |
| Workspace colors | Give each workspace a recognizable identity using preset or custom colors, with live previews and Subtle or Rich appearance. SFTP workspaces get a color automatically. |
| Personalization | A native page for the theme, workspace color, tabs, and layout choices that matter most, at user or workspace scope, with per-section reset. |
| Bookmarks | Bookmark lines with notes and color tags, find them from a quick pick or the Bookmarks view, and toggle them with Alt+click in the glyph margin. |
| SSH/SFTP workspaces | Browse and edit remote files in the Explorer, with saved connections, password/key/agent authentication, jump hosts, `~/.ssh/config` import, a connection status bar item, automatic reconnection, and encrypted profile export. |

### Tab Groups

Right-click an editor tab and choose **Add to New Tab Group**; select several tabs first to group them together. Use **Move to Tab Group…** to send tabs to an existing group, or drag tabs onto its header. Click a group header to collapse or expand it. The active editor stays visible when its group collapses. Right-click the header, or press Shift+F10 on it, to edit the group's name, color, or icon, add a new tab to the group, move the group into a new window, save or lock it, undo the last group change, close it, or ungroup its tabs.

Tab groups follow a few simple rules:

- A tab is pinned when it joins a group, and tabs pinned to the front (sticky tabs) never belong to a group.
- The tabs of a group always stay next to each other. **Move Editor Left** and **Move Editor Right** treat groups the way a browser does: a tab at the edge of its group first leaves it, a tab next to an unlocked group first joins it, and collapsed or locked groups are skipped as a whole.
- A newly opened editor opens after the group, not inside it. Turn on **Open in Active Group** (`workbench.editor.tabGroups.openInActiveGroup`) and an editor that opens while the active tab is in an unlocked group joins that group right after the active tab. Preview editors never join a group.
- A locked group keeps its tabs: it cannot be ungrouped or closed, and tabs cannot be added to or removed from it.

Choose **Save Group** in the header menu, or run **View: Save Tab Group**, to keep a group after it closes. When a saved group is closed, either with **Close Group** or by closing its last tab, JCode remembers it for the workspace. Reopen it with **View: Show Saved Tab Groups…**, with **Saved Tab Groups…** in the editor's **More Actions...** menu, or from Search Open Tabs. The saved groups list can rename groups, and deleting one offers **Undo**.

Add tabs to groups automatically with rules. Each rule has a `name`, a glob `pattern`, and an optional `color` (a preset color name such as `teal`, or a CSS color such as `#ff8800`) and `icon` (a codicon name). The first rule whose pattern matches the file of a newly opened tab adds it to the group with the rule's name in that editor group, creating the group when there is none. Relative patterns match the path of a file in its workspace folder, and absolute patterns match its full path. Rules leave preview editors, sticky tabs, tabs that are in a group already, locked groups, and tabs that you removed from a group alone.

```json
{
	"workbench.editor.tabGroups.enabled": true,
	"workbench.editor.tabGroups.openInActiveGroup": false,
	"workbench.editor.tabGroups.autoGroupRules": [
		{ "name": "Tests", "pattern": "**/*.test.ts", "color": "teal", "icon": "beaker" },
		{ "name": "Docs", "pattern": "docs/**", "color": "orange" }
	]
}
```

Shortcuts use `Ctrl` on Windows and Linux and `Cmd` on macOS:

| Command | Shortcut |
| --- | --- |
| New Tab Group from Selected Editors | `Ctrl+K G` |
| Toggle Collapse Active Tab Group | `Ctrl+K Ctrl+G` |
| Rename Active Tab Group | `Ctrl+K Ctrl+Shift+G` |
| Focus Next Tab Group | `Ctrl+K ]` |
| Focus Previous Tab Group | `Ctrl+K [` |
| Close Tab Group | `Ctrl+K X` |
| Search Open Tabs… | `Ctrl+K A` |
| Filter Tabs (while the vertical tabs have focus) | `Ctrl+F` |
| Toggle Bookmark (while the editor has focus) | `Ctrl+K B` |
| Go to Bookmark... | `Ctrl+K L` |

The other tab group commands, such as **View: Lock Tab Group**, **View: Ungroup Tabs**, and **View: Undo Last Tab Group Change**, are in the Command Palette without a default shortcut.

### Tab Sessions and Search

Run **View: Save Tab Session…** to save the editor groups, their layout, the tabs, and the tab groups of the current workspace under a name. Saving under an existing name replaces that session. **View: Open Tab Session…** lists sessions, newest first, with buttons to rename or delete them. Opening one replaces the open editors. JCode asks first when editors with unsaved changes are open, and those stay open so nothing is lost. Files that no longer exist are skipped, and untitled files are not saved. **View: Delete Tab Session…** removes a session. Sessions are stored for the workspace on the current device.

Run **View: Search Open Tabs…** (`Ctrl+K A`) to search the open tabs of the window by name or path. Tabs are listed by editor group and labeled with their tab group, and saved tab groups follow them. Pick a tab to go to it, which expands its group when it is collapsed, pick a saved group to reopen it, or use a tab's close button to close it without leaving the list.

### Vertical Tabs

Set the tab position to place the tabs beside the editor:

```json
{
	"workbench.editor.showTabs": "multiple",
	"workbench.editor.tabPosition": "left",
	"workbench.editor.verticalTabsWidth": 240
}
```

Use `"right"` or `"top"` for a different tab position. Drag the edge of the strip to resize it, between 140 and 500 pixels, and double-click the edge to restore the default. Vertical tabs work with or without `workbench.experimental.modernUI`, which gives the strip the floating-card look of the side bars. The strip is a single tab stop that you move through with the arrow keys, and tab groups appear in it as collapsible headers.

An editor group that is too narrow for the labeled strip and the editor shrinks the strip to a compact rail that shows file icons only, and it grows back when there is room.

Select **Filter Tabs** in the strip's toolbar, or press `Ctrl+F` while the strip has focus, to filter the tabs by name or path. Matches are highlighted, matching tabs of collapsed groups are listed without expanding the groups, and `Escape` closes the filter. The compact rail has no room for the filter.

### Workspace Colors

Open a folder or workspace and run **Preferences: Workspace Color...** from the Command Palette, choose it from the **View** > **Appearance** menu, or select the color marker in the title bar once the workspace has a color. Choose a preset or hex color, preview **Subtle** or **Rich**, then select **Apply**. **Cancel** restores the previous appearance; **Use Theme Color** clears the workspace color.

Colors are saved for that workspace on the current device. Explicit theme color customizations take precedence over workspace colors, and high-contrast themes retain their accessible surfaces.

A workspace whose folders are all on SSH/SFTP connections gets a color of its own automatically, so remote windows are easy to recognize. The color follows the connection, is never the neutral Graphite, and stays until you choose a color or **Use Theme Color**. Turn it off in your user settings, or from the Personalization page:

```json
{
	"workbench.workspaceColor.autoRemote": false
}
```

### Personalization

Run **Preferences: Personalize JCode** from the Command Palette, or choose **Personalize JCode** in the Manage (gear) menu or the **Preferences** menu. The page opens as an editor with these sections:

- **Appearance** opens the color theme and file icon theme pickers.
- **Workspace color** sets the workspace color, a custom hex color, and its intensity, and turns automatic remote colors on or off.
- **Editor tabs** sets the tab position, the vertical tab width, tab groups, and breadcrumbs.
- **Workbench layout** sets the primary sidebar side, the activity bar position, and the interface density when `workbench.experimental.modernUI` is on.

Choose **User** or **Workspace** scope in the sidebar to decide where a change is saved. Each section has **Reset to Defaults**, which offers **Undo**, and **Open All Settings** is at the bottom of the page.

### Bookmarks

Bookmark a line to return to it from anywhere in the workspace. Run **Toggle Bookmark** (`Ctrl+K B`), use the editor or line number context menu, or Alt+click the glyph margin. Alt+click is controlled by `jcode.bookmarks.toggleOnAltClick` and is on by default; in files where the debugger can set breakpoints, Alt+click on an empty glyph margin keeps opening the conditional breakpoint editor, so use the keyboard shortcut or the line number context menu there.

```json
{
	"jcode.bookmarks.toggleOnAltClick": true
}
```

**Bookmark with Note...** adds a note that helps you recognize the line later. **Go to Bookmark...** (`Ctrl+K L`) searches bookmarks by note, file, line, or color and previews the highlighted one in the editor; its buttons tag a bookmark with a color, using the same palette as tab groups, or remove it. **Go to Next Bookmark** and **Go to Previous Bookmark** step through the bookmarks. A line has one bookmark, and bookmarks follow their line as you edit.

The **Bookmarks** view in the Explorer lists bookmarks by file. Press `F2` to edit the note of a bookmark, `Delete` (`Cmd+Backspace` on macOS) to remove it, or use **Set Bookmark Color...** in its context menu. When the bookmarked line is deleted, the bookmark is marked stale; place the cursor on a new line and run **Relocate Bookmark**, or run **Remove Stale Bookmarks**. Bookmarks are stored for the workspace.

### Remote Files over SSH/SFTP

Open the **Remote** view or run **JCode Remote: Manage SSH/SFTP Connections...**. Create a connection, choose the remote folder, and select **Save and Connect** to open it in the Explorer. When the window already has folders open, JCode asks whether to **Add to Workspace**, **Open in New Window**, or **Replace Workspace**, so opening a connection never closes local folders unexpectedly.

- **Authentication.** Use a password, a private key with an optional passphrase, or your SSH agent. JCode asks you to trust a server's host key fingerprint on the first connection and again if it changes, and passwords and passphrases are stored in VS Code SecretStorage.
- **Status bar.** An item shows whether the connection is connected, connecting, reconnecting, or offline, with a warning or error background when attention is needed. Select it to retry, enter a password, edit the connection, reconnect, disconnect, or open the connection list. While a server is down, background reconnects back off up to five minutes, so the item stays Offline instead of flickering.
- **SSH config import.** Run **JCode Remote: Import Connections from SSH Config...** to pick hosts from `~/.ssh/config`, including hosts from `Include` files. Each host's `HostName`, `User`, `Port`, `IdentityFile`, and `ProxyJump` are carried over; passwords and passphrases never are.
- **Jump hosts.** Enter hosts such as `bastion.example.com, deploy@gateway:2200` in a connection's **Jump Hosts** field to connect through them in order, like `ssh -J`. Every hop uses the connection's authentication and host key verification.
- **Export and import.** When connections have saved passwords or passphrases, **Export Connections to JSON...** asks how to handle them: **Encrypt with Passphrase** (AES-256-GCM, with a key derived using scrypt), **Exclude Secrets**, or **Include Unencrypted**, which requires confirming a warning.

```json
{
	"jcodeSftp.pollInterval": 10000,
	"jcodeSftp.pollMaxEntries": 5000
}
```

`jcodeSftp.pollInterval` controls how often JCode checks remote folders for changes, in milliseconds, and `jcodeSftp.pollMaxEntries` limits how many entries it tracks per watched folder.

This feature provides an SFTP virtual workspace. Remote terminals and server-side language tooling require separate support. See the [SSH/SFTP guide](extensions/jcode-sftp/README.md) for authentication, host verification, the status bar item, jump hosts, SSH config import, save behavior, polling, and profile import/export, including how exported credentials are handled.

### AI Features

AI features (Chat, inline suggestions and the Copilot sign-in) are turned off by default. They are still included: to turn them on, open Settings and clear **Chat: Disable AI Features**, or set:

```json
{
	"chat.disableAIFeatures": false
}
```

## Build and Run

Use the Node.js version in [.nvmrc](.nvmrc), npm below version 13, Git, and your operating system's native build toolchain. The [upstream contribution guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute) documents platform-specific prerequisites. A [development container](.devcontainer/README.md) is also included.

```sh
git clone --branch custom/main --single-branch https://github.com/Jchnc/jcode.git
cd jcode
npm run install-fast
npm run build-fast
```

`build-fast` builds the client, built-in extensions (including JCode SFTP), and Copilot outputs. Run it after source changes. Once the full product has been built, `npm run build-fast -- --client-only` supports client-only iteration.

Launch from the repository root:

```powershell
# Windows
.\scripts\code.bat
```

```sh
# macOS / Linux
./scripts/code.sh
```

Development builds run as **JCode Dev**, with settings and extensions kept apart from an installed JCode.

## Keeping JCode Updated

**`custom/main` is the default and sole development branch.**

`origin` points to this JCode fork; `upstream` points to Microsoft's Code - OSS repository. The remote-tracking reference `upstream/main` does not require a second local development branch.

Set up the upstream remote once and keep pulls from rebasing the customized branch:

```sh
git remote add upstream https://github.com/microsoft/vscode.git
git config branch.custom/main.rebase false
git config pull.ff only
```

For an upstream update, start with a clean working tree:

```sh
git switch custom/main
git pull --ff-only origin custom/main
git fetch --no-tags upstream main
git merge --no-ff upstream/main
```

Resolve conflicts while preserving the custom features. If dependency manifests changed, run `npm run install-fast`; then rebuild and run the relevant checks before pushing:

```sh
git push origin custom/main
```

Merge upstream updates rather than rebasing the combined upstream and custom history. Recovery points are kept as `archive/*` tags, leaving one development branch.

## Contributing and Support

Use the [JCode issue tracker](https://github.com/Jchnc/jcode/issues) for bugs, questions, and feature requests. Submit pull requests against `custom/main`; see [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, validation, and contribution terms.

Report vulnerabilities privately through [GitHub security advisories](https://github.com/Jchnc/jcode/security/advisories/new). See [SECURITY.md](SECURITY.md) for reporting details and the maintained branch.

## License and Attribution

JCode's source is available under the [MIT License](LICENSE.txt), retaining Microsoft's Code - OSS copyright and license notices. Original JCode contributions are made under MIT; upstream and third-party work remains attributed to its authors.

The [upstream notices](ThirdPartyNotices.txt), [SFTP dependency notices](extensions/jcode-sftp/ThirdPartyNotices.txt), and component licenses are retained. Runtime dependencies and hosted services can have different terms, including the bundled Copilot CLI. See [licensing and distribution](docs/LICENSING.md) before publishing a binary package.

Visual Studio Code and Microsoft's logos are their respective owners' trademarks. JCode is independently maintained; the upstream relationship does not imply Microsoft endorsement.
