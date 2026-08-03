#!/usr/bin/env bash
# Verify a GitHub App installation token can push to GITHUB_REPOSITORY.
# Used by DevTree CI publish-badges (teralexi-ci-bot), same pattern as OpenFDE.
#
# Uses git push --dry-run as the source of truth (GET /repos/.../permissions
# is unreliable for installation tokens).
#
# Required env:
#   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REF_NAME, APP_SLUG, INSTALLATION_ID
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
: "${APP_SLUG:?APP_SLUG is required}"
: "${INSTALLATION_ID:?INSTALLATION_ID is required}"

# gh uses GH_TOKEN; keep it explicit for installation APIs.
export GH_TOKEN

echo "Installation id: ${INSTALLATION_ID}"
echo "App slug: ${APP_SLUG}"
echo "Target repository: ${GITHUB_REPOSITORY}"

if ! command -v gh >/dev/null 2>&1; then
  echo "::error::gh CLI is required (preinstalled on GitHub-hosted runners)."
  exit 1
fi

echo ""
echo "Repositories accessible to this installation token:"
mapfile -t repo_lines < <(
  gh api "/installation/repositories?per_page=100" --paginate \
    --jq '.repositories[] | "\(.full_name)|\(.permissions.pull)|\(.permissions.push)"'
)

if [ "${#repo_lines[@]}" -eq 0 ]; then
  echo "  (none — the app installation has no repository access)"
else
  for line in "${repo_lines[@]}"; do
    IFS='|' read -r name pull push <<< "${line}"
    echo "  - ${name}  pull=${pull} push=${push}"
  done
fi

install_push=""
for line in "${repo_lines[@]}"; do
  IFS='|' read -r name pull push <<< "${line}"
  if [ "${name}" = "${GITHUB_REPOSITORY}" ]; then
    install_push="${push}"
    break
  fi
done

if [ -z "${install_push}" ]; then
  echo ""
  echo "::error::${APP_SLUG} is not installed on ${GITHUB_REPOSITORY}."
  echo "::error::Org → Settings → GitHub Apps → ${APP_SLUG} → Configure → Repository access → add ${GITHUB_REPOSITORY##*/} (or All repositories)."
  exit 1
fi

echo ""
echo "Installation listing permissions.push for ${GITHUB_REPOSITORY}: ${install_push}"

echo ""
echo "Dry-run push to ${GITHUB_REF_NAME}..."
git config user.name "${APP_SLUG}[bot]"
git config user.email "${APP_SLUG}[bot]@users.noreply.github.com"

# --no-verify: DevTree husky pre-push runs test:all (cargo + GTK deps). This job
# has no libglib installed and must not trigger those hooks.
push_url="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if git push --dry-run --no-verify "${push_url}" "HEAD:${GITHUB_REF_NAME}"; then
  echo "Push access verified."
  exit 0
fi

echo ""
echo "::error::${APP_SLUG} cannot push to ${GITHUB_REPOSITORY} (git push --dry-run failed)."
if [ "${install_push}" != "true" ]; then
  echo "::error::Installation reports push=false. Fix app Contents permission and accept on the org installation."
fi
echo "::error::1) App → Permissions → Contents → Read and write → Save"
echo "::error::2) Org installation → Review and accept new permissions"
echo "::error::3) main branch rules → add ${APP_SLUG}[bot] to bypass / allowed push actors (not github-actions[bot])"
echo "::error::4) Ensure environment CI-build has GIT_CI_BUILD_BOT_APP_ID + GIT_CI_BUILD_BOT_APP_PRIVATE_ID"
echo "::error::5) If org uses SAML SSO → https://github.com/settings/applications → Authorize for the org"
exit 1
