# OpenSSL Crypto

Pi-MFX uses OpenSSL's Crypto component for remote-access password hashing,
secure random generation, and constant-time credential comparison. The engine
build requires `OpenSSL::Crypto`; this does not make Pi-MFX's HTTP server HTTPS.

The [official OpenSSL license page](https://openssl-library.org/source/license/index.html)
states that releases from 3.0 onward use Apache License 2.0. That license text
is included as [Apache-2.0.txt](Apache-2.0.txt). Releases before 3.0 use the
older OpenSSL/SSLeay terms; do not apply this 3.x description to such a build.

Before distributing a binary, record the OpenSSL version actually linked and
include its applicable upstream/package copyright notices and license files.
This inventory note was checked on 2026-10-14; the target Pi's linked version
was not inspected during the static review.
