# Pi-MFX remote access

Open Pi-MFX from a PC or tablet. On first use, the browser offers **Set Password**;
enter and confirm a password of 4 to 128 characters. Do first setup on your own
network or the Pi hotspot: the first person to complete setup sets the password.
The Pi touchscreen also provides **Settings → System → Remote Access Password**.
This is independent of
Wi-Fi, hotspot, SSH, and TONE3000 credentials.

Remote access is locked until a password is set. Phones and computers see a
login page before they can load Pi-MFX. The check also covers API calls,
downloads, uploads, and WebSocket connections. The local touchscreen stays
unlocked when it uses the kiosk's `http://127.0.0.1:<port>/?kiosk=1` address.
Changing a remote browser URL to `?kiosk=1` does not bypass authentication.

Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes (600,000 iterations)
in `/var/lib/pimfx/access.json`, with owner-only file permissions. They are not
put into engine settings, shared browser state, or exported setup profiles.
Browser sessions use an HttpOnly, SameSite=Lax cookie and have no Pi-MFX time
expiry, including across Pi restarts. Only token hashes are saved on the Pi.
Cookies are refreshed on use; browser cookie retention limits can still require
another login after prolonged inactivity. **Lock This Browser** forgets that browser;
changing the password logs out and forgets all remote browsers.
The server stores at most 32 remembered browser tokens. If that limit is
reached, lock an existing browser or change the password to forget all tokens;
clearing cookies alone does not remove their saved hashes from the Pi.
Use the same hostname (for example `pimfx.local`) each time: browser cookies
are specific to the hostname or IP used. Clearing cookies, using private
browsing, or switching browsers requires signing in again.
Signed-in remote users can change the password under **Settings → System** by
entering the current password. A signed-in session alone cannot replace it.
Use the Pi touchscreen to recover from a forgotten password. Without a
touchscreen, an administrator with SSH access can remove `/var/lib/pimfx/access.json`
and restart the Pi-MFX service to reopen first-time setup; complete setup on a
trusted network immediately. Invalid or unreadable password files keep remote
access locked instead of reopening setup.

**Transport limitation:** the server still uses HTTP and does not encrypt
passwords, session cookies, or audio/control data in transit. Password access
control is not sufficient protection against someone intercepting traffic on
an untrusted network. HTTPS or an encrypted private tunnel is required for
that threat. Do not forward the HTTP port to the internet.

## Pi validation

1. Before setting a password, verify the kiosk works and a remote browser offers
   first-time password setup. Unauthenticated `/api/state` and `/ws` must return HTTP 401.
2. Set a password remotely. Enter a wrong password remotely, then
   verify a correct password unlocks the app (wait if retry throttling applies).
3. Check remote controls, meters, uploads, and downloads after signing in.
4. Change the password on the touchscreen: existing remote browsers should
   return to login and require the new password. The kiosk stays unlocked.
   Also test changing it remotely with the current password; a wrong or missing
   current password must be rejected, and old sessions must be revoked.
5. Restart Pi-MFX and reopen the same browser using the same hostname: it should
   stay signed in. Lock that browser, restart again, and verify it stays locked.
6. Try an unauthenticated request with `?kiosk=1` or a forged loopback forwarded
   header. Both must remain locked.
7. With `BUILD_TESTING=ON`, run the `access_control` CTest test. It exercises
   first setup, hashing persistence, spoofed kiosk/origin requests, authenticated
   HTTP/WebSocket admission, password-change revocation, logout, and throttling.

The installer installs `libssl-dev`; the updater installs it if missing.
No build or runtime validation was performed on Windows.
Track results for the exact release candidate in
[V1_READINESS.md](V1_READINESS.md); the checklist above remains pending until
run on that Pi build.
