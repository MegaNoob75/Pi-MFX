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
    if [[ -n "${CLONE_OWNER:-}" && "$CLONE_OWNER" != "root" ]]; then
        chown -R "$CLONE_OWNER:$CLONE_GROUP" "$REPO_DIR"
    fi
}
