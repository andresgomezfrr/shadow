#!/bin/bash
# Shadow — Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/andresgomezfrr/shadow/main/scripts/install.sh | bash
#   or:  bash scripts/install.sh [--branch NAME] [--no-daemon] [--uninstall] [--help]
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

SHADOW_HOME="${SHADOW_DATA_DIR:-$HOME/.shadow}"
SHADOW_APP="$SHADOW_HOME/app"
SHADOW_BIN="$SHADOW_HOME/bin"
BRANCH=""
NO_DAEMON=false
UNINSTALL=false
REPO_SSH="git@github.com:andresgomezfrr/shadow.git"
REPO_HTTPS="https://github.com/andresgomezfrr/shadow.git"

# ── Colors ────────────────────────────────────────────────────────────────────

if [ -t 1 ] && [ "${TERM:-dumb}" != "dumb" ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; DIM=''; RESET=''
fi

info()    { printf "  ${BLUE}→${RESET} %s\n" "$*"; }
success() { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
warn()    { printf "  ${YELLOW}⚠${RESET} %s\n" "$*"; }
fail()    { printf "  ${RED}✗${RESET} %s\n" "$*"; }
step()    { printf "\n${BOLD}[%s]${RESET} %s\n" "$1" "$2"; }

# ── Argument parsing ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
🌑 Shadow Installer

Usage:
  curl -fsSL <url>/install.sh | bash
  bash install.sh [options]

Options:
  --branch NAME    Use specific branch instead of latest release tag
  --no-daemon      Don't start the daemon after install
  --uninstall      Remove Shadow completely
  -h, --help       Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --branch)     BRANCH="$2"; shift 2 ;;
    --branch=*)   BRANCH="${1#*=}"; shift ;;
    --no-daemon)  NO_DAEMON=true; shift ;;
    --uninstall)  UNINSTALL=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            fail "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────

# Parse semver tags and return the highest one (e.g. "v1.2.3")
latest_semver_tag() {
  # Input: output of `git tag -l "v*"` or `git ls-remote --tags`
  # Filters vX.Y.Z, sorts numerically, returns highest
  grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' \
    | sort -t. -k1,1n -k2,2n -k3,3n \
    | tail -1
}

# Compare two semver strings: returns 0 if $1 > $2
semver_gt() {
  local a="$1" b="$2"
  a="${a#v}"; b="${b#v}"
  local a1 a2 a3 b1 b2 b3
  IFS='.' read -r a1 a2 a3 <<< "$a"
  IFS='.' read -r b1 b2 b3 <<< "$b"
  if [ "$a1" -gt "$b1" ] 2>/dev/null; then return 0; fi
  if [ "$a1" -lt "$b1" ] 2>/dev/null; then return 1; fi
  if [ "$a2" -gt "$b2" ] 2>/dev/null; then return 0; fi
  if [ "$a2" -lt "$b2" ] 2>/dev/null; then return 1; fi
  if [ "$a3" -gt "$b3" ] 2>/dev/null; then return 0; fi
  return 1
}

stop_shadow_daemon() {
  local plist="$HOME/Library/LaunchAgents/com.shadow.daemon.plist"
  if [ -f "$plist" ]; then
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  fi
  pkill -f "shadow/src/daemon/runtime.ts" 2>/dev/null || true
  pkill -f "shadow/app/src/daemon/runtime.ts" 2>/dev/null || true
  pkill -f "shadow/dist/daemon/runtime.js" 2>/dev/null || true
  pkill -f "shadow/app/dist/daemon/runtime.js" 2>/dev/null || true
  pkill -f 'claude.*--allowedTools.*mcp__shadow' 2>/dev/null || true
  lsof -ti :3700 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
}

add_to_path() {
  local rc="$1" line="$2" guard="# SHADOW_PATH"
  if [ -f "$rc" ] && grep -qF "$guard" "$rc" 2>/dev/null; then
    return 0  # already present
  fi
  mkdir -p "$(dirname "$rc")"
  printf '\n%s\n%s\n' "$guard" "$line" >> "$rc"
  return 0
}

