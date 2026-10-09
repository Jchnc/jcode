# JCode Licensing and Distribution

JCode is an independently maintained fork of [Code - OSS](https://github.com/microsoft/vscode). Microsoft and upstream contributors retain rights in their work; JCode contributors retain rights in their original contributions. Renaming the fork does not transfer ownership of the upstream code.

## Source license and attribution

The repository's [MIT license](../LICENSE.txt) permits use, modification, and distribution subject to its conditions. Keep the copyright notice and full permission notice with copies or substantial portions of the software. JCode contributions are made under MIT unless an included component states otherwise.

The upstream license text and copyright headers are retained. [ThirdPartyNotices.txt](../ThirdPartyNotices.txt), component license files, and notices embedded in source files must also be preserved. The [SFTP dependency notices](../extensions/jcode-sftp/ThirdPartyNotices.txt) cover the additional packages used by JCode's SSH/SFTP feature.

This source repository and Microsoft's branded Visual Studio Code distribution are distinct. The latter has its own [product license](https://code.visualstudio.com/license).

## JCode identity

Use JCode as this fork's project name. References to Code - OSS and Visual Studio Code identify the upstream project, not an endorsement. JCode is not an official Microsoft product and is not affiliated with or endorsed by Microsoft.

Microsoft's product names and logos are subject to separate [brand guidelines](https://code.visualstudio.com/brand). The MIT source license is not permission to use the Visual Studio Code logo as JCode's branding. Use independently created JCode branding for a packaged release; do not replace upstream copyright or third-party attribution with JCode ownership claims.

Development builds still use inherited Code - OSS application identifiers and naming. A distributable JCode package should have its own application identity and branding, with attribution retained.

## Dependencies and packaged releases

The root MIT license does not relicense dependencies, runtime binaries, extensions, or online services. Review the exact versions and contents shipped on each target platform, including optional native dependencies, and include their required licenses and notices in the package.

The upstream Copilot extension source has an [MIT license](../extensions/copilot/LICENSE.txt), but its downloaded `@github/copilot` CLI has a separate [GitHub Copilot CLI license](https://github.com/github/copilot-cli/blob/main/LICENSE.md). A [copy of the installed 1.0.73 license](licenses/GitHub-Copilot-CLI-1.0.73.txt) is included for reference; refresh it when the bundled version changes. The installed package's `LICENSE.md` is the authoritative notice for that version. Its redistribution conditions include shipping the CLI unmodified, as part of an independently licensed application with material additional functionality, and retaining its license and proprietary notices. Do not describe that CLI as MIT or distribute it as JCode's standalone product.

Retain Electron and other runtime notices, and inspect any downloaded extensions or bundled SDKs individually. Permission to redistribute an extension does not automatically grant access to its marketplace or hosted service. Accounts, subscriptions, service terms, and privacy policies remain separate.

Before publishing a binary release:

1. Inventory the actual packaged components and versions on each platform.
2. Preserve the root license and all required component licenses, copyrights, and notices.
3. Check redistribution conditions for non-MIT components, including the bundled Copilot CLI.
4. Use independent JCode application branding and make the upstream relationship clear.
5. Review any configured marketplaces, telemetry endpoints, and hosted services under their own terms.

This document records the repository's source provenance and known distribution considerations. It does not certify a future binary package, audit every dependency, or determine trademark availability for the JCode name.
