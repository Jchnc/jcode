# JCode

JCode is a customized fork of [Code - OSS](https://github.com/microsoft/vscode), the open-source codebase behind Visual Studio Code. It adds tab groups, vertical tabs, workspace colors, and built-in SSH/SFTP file access while retaining the upstream editor and extension architecture.

**`custom/main` is the default and sole development branch.** Upstream updates are merged into it, preserving JCode's custom features and history.

## Custom Features

| Feature | What it does |
| --- | --- |
| Tab groups | Organize tabs into named, colored groups with optional icons. Collapse, save, lock, move, and ungroup them, or undo the last group change. |
| Vertical tabs | Place tabs to the left or right of the editor and resize the strip. The traditional top layout is also available. |
| Workspace colors | Coordinate the title bar, status bar, and panel resize gaps with a workspace color. Menu and status hover treatments follow the same scheme. |
| Rounded workbench panels | Give the vertical tab strip and editor their own rounded surfaces within the Modern UI layout. |
| SSH/SFTP workspaces | Browse and edit remote files in the Explorer, with saved connections, password/key/agent authentication, reconnection, and profile import/export. |

### Tabs and Groups

Right-click an editor tab and choose **Add to New Tab Group**. Right-click the group header to edit its name, color, icon, or group actions.

For vertical tabs and the rounded panel layout, use:

```json
{
	"workbench.editor.showTabs": "multiple",
	"workbench.editor.tabPosition": "left",
	"workbench.editor.verticalTabsWidth": 240,
	"workbench.editor.tabGroups.enabled": true,
	"workbench.experimental.modernUI": true
}
```

Use `"right"` or `"top"` for a different tab position. Resize the vertical strip by dragging its handle.

### Workspace Colors

Open a folder or workspace and run **Preferences: Workspace Color...** from the Command Palette. Choose a preset or hex color, preview **Subtle** or **Rich**, then select **Apply**. **Cancel** restores the previous appearance; **Use Theme Color** clears the workspace color.

Colors are saved for that workspace on the current device. Explicit theme color customizations take precedence over workspace colors, and high-contrast themes retain their accessible surfaces.

### Remote Files over SSH/SFTP

Open the **Remote** view or run **JCode Remote: Manage SSH/SFTP Connections...**. Create a connection, choose the remote folder, and select **Save and Connect** to open it in the Explorer.

This feature provides an SFTP virtual workspace. Remote terminals and server-side language tooling require separate support. See the [SSH/SFTP guide](extensions/jcode-sftp/README.md) for authentication, host verification, save behavior, polling, and profile import/export, including how exported credentials are handled.

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

Development builds currently use the inherited **Code - OSS Dev** application name.

## Keeping JCode Updated

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

## Development and Contributions

Report JCode bugs and feature requests in [this repository's issue tracker](https://github.com/Jchnc/jcode/issues). Submit changes against `custom/main` and describe how they were verified.

Follow the [coding and validation instructions](.github/copilot-instructions.md). Useful checks include `npm run typecheck-client`, targeted `npm run eslint -- <files>`, and the unit-test runners under [scripts](scripts). Choose checks that cover the change; documentation-only changes do not require a full product rebuild.

Upstream built-in extensions remain under [extensions](extensions), alongside JCode's custom SFTP extension. The project follows the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).

## License and Attribution

JCode builds on Microsoft's Code - OSS and its community contributions. The source is licensed under the [MIT License](LICENSE.txt); upstream copyright notices and [third-party notices](ThirdPartyNotices.txt) are retained.

Copyright (c) Microsoft Corporation. All rights reserved.