# Resolve Node >= 22 binary across version managers
# Sets NODE22 and NPM22 variables. Returns 1 if not found.
resolve_node22() {
  local candidate=""

  # nvm (XDG layout: ~/.local/share/nvm)
  if [ -z "$candidate" ] && [ -d "$HOME/.local/share/nvm" ]; then
    for d in "$HOME/.local/share/nvm"/v22.*/bin/node; do
      [ -x "$d" ] && candidate="$d" && break
    done
  fi

  # nvm (classic layout: ~/.nvm)
  if [ -z "$candidate" ] && [ -d "$HOME/.nvm/versions/node" ]; then
    for d in "$HOME/.nvm/versions/node"/v22.*/bin/node; do
      [ -x "$d" ] && candidate="$d" && break
    done
  fi

  # fnm
  if [ -z "$candidate" ]; then
    for d in "$HOME/Library/Application Support/fnm/node-versions"/v22.*/installation/bin/node; do
      [ -x "$d" ] && candidate="$d" && break
    done
  fi

  # Homebrew
  if [ -z "$candidate" ]; then
    for d in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node; do
      [ -x "$d" ] && candidate="$d" && break
    done
  fi

  # PATH fallback — only if it's actually >= 22
  if [ -z "$candidate" ] && command -v node >/dev/null 2>&1; then
    local ver
    ver=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    if [ "$ver" -ge 22 ] 2>/dev/null; then
      candidate="$(command -v node)"
    fi
  fi

  if [ -z "$candidate" ]; then
    return 1
  fi

  NODE22="$candidate"
  # npm lives next to node in all version managers
  local bindir
  bindir="$(dirname "$candidate")"
  if [ -x "$bindir/npm" ]; then
    NPM22="$bindir/npm"
  else
    # Fallback to PATH npm (e.g. system install)
    NPM22="$(command -v npm || true)"
  fi
  return 0
}

# ── Uninstall ─────────────────────────────────────────────────────────────────

if [ "$UNINSTALL" = true ]; then
  printf "\n${BOLD}🌑 Shadow Uninstaller${RESET}\n"

  step "1/5" "Stopping daemon..."
  stop_shadow_daemon
  success "Daemon stopped"

  step "2/5" "Removing launchd service..."
  local_plist="$HOME/Library/LaunchAgents/com.shadow.daemon.plist"
  if [ -f "$local_plist" ]; then
    rm -f "$local_plist"
    success "Removed $local_plist"
  else
    info "No launchd plist found"
  fi

  step "3/5" "Removing Shadow app and bin..."
  rm -rf "$SHADOW_APP" "$SHADOW_BIN"
  success "Removed ~/.shadow/app and ~/.shadow/bin"

  step "4/5" "Cleaning shell PATH..."
  for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc"; do
    if [ -f "$rc" ] && grep -qF "# SHADOW_PATH" "$rc"; then
      # Remove the SHADOW_PATH block (marker + next line)
      sed -i.bak '/# SHADOW_PATH/,+1d' "$rc" && rm -f "${rc}.bak"
      success "Cleaned $rc"
    fi
  done
  fish_rc="$HOME/.config/fish/config.fish"
  if [ -f "$fish_rc" ] && grep -qF "# SHADOW_PATH" "$fish_rc"; then
    sed -i.bak '/# SHADOW_PATH/,+1d' "$fish_rc" && rm -f "${fish_rc}.bak"
    success "Cleaned $fish_rc"
  fi

  step "5/5" "Cleaning Claude settings..."
  settings="$HOME/.claude/settings.json"
  claude_md="$HOME/.claude/CLAUDE.md"
  if [ -f "$claude_md" ] && grep -q 'SHADOW:START' "$claude_md"; then
    sed -i.bak '/<!-- SHADOW:START -->/,/<!-- SHADOW:END -->/d' "$claude_md" && rm -f "${claude_md}.bak"
    success "Removed Shadow section from CLAUDE.md"
  fi
  info "Review ~/.claude/settings.json manually to remove Shadow hooks/MCP"
  info "Data directory ~/.shadow/ preserved (db, memories, soul). Delete manually if desired."

  printf "\n${GREEN}Shadow uninstalled.${RESET}\n\n"
  exit 0
