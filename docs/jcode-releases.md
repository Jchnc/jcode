# JCode releases, CLI, and updates

JCode releases are hosted entirely on GitHub: Releases stores the downloadable applications and Pages serves per-platform update feeds. Installed clients do not need GitHub credentials. The repository and release assets must be public.

## Supported builds

| Platform | Architecture | Download | Update behavior |
| --- | --- | --- | --- |
| Windows | x64 | Per-user `.exe` installer | Download, install, and restart through the inherited updater |
| macOS | Intel x64 | `.zip` containing `JCode.app` | Automatic updates with signing credentials; notifications and a download link for unsigned builds |
| macOS | Apple Silicon ARM64 | `.zip` containing `JCode.app` | Same as Intel macOS |
| Linux | x64 | `.tar.gz` | Notifications and a link to the matching archive |
| Linux | ARM64 | `.tar.gz` | Notifications and a link to the matching archive |

Linux archives do not install themselves. Automatic Linux installation needs a package repository/package-manager integration or a separate archive updater. This setup provides neither an APT/RPM repository nor `.deb`/`.rpm`/AppImage packages. Windows ARM64 and system installers are not built by this workflow.

## One-time GitHub setup

1. Put both workflows on your repository's **default branch**. If you work on `custom/main`, merge the changes into the default branch or make `custom/main` the default in GitHub settings.
2. Enable GitHub Actions in **Settings > Actions > General**. The release job requests `contents: write` to create a draft release.
3. In **Settings > Pages > Build and deployment**, select **GitHub Actions**.
4. Verify that the Pages URL is `https://jchnc.github.io/jcode`. Change `product.json`'s `updateUrl` and `downloadUrl` if you use another repository or Pages domain. Keep the `{platform}`, `{quality}`, and `{commit}` placeholders.
5. Check that the `github-pages` environment permits deployments from the default branch.

The feed workflow publishes a complete Pages site. If the repository already hosts another site, combine its artifacts with the update feeds before deploying.

## Build and publish

1. Open **Actions > Build JCode Release > Run workflow**, selecting your release branch.
2. Five native builds run: Windows x64, macOS x64/ARM64, and Linux x64/ARM64. GitHub provides the runners; no server is needed. All builds must succeed before the final job creates a draft release. Allow up to two hours per build. These workflows still need their first GitHub execution; fork-specific dependency or packaging failures appear in the build logs.
3. Download and test each platform artifact. They are available under the workflow's artifacts and in the assembled draft release.
4. Publish the draft as a regular release, not a prerelease. Keep every application archive/installer and the combined **`jcode-update.json`** attached. Publishing manually triggers **Publish JCode Update Feed**.
5. Wait for the Pages deployment. The first version has no newer update and returns `{}`. After a higher version is published, older clients receive the matching platform/architecture asset and SHA-256 checksum.
6. Install the first configured version manually on existing machines. Previous builds do not know this feed. JCode has its own Windows installer identity and macOS bundle identity. Existing `.vscode-oss` user data is retained.

Before each later release, increase `package.json` to a greater `major.minor.patch`, synchronize the root lockfile version (for example `npm version 1.142.1 --no-git-tag-version --ignore-scripts`), commit, and push. Then repeat the build/test/publish steps.

Each release must have a unique version and commit, with one metadata entry per supported platform. Do not overwrite published tags/assets or remove older releases: their metadata preserves the feed paths used by installed clients. Old Windows-only `jcode-update.json` files remain supported. To retry before publishing, remove that version's draft and tag first. To regenerate feeds, run **Publish JCode Update Feed** manually.

Validate a complete upgrade using two published versions on each supported OS. Repository tests cannot replace installation tests. Windows user installations should be tested without running the IDE as Administrator. Source/development runs and `update.mode: none` disable update checks.

## macOS signing and automatic updates

Mac builds without Developer ID credentials are ad-hoc signed for development and use `darwinUpdateMode: manual`: the IDE checks the feed and opens the correct ZIP when the user chooses to download. Ad-hoc signing does not establish a trusted publisher or enable automatic updates. macOS may block these applications; public distribution should use Developer ID signing and notarization.

To produce signed, notarized builds and enable automatic updates, add these **repository Actions secrets**:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE` | Base64-encoded `.p12` containing your **Developer ID Application** certificate and private key |
| `MACOS_CERTIFICATE_PASSWORD` | Password used to export that `.p12` |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_APP_PASSWORD` | An Apple app-specific password for that account |
| `APPLE_TEAM_ID` | Your Apple Developer team ID |

The certificate requires an Apple Developer account. GitHub hosts the downloads but cannot provide Apple's signing identity. Keep the signing identity consistent across versions.

With the certificate secret present, the workflow requires the remaining secrets, enables automatic Mac updates in the packaged product, signs the app using the existing Electron entitlements, submits it for notarization, staples the ticket, and verifies it before creating the release ZIP. It fails rather than publishing an unsigned ZIP from a configured signing job. Signing material is removed from the runner afterward. Install the first signed version manually if migrating from unsigned builds, and retain signing for future releases.

The updater first checks the static JSON feed before calling Squirrel.Mac. Empty feeds mean no update; available feeds include Squirrel's release name, notes/build commit, publication date, and ZIP URL. Signed Mac updates may still need a restart and permission to replace the installed application.

Windows installers remain unsigned. Authenticode signing can be added with a Windows code-signing certificate.

## Install and enable `jcode`

**Windows:** select **Add to PATH** during installation and open a new terminal.

**macOS:** extract the correct ZIP, move `JCode.app` to `/Applications`, open it, and run **Shell Command: Install 'jcode' command in PATH** from the Command Palette. Open a new terminal.

**Linux:** extract the correct archive into a dedicated directory and add its `bin` directory to PATH, or create a symlink from `~/.local/bin/jcode` to the extracted `bin/jcode`. Ensure `~/.local/bin` is on PATH. The executable and bundled shared libraries require a compatible Linux desktop environment. Future archive updates require closing JCode and replacing the extracted application.

```sh
jcode .
jcode path/to/file.ts
jcode --new-window path/to/project
jcode --wait path/to/file.ts
jcode --diff before.ts after.ts
jcode --version
```

Source checkouts use `scripts\code-cli.bat .` on Windows or `scripts/code-cli.sh .` on Unix after compilation. Renaming the product executable requires refreshing the development Electron download with `npm run electron`.

## Local validation and packaging

```sh
node --test build/jcode/update-feed.test.ts build/jcode/release.test.ts build/jcode/merge-release.test.ts
```

Use the Node version in `.nvmrc`, Python 3.11, and the platform's native build prerequisites. The workflow downloads built-in extensions, prepares Electron types, then runs `npm run gulp vscode-<platform>-<arch>-min`. Windows also runs the `inno-updater` and `user-setup` tasks. The application folders are written next to the checkout as `VSCode-<platform>-<arch>`.

`build/jcode/release.ts` reads packaged identity and hashes the final downloadable asset. For Windows, pass the staged `.build/win32-x64/user-setup/product.json` as its fourth argument. For Linux/macOS, pass `-` there and supply the platform feed ID as the fifth argument; macOS's first argument is the `JCode.app` path. `merge-release.ts` verifies that all five builds share the same version/commit and combines their metadata before creating the draft release.
