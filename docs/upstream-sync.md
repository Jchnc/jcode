# Keeping JCode in sync with Code - OSS

JCode is a fork of [Code - OSS](https://github.com/microsoft/vscode). This guide is for maintainers who bring upstream improvements into JCode.

## Branches and remotes

- `custom/main` is the default and only development branch.
- `origin` is the JCode fork. `upstream` is Microsoft's Code - OSS repository; its `upstream/main` remote-tracking branch is all you need, with no second local branch.
- Merge upstream rather than rebasing, so the combined history stays intact. Before a large merge, tag a recovery point as `archive/<name>`.

Set up once:

```sh
git remote add upstream https://github.com/microsoft/vscode.git
git config branch.custom/main.rebase false
git config pull.ff only
```

## Merging upstream

Start from a clean working tree:

```sh
git switch custom/main
git pull --ff-only origin custom/main
git tag archive/pre-upstream-merge-$(date +%Y-%m-%d)
git fetch --no-tags upstream main
git merge --no-ff upstream/main
bash build/jcode/prune-upstream-ci.sh
```

Then:

1. Resolve the remaining conflicts, keeping both upstream's change and JCode's customization.
2. If `package.json` or `package-lock.json` changed, run `npm run install-fast`.
3. Validate: `npm run typecheck-client`, `npm run valid-layers-check`, `npm run transpile-client`, and the tests of the areas JCode customizes (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
4. Commit the merge and push: `git push origin custom/main --follow-tags`.

## GitHub Actions

JCode only runs its own workflows, `.github/workflows/jcode-*.yml`:

- **Build JCode Release** runs when started by hand and creates a draft release. See [JCode releases](jcode-releases.md).
- **Publish JCode Update Feed** runs when a release is published.

Upstream ships many more workflows (pull request test matrices, CodeQL, scheduled scans, packaging) and a Dependabot configuration, which would waste compute on a fork. `build/jcode/prune-upstream-ci.sh` removes whatever upstream adds or changes there and resolves the merge conflicts those files report, so run it after every upstream merge.
