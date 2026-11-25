# Python's empty trust store, and its repair

A python.org macOS build (`/Library/Frameworks/Python.framework/Versions/3.12`) ships an OpenSSL
trust store folder with no `cert.pem` in it. `ssl.create_default_context()` then loads 0 CAs, and every
HTTPS request made by a bot's `python3` script fails with `CERTIFICATE_VERIFY_FAILED`, including the
`ip_api.py` skill that a short-drama project uses for coverage rows.

## What the fault looked like

`python3 -c "import ssl; print(ssl.create_default_context().cert_store_stats())"` answered
`{'x509': 0, 'crl': 0, 'x509_ca': 0}`, and `get_default_verify_paths().cafile` named
`.../3.12/etc/openssl/cert.pem`, which did not exist. The folder itself is `drwxrwxr-x root:admin`, so a
user in the `admin` group can write it without `sudo`.

Writing certifi's `cacert.pem` (234,354 bytes) there gave `{'x509': 118, 'crl': 0, 'x509_ca': 118}`,
`https://hot-video-pro.hongmaocy.com/api/open/ip/coverage` answered `code 1000` with `ip_rows 94674`, and
the skill's `ip_api.py meta` ran again.

## What the app does

`server/python-trust.ts` probes the interpreter with one short process and no network: it reads
`ssl.get_default_verify_paths()` and `cert_store_stats()`, and answers `ok`, `empty` (0 CAs) or `unknown`.
`primePythonTrust` probes once at server start and logs the outcome to `logs/python-trust.log`.

On `empty` it writes a bundle into the interpreter's own `etc/openssl/cert.pem`, trying sources in this
order: `certifi.where()`, `/etc/ssl/cert.pem`, another Python version's framework bundle, then Node's
`tls.rootCertificates`. The write goes through `writeFileAtomic`, is verified by loading the written file
and counting its certificates, and is rolled back when the count is 0. A store that already holds a
certificate is never rewritten.

`spawnCli` gives every bot engine (and the bot's other work) `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE`
pointing at the chosen bundle, so Python, `requests` and `curl` all trust it. A value the person already
set is kept. When the folder is not writable, or the interpreter cannot be probed, the repair reports
`degraded: true` and the variable carries the bot; nothing fails and no task stops.

## Why there is no sudo

The repair runs as the person, with their permissions, at server start. Escalating would prompt for a password outside the app's window, write to a system location the person did not choose, and outlive the app if it is uninstalled. The variable is enough for a bot to work; a person who wants the store itself fixed can copy a bundle in as above.
