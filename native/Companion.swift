import SwiftUI
import AppKit
import SafariServices
import Security

@MainActor final class CompanionModel: ObservableObject {
    @Published var connected = false
    @Published var email = ""
    @Published var message = "Choose your history folder, then connect ChatGPT."
    @Published var busy = false
    @Published var historyPath = "Not selected"
    @Published var bridgeReady = false
    @Published var profiles: [[String: String]] = []
    let auth = ChatGPTService()
    let history = HistoryStore()
    private var bridge: SocketBridge?
    private var jobs: [String: Task<Void, Never>] = [:]
    private var instanceID = UUID().uuidString

    init() {
        historyPath = history.location ?? "Not selected"
        do {
            let path = try bridgeDirectory().appendingPathComponent("bridge.sock")
            bridge = try SocketBridge(path: path, expectedRequirement: paperChatPeerRequirement(paperChatExtensionID)) { [weak self] data, reply in
                guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { reply(encodeReply(["ok": false, "error": "Invalid local request."])); return }
                Task { @MainActor [weak self] in
                    guard let self else { reply(encodeReply(["ok": false, "error": "The app closed."])); return }
                    do { reply(encodeReply(try await self.handle(object))) }
                    catch { reply(encodeReply(["ok": false, "error": error.localizedDescription])) }
                }
            }
            bridgeReady = true
        } catch { message = error.localizedDescription }
        Task { await updateAccount() }
    }
    func updateAccount() async {
        let value = await auth.status()
        connected = value["connected"] as? Bool ?? false
        email = value["email"] as? String ?? ""
        profiles = value["profiles"] as? [[String: String]] ?? []
    }
    func signIn(newAccount: Bool = false, profile: String? = nil) {
        guard !busy else { return }
        cancelAll(); busy = true; message = "Finish signing in and granting plan access in your browser."
        Task {
            defer { busy = false }
            do {
                email = try await auth.signIn(newAccount: newAccount, profile: profile)
                await updateAccount()
                let models = try await auth.models()
                guard !models.isEmpty else { throw PCError.message("Sign-in succeeded, but no available models were returned.") }
                message = "Connected. Requests use your ChatGPT plan. Review the app's limits in Manage usage; disable credit overage there."
            } catch { await updateAccount(); message = error.localizedDescription }
        }
    }
    func signOut() {
        cancelAll(); busy = true
        Task {
            defer { busy = false }
            do {
                let revoked = try await auth.signOut(); await updateAccount()
                message = revoked ? "Signed out." : "Signed out locally. Remote revocation was not confirmed; disconnect PaperChat in ChatGPT settings."
            } catch { message = error.localizedDescription }
        }
    }
    func chooseHistory() {
        NSApp.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.title = "Choose the PaperChat history project folder"
        panel.message = "Select 20261007_PaperChatHistory_001. Only compressed chats and source links will be saved in its history folder."
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: "/Users/daweiliu/Documents/Codex Projects/Workspace/01_ACTIVE_PROJECTS/20261007_PaperChatHistory_001")
        if panel.runModal() == .OK, let url = panel.url {
            do { try history.choose(url); historyPath = history.location ?? "Not selected"; message = "History folder ready. No paper files will be saved." }
            catch { message = error.localizedDescription }
        }
    }
    func safariSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: paperChatExtensionID) { [weak self] error in
            if error != nil { Task { @MainActor in self?.message = "Enable Safari Settings → Developer → Allow unsigned extensions (the Develop menu in older Safari), then enable PaperChat under Extensions." } }
        }
    }
    func cancelAll() { for task in jobs.values { task.cancel() }; jobs.removeAll() }
    func shutdown() {
        cancelAll(); bridge?.stop()
    }
    func handle(_ payload: [String: Any]) async throws -> [String: Any] {
        let action = payload["action"] as? String ?? ""
        switch action {
        case "openSetup":
            NotificationCenter.default.post(name: paperChatSetupRequested, object: nil)
            return ["ok": true]
        case "status":
            await updateAccount()
            return ["ok": true, "connected": connected, "email": email, "historyReady": history.location != nil,
                    "instance": instanceID, "bridgeReady": bridgeReady]
        case "models": return ["ok": true, "models": try await auth.models()]
        case "readHistory":
            guard let id = payload["id"] as? String else { throw PCError.message("Missing paper identifier.") }
            let value = try history.read(id)
            let object: Any = try value.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull()
            return ["ok": true, "conversation": object]
        case "saveHistory": return ["ok": true, "revision": try history.save(payload)]
        case "listHistory": return ["ok": true, "papers": try history.list()]
        case "deleteHistory":
            guard let id = payload["id"] as? String else { throw PCError.message("Missing paper identifier.") }
            try history.delete(id); return ["ok": true]
        case "export":
            guard let id = payload["id"] as? String, let conversation = try history.read(id) else { throw PCError.message("Save a conversation before exporting.") }
            NSApp.activate(ignoringOtherApps: true)
            let panel = NSSavePanel(); panel.nameFieldStringValue = "PaperChat conversation.md"
            if panel.runModal() == .OK, let url = panel.url {
                let markdown = "# \(conversation.paper.title)\n\nSource: \(conversation.paper.url)\n\n" + conversation.messages.map { "## \($0.role == "user" ? "You" : "Assistant")\n\n\($0.text)\n" }.joined(separator: "\n")
                try Data(markdown.utf8).write(to: url, options: .atomic)
            }
            return ["ok": true]
        case "cancel":
            if let id = payload["requestId"] as? String { jobs.removeValue(forKey: id)?.cancel() }
            return ["ok": true]
        case "chat":
            guard history.location != nil else { throw PCError.message("Choose the history folder in PaperChat first.") }
            guard let id = payload["requestId"] as? String, UUID(uuidString: id) != nil, jobs[id] == nil,
                  let body = payload["body"] as? [String: Any] else { throw PCError.message("Invalid chat request.") }
            let auth = self.auth
            jobs[id] = Task { [weak self] in
                do {
                    try await auth.respond(body: body) { event in Self.emit(id: id, event: event) }
                } catch {
                    if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { Self.emit(id: id, event: ["type": "cancelled"]) }
                    else { Self.emit(id: id, event: ["type": "error", "message": error.localizedDescription]) }
                }
                self?.jobs.removeValue(forKey: id)
            }
            return ["ok": true]
        default: throw PCError.message("Unknown PaperChat action.")
        }
    }
    nonisolated private static func emit(id: String, event: [String: Any]) {
        SFSafariApplication.dispatchMessage(withName: "paperchat.event", toExtensionWithIdentifier: paperChatExtensionID,
            userInfo: ["requestId": id, "event": identifiedStreamEvent(event)]) { _ in }
    }
}