fi

# ── Install / Upgrade ────────────────────────────────────────────────────────

printf "\n${BOLD}🌑 Shadow Installer${RESET}\n"

IS_UPGRADE=false
if [ -d "$SHADOW_APP/.git" ]; then
  IS_UPGRADE=true
fi

# ── Phase 1: Prerequisites ───────────────────────────────────────────────────

step "1/7" "Checking prerequisites..."

# OS
OS="$(uname -s)"
case "$OS" in
  Darwin) success "macOS $(sw_vers -productVersion 2>/dev/null || echo '')" ;;
  Linux)  success "Linux $(uname -r)"; warn "No launchd — daemon won't auto-start on boot" ;;
  *)      fail "Unsupported OS: $OS"; exit 1 ;;
esac

# git
if command -v git >/dev/null 2>&1; then
  success "git $(git --version | cut -d' ' -f3)"
else
  fail "git not found — install it first"; exit 1
fi

# Node.js >= 22 (search version managers, not just PATH)
NODE22=""
NPM22=""
if resolve_node22; then
  NODE_VERSION=$("$NODE22" --version)
  success "Node.js $NODE_VERSION ($NODE22)"
else
  # Show what's in PATH for diagnostics
  if command -v node >/dev/null 2>&1; then
    fail "Node.js >= 22 required (found $(node --version) in PATH)"
    info "Node 22 not found in nvm, fnm, or Homebrew either"
  else
    fail "Node.js not found"
  fi
  info "Install via: https://nodejs.org or nvm install 22"
  exit 1
fi

# npm (from same prefix as resolved node)
if [ -x "$NPM22" ]; then
  success "npm $("$NPM22" --version) ($NPM22)"
else
  fail "npm not found next to $NODE22"; exit 1
fi

# Claude CLI (optional)
if command -v claude >/dev/null 2>&1; then
  success "Claude CLI found"
else
  warn "Claude CLI not found (install later from https://claude.ai)"
fi

# jq (optional, used by hooks)
if command -v jq >/dev/null 2>&1; then
  success "jq $(jq --version 2>/dev/null | sed 's/jq-//')"
else
  warn "jq not found (optional, used by conversation hooks)"
fi

# ── Phase 2: Clone or Update ─────────────────────────────────────────────────

step "2/7" "$([ "$IS_UPGRADE" = true ] && echo 'Updating repository...' || echo 'Cloning repository...')"

if [ "$IS_UPGRADE" = true ]; then
  # Upgrade: fetch and checkout
  stop_shadow_daemon
  info "Stopped daemon for upgrade"

  cd "$SHADOW_APP"
  git fetch --tags origin 2>/dev/null

  if [ -n "$BRANCH" ]; then
    git fetch origin "$BRANCH" 2>/dev/null
    git checkout "$BRANCH" 2>/dev/null
    git pull origin "$BRANCH" 2>/dev/null
    success "Updated to branch $BRANCH"
  else
    LATEST_TAG=$(git tag -l 'v*' | latest_semver_tag || true)
    if [ -n "$LATEST_TAG" ]; then
      git checkout "$LATEST_TAG" 2>/dev/null
      success "Updated to $LATEST_TAG"
    else
      git checkout main 2>/dev/null
      git pull origin main 2>/dev/null
      success "Updated to main (no release tags found)"
    fi
  fi
