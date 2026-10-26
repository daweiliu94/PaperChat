# PaperChat

Read papers and ask questions beside them in Safari. PaperChat uses your own eligible ChatGPT plan and saves compressed conversations and source links locally. Paper text, PDF bytes and figure attachments stay in memory during the reading session.

PaperChat's own source is MIT licensed. You can inspect, modify and redistribute it, including with Codex. Bundled dependencies retain their own licenses; see [NOTICE.md](NOTICE.md) and [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Download and get started

The [0.1.4 release](https://github.com/daweiliu94/PaperChat/releases/tag/v0.1.4) contains the prebuilt app and its SHA-256 checksum. The native app requires **an Apple Silicon Mac and macOS 14 or newer**. Use current Safari: the original live tests used **Safari 27**. Safari below 26.4 is unsupported because the PDF reader uses newer JavaScript APIs; older-than-tested versions still need beta testing. The ZIP also contains third-party notices and the source archive for its bundled Liberation fonts. Keep these with redistributed packages. You do not need Xcode, an API key or your own signing certificate to use the prebuilt app.

This is a development beta. Safari requires **Allow unsigned extensions**, which resets when Safari quits. macOS may require a one-time approval in Privacy & Security before the downloaded app can run. Keep those protections enabled and approve the app through the normal system dialogs.

For help from Codex, paste:

> Inspect https://github.com/daweiliu94/PaperChat/tree/v0.1.4 and read CODEX_SETUP.md at that tag. Download the prebuilt v0.1.4 release, verify its checksum, and help me install and register PaperChat in Safari. Keep normal startup quiet. Guide me through the required macOS/Safari approvals, choosing my own local history folder and connecting my own ChatGPT account.

See [CODEX_SETUP.md](CODEX_SETUP.md) for the installation steps. The helper starts quietly on demand. **Chat options (⋯) → Setup** explicitly opens its configuration window; closing it returns the helper to quiet operation. Keep PaperChat.app installed because it provides Keychain login and history-folder access.

If you prefer Chrome, [CODEX_CHROME.md](CODEX_CHROME.md) provides a Codex task prompt for generating a Chrome version from this source. The downloadable 0.1.4 app supports Safari; a Chrome extension and native messaging host still need to be implemented, reviewed and tested locally.

Each user connects their own eligible ChatGPT Plus or Pro account. Usage follows that account's allowance; review credit-overage settings through Manage usage. PaperChat has no separate subscription fee. [Official OpenAI documentation](https://developers.openai.com/siwc/quickstart) explains account eligibility and plan usage.

## Features and storage

- Article sidebar and PDF reader, with automatic paper context, selection and optional figure questions.
- Model and reasoning menus, streamed answers, compact citations and source jumps.
- History navigation, Markdown export and explicit chat deletion.
- One gzip JSON conversation per source in the chosen project's `history/` folder. History contains messages, timestamps and source metadata, including quotations in replies.
- No persistent source PDFs, extracted paper text, images, retrieval indexes or assembled prompts. Safari and macOS manage their own caches separately.

The source and release contain no user's history, credentials or configured history-folder bookmark. OAuth credentials belong in each user's macOS Keychain. New questions reload the original paper to rebuild context.

## Modify with Codex or build locally

Clone this repository into a durable project directory and open it in Codex. The source is in `extension/` and `native/`; follow [AGENTS.md](AGENTS.md). Changing your local copy does not change the upstream repository.

For the existing scripts, use the layout `YourProject/working/PaperChat/` for this checkout. Build artifacts go to `YourProject/outputs/`. Install Node.js/npm and Xcode, and create your own Apple Development signing certificate in Xcode before building. Do not share a signing private key. The build regenerates the public certificate pin and team-specific App Group for the app and extension together.

```sh
npm ci
npm test
npm run typecheck
bash scripts/test-native.sh
python3 scripts/test-sandbox-peers.py
```

**`npm run build` also replaces `/Applications/PaperChat.app`, registers its extension and writes `../../outputs/PaperChat.zip`.** Run it only when you intend to install your modified build, after preserving a rollback package and ensuring PaperChat is idle. The sandbox-peer check also refreshes generated signing/Xcode configuration and uses disposable signed fixtures.

The **v0.1.4** release publishes the existing **0.1.4/build 5** app unchanged, including visible-viewport docking and stream replay suppression. Its ZIP SHA-256 is `56cd4209365adffe910c5f0b01d3f9f2e9ed2562a7ec4dbf000e1ffd51c030b2`. The earlier V1.0 milestone remains available with version 0.1.3/build 4.

JavaScript, strict typecheck, disposable native and sandboxed peer checks cover this source. Synthetic browser checks cover the layout and stream replay fixes. Earlier live Safari 27 verification covered article/PDF reading, saved-chat restoration, reasoning, citations and History navigation; the latest authenticated Safari streaming path and installation on a fresh Mac have not been exercised. See [RELEASE_NOTES.md](RELEASE_NOTES.md) for scope and limitations.
