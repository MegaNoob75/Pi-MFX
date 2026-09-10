# Sourced by install.sh and update.sh. Not run on its own.
#
# The clone is owned by whoever set this Pi up (the login that git clone'd it),
# never a hardcoded username and never root leftover from sudo cmake/npm.

clone_owner() {
    CLONE_OWNER="$(stat -c %U "$REPO_DIR" 2>/dev/null || true)"
    CLONE_GROUP="$(stat -c %G "$REPO_DIR" 2>/dev/null || true)"
    if [[ -z "$CLONE_OWNER" || "$CLONE_OWNER" == "root" ]]; then
        if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
            CLONE_OWNER="$SUDO_USER"
        else
            CLONE_OWNER="$(awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }' /etc/passwd)"
        fi
        CLONE_GROUP="$(id -gn "$CLONE_OWNER" 2>/dev/null || printf '%s' "$CLONE_OWNER")"
    fi
}

as_clone_owner() {
    if [[ -n "${CLONE_OWNER:-}" && "$CLONE_OWNER" != "root" ]] && id "$CLONE_OWNER" >/dev/null 2>&1; then
        sudo -u "$CLONE_OWNER" env HOME="$(getent passwd "$CLONE_OWNER" | cut -d: -f6)" "$@"
    else
        "$@"
    fi
}

ensure_clone_writable() {
    clone_owner
    [[ -n "${CLONE_OWNER:-}" && "$CLONE_OWNER" != "root" ]] || return 0
    # After the first npm/cmake update, node_modules and engine/build are huge.
    # Recursively chowning them stalls SSH before any "==>" line. Skip when the
    # clone is already owned by the login that git uses.
    local owner
    owner="$(stat -c %U "$REPO_DIR" 2>/dev/null || true)"
    if [[ "$owner" == "$CLONE_OWNER" ]]; then
        return 0
    fi
    printf '\033[1;36m==>\033[0m Fixing clone owner (%s); not walking node_modules or build\n' "$CLONE_OWNER"
    chown "$CLONE_OWNER:$CLONE_GROUP" "$REPO_DIR" || true
    find "$REPO_DIR" -xdev \
        \( -path '*/node_modules' -o -path '*/engine/build' -o -path '*/.git/objects' \) -prune \
        -o -user root -exec chown "$CLONE_OWNER:$CLONE_GROUP" {} + 2>/dev/null || true
}
