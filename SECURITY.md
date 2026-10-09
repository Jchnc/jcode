# JCode Security Policy

JCode is independently maintained. Reports about this fork are handled by JCode maintainers, not by Microsoft's security team.

## Report a vulnerability privately

Use [Report a vulnerability](https://github.com/Jchnc/jcode/security/advisories/new) in this repository's GitHub security advisories. Private vulnerability reporting is enabled.

**Do not publish vulnerabilities or credentials in public issues, pull requests, or discussions.**

Include the affected commit or build, operating system, reproduction steps, impact, and any suggested fix. Use a minimal demonstration and redact secrets, personal data, and private infrastructure details. Maintainers will use the private advisory to coordinate investigation, fixes, and disclosure; no response deadline or bug bounty is promised.

If a vulnerability affects unmodified Code - OSS, follow [Microsoft's security reporting process](https://github.com/microsoft/vscode/security/policy) as well. Keep exploit details private while the affected maintainers coordinate a fix.

## Maintained code

Security fixes are applied to the current `custom/main` development branch. There are no separately maintained JCode release branches. Older commits and `archive/*` recovery tags do not receive backported fixes.

Keep the checkout, dependencies, Electron runtime, and installed extensions updated. The inherited version number identifies the upstream baseline and does not by itself identify a JCode security release.

## SSH/SFTP

Passwords and private key passphrases are stored through SecretStorage. Verify the server's host key fingerprint through a trusted channel before accepting it.

**Connection exports can contain recoverable passwords and passphrases.** Treat exported JSON as a secret. Do not commit it, attach it to an issue, or use real credentials in documentation examples. Private key files are not included in exports.

See the [SSH/SFTP guide](extensions/jcode-sftp/README.md) for host verification, credential storage, reconnection, save behavior, and polling limits.

## Scope

This policy covers the JCode repository and its custom features. Third-party extensions, hosted services, and upstream components may have their own reporting channels and policies. This document is a reporting policy, not a security audit or a guarantee that the code is free of vulnerabilities.
