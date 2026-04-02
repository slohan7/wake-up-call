#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_ENTRY="$REPO_DIR/dist/cli/generate-brief.js"
REFRESH_DOCS_ENTRY="$REPO_DIR/dist/cli/refresh-docs.js"
LOCK_DIR="${TMPDIR:-/tmp}/founder-daily-brief-run.lock"
SKIP_REFRESH_DOCS="${FOUNDER_BRIEF_SKIP_REFRESH_DOCS:-0}"
ARGS=("$@")

mkdir -p "$REPO_DIR/logs"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another Founder Daily Brief run is already in progress."
  exit 1
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

trap cleanup EXIT

find_node_binary() {
  if [[ -n "${FOUNDER_BRIEF_NODE_BINARY:-}" && -x "${FOUNDER_BRIEF_NODE_BINARY}" ]]; then
    echo "${FOUNDER_BRIEF_NODE_BINARY}"
    return 0
  fi

  local nvm_dir="${HOME:-/Users/stevenlohan}/.nvm"
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    local current_node=""
    local requested_node=""
    export NVM_DIR="$nvm_dir"
    set +u
    . "$nvm_dir/nvm.sh" >/dev/null 2>&1 || true
    set -u

    if command -v nvm >/dev/null 2>&1; then
      if [[ -f "$REPO_DIR/.nvmrc" ]]; then
        requested_node="$(tr -d '[:space:]' < "$REPO_DIR/.nvmrc")"
        if [[ -n "$requested_node" ]]; then
          current_node="$(nvm which "$requested_node" 2>/dev/null || true)"
          if [[ -x "$current_node" ]]; then
            echo "$current_node"
            return 0
          fi
        fi
      fi

      current_node="$(nvm which current 2>/dev/null || true)"
      if [[ -x "$current_node" ]]; then
        echo "$current_node"
        return 0
      fi
    fi
  fi

  local candidates=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "/usr/bin/node"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  return 1
}

NODE_BIN="$(find_node_binary || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js binary not found. Set FOUNDER_BRIEF_NODE_BINARY to an absolute node path."
  exit 1
fi

if [[ ! -f "$REPO_DIR/.env" ]]; then
  echo "Missing $REPO_DIR/.env"
  exit 1
fi

if [[ ! -f "$DIST_ENTRY" ]]; then
  echo "Missing compiled CLI at $DIST_ENTRY"
  echo "Run 'npm run build' from $REPO_DIR first."
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$REPO_DIR"

for arg in "${ARGS[@]}"; do
  if [[ "$arg" == "--skip-refresh-docs" || "$arg" == "--help" || "$arg" == "-h" ]]; then
    SKIP_REFRESH_DOCS="1"
  fi
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Founder Daily Brief via $NODE_BIN"
if [[ "$SKIP_REFRESH_DOCS" != "1" ]]; then
  if [[ -f "$REFRESH_DOCS_ENTRY" ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Refreshing living docs"
    if ! "$NODE_BIN" "$REFRESH_DOCS_ENTRY" "${ARGS[@]}"; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Living docs refresh failed; continuing with brief generation"
    fi
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Missing compiled living docs CLI at $REFRESH_DOCS_ENTRY; continuing without refresh"
  fi
fi

FILTERED_ARGS=()
for arg in "${ARGS[@]}"; do
  if [[ "$arg" != "--skip-refresh-docs" ]]; then
    FILTERED_ARGS+=("$arg")
  fi
done

"$NODE_BIN" "$DIST_ENTRY" "${FILTERED_ARGS[@]}"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Founder Daily Brief run finished"
