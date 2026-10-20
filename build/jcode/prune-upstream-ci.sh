#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
#---------------------------------------------------------------------------------------------
#
# JCode only runs its own GitHub Actions workflows (.github/workflows/jcode-*.yml). Upstream
# Code - OSS ships many more (PR test matrices, CodeQL, scheduled scans, packaging) that would
# waste compute on a fork, plus Dependabot configuration. Run this after merging upstream: it
# removes whatever upstream added or changed there, which also resolves the "modified upstream,
# deleted in JCode" conflicts such a merge reports for these files.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

removed=0
remove() {
	if [ -e "$1" ] || git ls-files --error-unmatch -- "$1" >/dev/null 2>&1 || git ls-files --unmerged -- "$1" | grep -q .; then
		git rm -rq --ignore-unmatch -- "$1" 2>/dev/null || true
		rm -rf -- "$1"
		echo "Removed $1"
		removed=$((removed + 1))
	fi
}

# Tracked, untracked and conflicted entries alike.
while IFS= read -r path; do
	case "$(basename "$path")" in
		jcode-*) ;;
		*) remove "$path" ;;
	esac
done < <( { git ls-files -- .github/workflows; git ls-files --unmerged -- .github/workflows | cut -f2; ls -1d .github/workflows/* 2>/dev/null; } | sed 's#^\(\.github/workflows/[^/]*\).*#\1#' | sort -u)

remove .github/actions
remove .github/dependabot.yml

echo "Upstream CI pruned ($removed removed). Remaining workflows:"
ls -1 .github/workflows
