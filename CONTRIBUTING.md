# Contributing to JCode

JCode is an independently maintained fork of Microsoft's Code - OSS. Contributions to this repository are reviewed by JCode maintainers.

## Bugs, questions, and ideas

Use the [JCode issue tracker](https://github.com/Jchnc/jcode/issues). Search existing issues first and include:

- The commit or build version, operating system, and relevant settings.
- Clear reproduction steps, expected behavior, and actual behavior.
- A small sample workspace when useful.
- For SSH/SFTP issues, authentication method and sanitized logs, without passwords, keys, host fingerprints tied to private infrastructure, or connection exports.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md). Do not attach credentials or private project data to public issues.

If a problem also reproduces in an unmodified upstream build, link the corresponding upstream report. JCode-specific issues belong here; third-party extension issues belong with that extension's publisher.

## Development

Work from `custom/main`, the default and sole development branch. See the [README](README.md#build-and-run) for prerequisites, installation, and launch commands.

Follow the [project architecture, coding, and validation instructions](.github/copilot-instructions.md). Keep changes focused and preserve the upstream architecture and existing custom features.

Choose checks that cover your change:

- Client TypeScript changes: `npm run typecheck-client`, targeted ESLint, and relevant unit tests.
- Extension changes: the affected extension's build and tests.
- Workbench UI changes: exercise the affected behavior in a running build.
- Documentation changes: check links, commands, and image rendering.

A full product build uses `npm run build-fast`. Upstream merges may also require `npm run install-fast` when dependencies change.

## Pull requests

Target `custom/main`. Describe the problem, resulting behavior, related JCode issues, and the checks you ran. Use demonstration content rather than personal data in examples.

Preserve copyright headers, license files, and third-party notices. New dependencies must include their license information; update the relevant notices when dependencies change. See [licensing and distribution](docs/LICENSING.md).

By submitting a contribution, you agree to license your original contribution under the project's MIT license and confirm that you have the right to submit it. Material under another license must be identified and reviewed before inclusion. This fork does not ask contributors to sign Microsoft's CLA.

## Community expectations

Be respectful, discuss ideas and code constructively, and protect others' privacy. Harassment, discrimination, threats, and disclosure of private information are unacceptable. Maintainers may moderate comments, close discussions, or restrict participation to keep collaboration productive. GitHub's [abuse reporting tools](https://docs.github.com/en/communities/maintaining-your-safety-on-github/reporting-abuse-or-spam) are available for private reports of abusive content.

## Upstream updates

Merge `upstream/main` into `custom/main`; do not rebase the combined upstream and custom history. Follow the [update workflow](README.md#keeping-jcode-updated), resolve conflicts carefully, and verify both upstream behavior and JCode features before pushing.
