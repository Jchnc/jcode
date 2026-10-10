# JCode CLI and GitHub updates

JCode can distribute Windows updates entirely through GitHub. GitHub Releases holds the installers; GitHub Pages holds small JSON feeds. No separate server, hosting account, or embedded access token is needed. The repository and release assets must be publicly accessible to installed clients.

## One-time GitHub setup

1. Push these changes to your repository. Both workflows must exist on the repository's **default branch** for the complete release process. If your working branch is `custom/main`, merge the changes to the default branch or make `custom/main` the default in GitHub settings.
2. In **Settings > Actions > General**, enable Actions. The release workflow requests `contents: write` to create draft releases.
3. In **Settings > Pages > Build and deployment**, choose **GitHub Actions** as the source.
4. Check that the Pages URL is `https://jchnc.github.io/jcode`. If the owner, repository, or Pages domain differs, change `product.json`'s `updateUrl` and `downloadUrl` before building. Keep the `{platform}`, `{quality}`, and `{commit}` placeholders in the feed URL.
5. Check the `github-pages` environment's deployment rules allow the default branch.

This workflow publishes a complete Pages site. If this repository already hosts another Pages site, combine that site's artifacts with the update feed before deploying.

## First release

1. Open **Actions > Build JCode Windows Release > Run workflow** and select the branch containing the changes.
2. The workflow installs dependencies, builds Windows x64, packages a per-user Inno Setup installer, and creates a **draft** GitHub release. Allow up to two hours for the first build. Logs expose any fork-specific dependency or build failures; this workflow has not yet been run on GitHub.
3. Download and test the installer from the draft release (or the `jcode-windows-x64` workflow artifact). Keep both the `.exe` and `jcode-update.json` attached to the release.
4. Publish the draft as a regular release, **not a prerelease**. Publishing it manually triggers **Publish JCode Update Feed**.
5. Wait for the Pages deployment to finish. The first release's feed returns `{}` because no newer version exists.
6. Install this first JCode installer once on each existing machine. Older builds do not know this feed. JCode has its own Windows installer identity and does not replace an existing Code - OSS installation. Existing `.vscode-oss` user data is retained; the user-data folder naming has not changed.

Installers are currently unsigned. Windows may show an unknown-publisher/SmartScreen prompt. Authenticode signing can be added later with your certificate. macOS updates require signed macOS builds and a compatible feed; they are not enabled by this setup.

## Future releases

1. Increase `package.json`'s version to a strictly greater `major.minor.patch` value. Synchronize the root version entries in `package-lock.json` (for example, `npm version 1.142.1 --no-git-tag-version --ignore-scripts`), commit the version and code changes, and push.
2. Run **Build JCode Windows Release** again, test the draft installer, and publish the draft.
3. The Pages workflow regenerates a feed for every retained release commit. Each older client receives the newest higher-version installer, its build commit, and its SHA-256 checksum. The newest client receives `{}`. Older releases must remain published with their metadata assets so their clients' feed paths continue to exist.
4. An installed Windows x64 user build checks through the inherited updater, downloads the installer, and offers installation/restart. Use **Check for Updates** to trigger a check manually. Updates are disabled in source/development runs and when `update.mode` is `none`. Do not run a per-user installation as Administrator when testing updates.

Each release needs a unique version and build commit. Do not reuse or overwrite release tags or assets. To retry a failed build before publishing, remove its draft release and tag in GitHub first. To regenerate the feed without a new release, run **Publish JCode Update Feed** manually.

Verify the complete update flow with two different published versions: install the first, publish the second, check for updates in the first, accept restart, and confirm `jcode --version` reports the second. Repository tests cannot substitute for this installer test.

## CLI

The Windows installer has an **Add to PATH** option. Select it, then open a new terminal:

```sh
jcode .
jcode path/to/file.ts
jcode --new-window path/to/project
jcode --wait path/to/file.ts
jcode --diff before.ts after.ts
jcode --version
```

For a locally packaged Windows build, add its `bin` directory to PATH. For a source checkout, use `scripts\code-cli.bat .` (or `scripts/code-cli.sh .`) after compiling; source launchers do not install a global command. Changing the product executable name requires refreshing the development Electron download with `npm run electron`.

macOS packaging now ships `bin/jcode` and its **Shell Command: Install 'jcode' command in PATH** action uses that launcher. Linux packaging also names its launcher `jcode`. This release workflow builds only Windows x64; macOS/Linux packaging is not validated here. Automatic updates are intentionally enabled only on Windows; ARM64, system installers, and ZIP builds currently get empty feeds. Additional platforms require their own release artifacts and installation validation.

## Local checks and packaging

```sh
node --test build/jcode/update-feed.test.ts build/jcode/release.test.ts
npm ci
node build/lib/builtInExtensions.ts
node build/npm/electronTypes.ts
npm run gulp vscode-win32-x64-min
npm run gulp vscode-win32-x64-inno-updater
npm run gulp vscode-win32-x64-user-setup
```

On Windows, use the Node version in `.nvmrc`, Python 3.11, Visual Studio C++ build tools, and Windows SDK `signtool.exe` on PATH. The packaged app is written to `../VSCode-win32-x64` and the installer to `.build/win32-x64/user-setup/VSCodeSetup.exe`. Generate matching metadata with `node build/jcode/release.ts ../VSCode-win32-x64 <installer-path> <metadata-output-path> .build/win32-x64/user-setup/product.json`.