else
  # Fresh install: clone
  mkdir -p "$SHADOW_HOME"

  # Determine clone URL: HTTPS by default (works for public-repo installers
  # with no SSH key). Opt into SSH-first via SHADOW_PREFER_SSH=1 — handy if you
  # already have a key registered and want push access out of the box.
  CLONE_URL="$REPO_HTTPS"
  if [ "${SHADOW_PREFER_SSH:-}" = "1" ]; then
    SSH_OUTPUT=$(ssh -T -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new git@github.com 2>&1 || true)
    if echo "$SSH_OUTPUT" | grep -qi "successfully authenticated"; then
      CLONE_URL="$REPO_SSH"
      info "Using SSH (SHADOW_PREFER_SSH=1): $REPO_SSH"
    else
      info "SSH probe failed, falling back to HTTPS: $REPO_HTTPS"
    fi
  else
    info "Using HTTPS: $REPO_HTTPS (set SHADOW_PREFER_SSH=1 to clone via SSH)"
  fi

  git clone --depth 1 "$CLONE_URL" "$SHADOW_APP" 2>/dev/null

  cd "$SHADOW_APP"

  # Unshallow to get tags
  git fetch --tags --unshallow 2>/dev/null || git fetch --tags 2>/dev/null || true

  if [ -n "$BRANCH" ]; then
    git fetch origin "$BRANCH" 2>/dev/null
    git checkout "$BRANCH" 2>/dev/null
    success "Cloned to ~/.shadow/app (branch: $BRANCH)"
  else
    LATEST_TAG=$(git tag -l 'v*' | latest_semver_tag || true)
    if [ -n "$LATEST_TAG" ]; then
      git checkout "$LATEST_TAG" 2>/dev/null
      success "Cloned to ~/.shadow/app ($LATEST_TAG)"
    else
      success "Cloned to ~/.shadow/app (main — no release tags)"
    fi
  fi
fi

# ── Phase 3: Dependencies ────────────────────────────────────────────────────

step "3/7" "Installing dependencies..."

cd "$SHADOW_APP"
"$NPM22" install --loglevel=error 2>&1 | tail -1 || true
success "Root dependencies installed"

"$NPM22" run dashboard:install --loglevel=error 2>&1 | tail -1 || true
success "Dashboard dependencies installed"

# ── Phase 4: Build ────────────────────────────────────────────────────────────

step "4/7" "Building..."

cd "$SHADOW_APP"
"$NPM22" run build 2>&1 | tail -3 || { fail "Build failed"; exit 1; }
success "TypeScript compiled + dashboard built"

# ── Phase 5: CLI wrapper + PATH ───────────────────────────────────────────────

step "5/7" "Setting up CLI..."

mkdir -p "$SHADOW_BIN"

# Create wrapper script that resolves Node >= 22 across version managers
cat > "$SHADOW_BIN/shadow" << 'WRAPPER'
#!/bin/bash
# Resolve Node >= 22 — check common version managers, then fall back to PATH
NODE=""

# nvm (XDG layout: ~/.local/share/nvm)
if [ -z "$NODE" ] && [ -d "$HOME/.local/share/nvm" ]; then
  for d in "$HOME/.local/share/nvm"/v22.*/bin/node; do
    [ -x "$d" ] && NODE="$d" && break
  done
fi

# nvm (classic layout: ~/.nvm)
if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  for d in "$HOME/.nvm/versions/node"/v22.*/bin/node; do
    [ -x "$d" ] && NODE="$d" && break
  done
fi

# fnm
if [ -z "$NODE" ] && command -v fnm >/dev/null 2>&1; then
  for d in "$HOME/Library/Application Support/fnm/node-versions"/v22.*/installation/bin/node; do
    [ -x "$d" ] && NODE="$d" && break
  done
fi

# Homebrew
if [ -z "$NODE" ]; then
  for d in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node; do
    [ -x "$d" ] && NODE="$d" && break
  done
fi

# Fallback to PATH
if [ -z "$NODE" ]; then
  NODE="$(command -v node)"
fi

