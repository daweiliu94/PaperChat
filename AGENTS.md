# PaperChat contributor notes

PaperChat is a Safari extension with a sandboxed Swift companion. Follow the user's local workspace instructions and keep edits focused on the requested behavior.

- Preserve quiet helper startup; show Setup only when explicitly invoked.
- Save only conversation messages and source metadata. Keep PDFs, full paper text, images, indexes and assembled requests in memory.
- Keep OAuth credentials in Keychain. Never inspect or print real user histories, tokens, bookmarks, private keys or account data during development. Use synthetic fixtures.
- Preserve both sandboxes, audit-token peer verification and certificate-pinned app/extension identities. Rebuild both native components together after signing changes.
- `npm test` and `npm run typecheck` are the web checks. `bash scripts/test-native.sh` uses disposable native fixtures. `python3 scripts/test-sandbox-peers.py` refreshes generated signing/Xcode configuration and tests signed sandboxed peers in disposable bundles.
- `npm run build` installs over `/Applications/PaperChat.app` and writes `../../outputs/PaperChat.zip`. Before running it, confirm installation is intended, retain a rollback package and avoid interrupting an active reply. Never migrate or delete user history as part of a build.
- For releases, review source/package contents and run relevant checks before committing or publishing. Keep histories, credentials, dependencies and build scratch files out of Git. Obtain independent review for authentication, peer verification or release-bound changes.
- Keep THIRD_PARTY_NOTICES.txt and the bundled fonts' corresponding source archive in release ZIPs. Review matching license/source requirements when updating PDF.js or its bundled dependencies; third_party/ contains intentionally vendored font sources.
