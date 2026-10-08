# PaperChat

Read papers and ask questions beside them in Safari. PaperChat uses your own eligible ChatGPT plan and saves compressed conversations and source links locally. Paper text, PDF bytes and figure attachments stay in memory during the reading session.

PaperChat's own source is MIT licensed. You can inspect, modify and redistribute it, including with Codex. Bundled dependencies retain their own licenses; see [NOTICE.md](NOTICE.md) and [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Download and get started

The [V1.0 release](https://github.com/daweiliu94/PaperChat/releases/tag/V1.0) contains the prebuilt app and its SHA-256 checksum. The native app requires **an Apple Silicon Mac and macOS 14 or newer**. Use current Safari: this build was tested on **Safari 27**. Safari below 26.4 is unsupported because the PDF reader uses newer JavaScript APIs; older-than-tested versions still need beta testing. The ZIP also contains third-party notices and the source archive for its bundled Liberation fonts. Keep these with redistributed packages. You do not need Xcode, an API key or your own signing certificate to use the prebuilt app.

This is a development beta. Safari requires **Allow unsigned extensions**, which resets when Safari quits. macOS may require a one-time approval in Privacy & Security before the downloaded app can run. Keep those protections enabled and approve the app through the normal system dialogs.

For help from Codex, paste:

> Inspect https://github.com/daweiliu94/PaperChat and read CODEX_SETUP.md. Download the prebuilt V1.0 release, verify its checksum, and help me install and register PaperChat in Safari. Keep normal startup quiet. Guide me through the required macOS/Safari approvals, choosing my own local history folder and connecting my own ChatGPT account.

See [CODEX_SETUP.md](CODEX_SETUP.md) for the installation steps. The helper starts quietly on demand. **Chat options (⋯) → Setup** explicitly opens its configuration window; closing it returns the helper to quiet operation. Keep PaperChat.app installed because it provides Keychain login and history-folder access.

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

V1.0 is the requested GitHub milestone for the current working implementation. Its embedded app/package version remains **0.1.3/build 4**. JavaScript tests, strict typecheck, native tests and sandboxed peer checks pass; earlier live Safari 27 verification covered synthetic article/PDF reading, saved-chat restoration, reasoning, citations and History navigation. Installation on another Mac and older Safari versions remain beta-test steps.