if [ -z "$NODE" ]; then
  echo "Error: Node.js not found. Install Node.js >= 22." >&2
  exit 1
fi

exec "$NODE" "$HOME/.shadow/app/dist/cli.js" "$@"
WRAPPER
chmod +x "$SHADOW_BIN/shadow"
success "Created ~/.shadow/bin/shadow"

# Add to PATH based on user's shell
USER_SHELL="${SHELL:-/bin/bash}"
PATH_ADDED=false

case "$USER_SHELL" in
  */fish)
    add_to_path "$HOME/.config/fish/config.fish" 'fish_add_path -g ~/.shadow/bin'
    success "Added ~/.shadow/bin to PATH in config.fish"
    PATH_ADDED=true
    ;;
  */zsh)
    add_to_path "$HOME/.zshrc" 'export PATH="$HOME/.shadow/bin:$PATH"'
    success "Added ~/.shadow/bin to PATH in .zshrc"
    PATH_ADDED=true
    ;;
  */bash)
    add_to_path "$HOME/.bashrc" 'export PATH="$HOME/.shadow/bin:$PATH"'
    success "Added ~/.shadow/bin to PATH in .bashrc"
    # macOS uses .bash_profile for login shells
    if [ "$OS" = "Darwin" ]; then
      add_to_path "$HOME/.bash_profile" 'export PATH="$HOME/.shadow/bin:$PATH"'
    fi
    PATH_ADDED=true
    ;;
  *)
    add_to_path "$HOME/.profile" 'export PATH="$HOME/.shadow/bin:$PATH"'
    success "Added ~/.shadow/bin to PATH in .profile"
    PATH_ADDED=true
    ;;
esac

# Make shadow available in current session too
export PATH="$SHADOW_BIN:$PATH"

# ── Phase 6: Initialize ──────────────────────────────────────────────────────

step "6/7" "Initializing Shadow..."

# Run shadow init non-interactively (stdin closed → auto-accepts all prompts)
cd "$SHADOW_APP"
"$NODE22" dist/cli.js init < /dev/null 2>&1 | while IFS= read -r line; do
  case "$line" in
    *"already up to date"*|*"skipped"*) info "$line" ;;
    *"added"*|*"updated"*|*"installed"*|*"started"*) success "$line" ;;
    *) info "$line" ;;
  esac
done
success "Shadow initialized"

# ── Phase 7: Verify ──────────────────────────────────────────────────────────

if [ "$NO_DAEMON" = true ]; then
  step "7/7" "Skipping daemon start (--no-daemon)"
  info "Start manually with: shadow daemon start"
else
  step "7/7" "Verifying daemon..."

  # Wait a moment for daemon to be ready
  sleep 2

  if curl -sf http://localhost:3700/api/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' >/dev/null 2>&1; then
    success "Daemon running on port 3700"
  else
    warn "Daemon not responding yet — it may take a few seconds"
    info "Check with: shadow daemon status"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

VERSION=$("$NODE22" -e "console.log(JSON.parse(require('fs').readFileSync('$SHADOW_APP/package.json','utf8')).version)" 2>/dev/null || echo "unknown")

printf "\n"
printf "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"
if [ "$IS_UPGRADE" = true ]; then
  printf "  ${BOLD}🌑 Shadow v%s upgraded!${RESET}\n" "$VERSION"
else
  printf "  ${BOLD}🌑 Shadow v%s installed!${RESET}\n" "$VERSION"
fi
printf "\n"
if [ "$PATH_ADDED" = true ]; then
  printf "  Restart your terminal, then:\n"
else
  printf "  Next:\n"
fi
printf "    ${DIM}claude${RESET} → ${DIM}\"Shadow, que tal?\"${RESET}\n"
printf "\n"
printf "  Dashboard: ${BLUE}http://localhost:3700${RESET}\n"
printf "  Upgrade:   ${DIM}shadow upgrade${RESET}\n"
printf "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n\n"
