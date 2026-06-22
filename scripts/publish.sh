#!/usr/bin/env bash
#
# Trigger the "Publish to Homey App Store" GitHub Actions workflow.
#
# The workflow runs: tests → validate → version bump → commit/tag/push → publish.
#
# Usage:
#   GH_TOKEN=ghp_xxx ./scripts/publish.sh [patch|minor|major] "Changelog text"
#
# Examples:
#   GH_TOKEN=ghp_xxx ./scripts/publish.sh patch "Bug fixes."
#   GH_TOKEN=ghp_xxx ./scripts/publish.sh minor "New: Any-prayer trigger."
#
# The token must be a GitHub PAT with:
#   - classic:      repo + workflow scopes, OR
#   - fine-grained: Actions: Read/Write + Contents: Read/Write on this repo.
# Never commit the token; pass it via the GH_TOKEN environment variable.

set -euo pipefail

REPO="DPANET/PrayersHomeySDK3"
WORKFLOW="publish.yml"
REF="master"

BUMP="${1:-patch}"
CHANGELOG="${2:-}"

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: set GH_TOKEN to a GitHub PAT (repo + workflow scope)." >&2
  exit 1
fi
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "ERROR: version bump must be patch, minor, or major (got '$BUMP')." >&2
  exit 1
fi
if [[ -z "$CHANGELOG" ]]; then
  echo "ERROR: provide a changelog string as the second argument." >&2
  exit 1
fi

# Build the JSON payload safely (escapes quotes/newlines in the changelog).
payload="$(CHANGELOG="$CHANGELOG" BUMP="$BUMP" REF="$REF" python3 -c '
import json, os
print(json.dumps({
    "ref": os.environ["REF"],
    "inputs": {"version": os.environ["BUMP"], "changelog": os.environ["CHANGELOG"]},
}))')"

echo "Dispatching $WORKFLOW on $REF (bump: $BUMP)…"
code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches" \
  -d "$payload")"

if [[ "$code" != "204" ]]; then
  echo "ERROR: dispatch failed (HTTP $code). Check the token's validity and scopes." >&2
  exit 1
fi

echo "✓ Dispatched. Watch it at:"
echo "  https://github.com/${REPO}/actions/workflows/${WORKFLOW}"