struct CompanionView: View {
    @ObservedObject var model: CompanionModel
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { Image(systemName: "doc.text.magnifyingglass").font(.system(size: 34)).foregroundStyle(.teal); VStack(alignment: .leading) { Text("PaperChat").font(.largeTitle.bold()); Text("Read papers and ask questions in Safari").foregroundStyle(.secondary) } }
            GroupBox("1. History folder") {
                VStack(alignment: .leading, spacing: 10) { Text(model.historyPath).font(.system(.caption, design: .monospaced)).textSelection(.enabled); Button("Choose project folder…") { model.chooseHistory() }; Text("Only compressed conversations and links. Paper text and images stay in memory.").font(.caption).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            GroupBox("2. ChatGPT connection") {
                VStack(alignment: .leading, spacing: 10) {
                    if model.connected {
                        Text("Connected: \(model.email)")
                        HStack { Button("Sign out") { model.signOut() }; Button("Use another account") { model.signIn(newAccount: true) } }.disabled(model.busy)
                    } else { Button("Continue with ChatGPT") { model.signIn() }.disabled(model.busy) }
                    if !model.profiles.isEmpty {
                        Menu("Saved accounts") { ForEach(model.profiles, id: \.self) { profile in Button(profile["email"] ?? "ChatGPT account") { model.signIn(profile: profile["id"]) } } }.disabled(model.busy)
                    }
                    Link("Manage usage and disable credit overage", destination: URL(string: "https://chatgpt.com/settings/usage")!)
                    Text("Uses your eligible Plus/Pro allowance. PaperChat has no fee or API-key billing.").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            GroupBox("3. Enable in Safari") {
                VStack(alignment: .leading, spacing: 10) {
                    Button("Open Safari extension settings") { model.safariSettings() }
                    Text("For the local build, enable Safari → Settings → Advanced → Show features for web developers, then Settings → Developer → Allow unsigned extensions (the Develop menu in older Safari). Enable PaperChat under Extensions.").font(.caption)
                    Text("Click the PaperChat toolbar button on an article or PDF. The helper starts automatically; use Setup in the sidebar whenever you need this window.").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            HStack { if model.busy { ProgressView().controlSize(.small) }; Text(model.message).font(.callout).textSelection(.enabled) }
            if !model.bridgeReady { Text("Native bridge is unavailable. Check local signing before using Safari.").foregroundStyle(.red) }
        }.padding(24).frame(width: 560)
    }
}
