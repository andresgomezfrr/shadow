#!/usr/bin/env bash
# Instala un pre-commit hook que ejecuta gitleaks sobre el staged diff.
# Uso: bash scripts/install-gitleaks-hook.sh
# Requisito: gitleaks instalado (brew install gitleaks) — https://github.com/gitleaks/gitleaks

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-commit"

if ! command -v gitleaks &>/dev/null; then
  echo "error: gitleaks no está instalado. Instala con 'brew install gitleaks' (macOS) o ver https://github.com/gitleaks/gitleaks" >&2
  exit 1
fi

if [ -f "$HOOK_PATH" ] && ! grep -q "shadow-gitleaks-hook" "$HOOK_PATH"; then
  echo "error: ya existe un pre-commit hook en $HOOK_PATH (no es de Shadow). Renómbralo o fusiona manualmente." >&2
  exit 1
fi

cat >"$HOOK_PATH" <<'EOF'
#!/usr/bin/env bash
# shadow-gitleaks-hook v1
# Instalado por scripts/install-gitleaks-hook.sh
set -euo pipefail
exec gitleaks protect --staged --no-banner --redact --config "$(git rev-parse --show-toplevel)/.gitleaks.toml"
EOF

chmod +x "$HOOK_PATH"
echo "Installed gitleaks pre-commit hook at $HOOK_PATH"
echo "Test: stage a file with 'sk-ant-' prefix and try to commit — debería fallar."
