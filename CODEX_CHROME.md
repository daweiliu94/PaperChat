# Generate a Chrome version with Codex

The v0.1.4 download is the Safari reference app. This repository does not yet ship a Chrome extension or a Chrome native messaging host. Chrome support requires a local implementation, signing arrangement and browser testing; loading the Safari manifest in Chrome is insufficient.

Copy the following task into Codex on the recipient's Mac:

```text
Install PaperChat 0.1.4 for Safari as a working reference, then generate, test and help me install a Chrome version on my Mac. Chrome is my preferred browser. Complete both the browser extension and native host implementation; use the existing code and UI as the reference.

Source: https://github.com/daweiliu94/PaperChat/tree/v0.1.4
Release: https://github.com/daweiliu94/PaperChat/releases/tag/v0.1.4

Read AGENTS.md, CODEX_SETUP.md and CODEX_CHROME.md at tag v0.1.4. Follow my workspace instructions. Download PaperChat-0.1.4-macOS-arm64.zip and SHA256SUMS. The ZIP must have SHA-256:
56cd4209365adffe910c5f0b01d3f9f2e9ed2562a7ec4dbf000e1ffd51c030b2

Check Mac/browser compatibility, verify the ZIP and both signed bundles, and install/register the Safari reference using CODEX_SETUP.md. Expected app and extension version: 0.1.4/build 5. Preserve any existing installation and user data with rollback before replacement. Let me complete security approvals and my own ChatGPT login. Select my own local history folder. Keep normal helper startup quiet.

For Chrome, clone/check out tag v0.1.4 into a separate durable local project and read the current official Chrome extension documentation. Implement Manifest V3 with an extension service worker and a compatible browser API adapter. Reuse the sidebar, PDF reader, citations, model/reasoning controls, figure capture, History and stream replay handling. Handle worker suspension/reconnection without duplicating requests or losing already received text. Keep transient paper/PDF/image/request context in memory, including during worker recovery.

Implement a macOS Chrome native messaging host with the correct length-prefixed JSON stdin/stdout protocol, clean stdout, an absolute executable path, and a host manifest in Chrome's supported per-user location. Restrict allowed_origins to the actual extension ID and validate the invoking origin. Use runtime.connectNative with a persistent port for streamed events and cancellation; runtime.sendNativeMessage returns only the first host response. Provide install/uninstall instructions scoped to this Chrome port. Include streaming replies and cancellation, not just one-shot native RPC.

Inspect the Safari-specific native code before choosing the Chrome architecture. The released helper authenticates its Safari extension by code-signing identity and certificate pin and sends events through SafariServices. A newly built Chrome host cannot simply attach to that immutable helper. Build a separate, properly authenticated Chrome host/companion pair with its own bundle IDs, app group and history folder, using my own local signing identity when needed. Preserve the Safari app and both Safari sandboxes. Do not bypass peer verification, copy someone else's signing private key, expose a general localhost service, scrape browser cookies or move credentials into extension storage. Use my own account connection with credentials in Keychain. Avoid modifying authentication behavior unless required by the new platform and independently reviewed. If an official account-client registration is required, explain the exact prerequisite rather than inventing one or falling back to an API key.

Use synthetic article/PDF and message fixtures for development. Persist only chat messages and sanitized source metadata; preserve the app's existing storage/privacy behavior. Test toolbar opening, paper extraction, PDF/figure handling, streaming and duplicate delivery, cancellation, History restoration and worker restart/reconnect. Obtain independent review of native messaging, signing and account boundaries. Then guide me through Chrome Developer mode → Load unpacked, native host registration and my own login. Verify the actual Chrome flow before reporting success and identify any account-dependent check I must complete myself.

Deliver the generated Chrome source, reproducible build instructions, extension directory/ZIP, native host installer and a concise verification report. Keep my Safari reference installation usable. Do not publish or push my Chrome port without a separate request.
```

Primary Chrome documentation:

- [Manifest V3 service workers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers)
- [Native messaging protocol and macOS host registration](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
