# PaperChat 0.1.4 — development beta

This release publishes the existing Safari app, version **0.1.4/build 5**, unchanged. It includes the viewport and stream replay fixes applied locally after V1.0. The original V1.0 release remains available with version 0.1.3/build 4.

## Download and install

Download `PaperChat-0.1.4-macOS-arm64.zip` and `SHA256SUMS` from the [v0.1.4 release](https://github.com/daweiliu94/PaperChat/releases/tag/v0.1.4), then follow [CODEX_SETUP.md](https://github.com/daweiliu94/PaperChat/blob/v0.1.4/CODEX_SETUP.md).

ZIP SHA-256: `56cd4209365adffe910c5f0b01d3f9f2e9ed2562a7ec4dbf000e1ffd51c030b2`.

- Apple Silicon Mac, macOS 14+ and current Safari. Safari below 26.4 is unsupported; original live coverage used Safari 27.
- Development-signed beta, not notarized. Complete required macOS approvals and Safari's Allow unsigned extensions setting manually. That Safari setting resets after Safari quits.
- Use your own eligible ChatGPT account and your own history folder. Normal helper startup stays quiet; Chat options (⋯) → Setup explicitly opens configuration.
- The ZIP contains the required third-party notices and matching Liberation font source archive. Retain them with redistributed copies. No user histories, configured folder bookmarks or credentials are included.

## Changes

- Article and PDF panels follow the visible viewport during resizing and magnification. Controls wrap, short windows use compact spacing, and wide tables/code scroll within replies.
- Preserve event identity and ignore replayed native/identified upstream events within each request. Distinct events containing repeated words remain intact.
- Updated installation guidance includes the extension restart recovery step for a toolbar that stops responding after an app update. This release does not change toolbar initialization code to fix that incident.
- [CODEX_CHROME.md](https://github.com/daweiliu94/PaperChat/blob/v0.1.4/CODEX_CHROME.md) gives a task prompt for generating a separate Chrome extension and native host. The downloadable app supports Safari; a Chrome build is not included.

## Verification and limits

The current source passes JavaScript tests, strict TypeScript checking, disposable native tests and signed sandboxed peer positive/negative checks. Synthetic browser tests exercise layout and duplicate stream delivery. The release ZIP matches the installed app, and app/extension deep-strict signatures, identifiers, version, sandbox entitlements and redistribution notices are checked before publication.

The latest authenticated Safari streaming path and installation on a fresh Mac have not been exercised. Replays without upstream sequence identity cannot be distinguished from intentional repeated text. Existing duplicated replies are not rewritten, and histories or account stores are not migrated. The earlier V1.0 live Safari checks remain historical coverage, not proof of a fresh-Mac installation of this release.
