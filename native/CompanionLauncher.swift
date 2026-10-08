import AppKit
import Security

actor CompanionLauncher {
    private var startup: Task<Void, Error>?

    func channel() async throws -> SocketChannel {
        do { return try Self.connect() }
        catch PCError.companionUnavailable {
            try await start()
            return try Self.connect()
        }
    }
    private static func connect() throws -> SocketChannel {
        try SocketChannel(connecting: bridgeDirectory().appendingPathComponent("bridge.sock"), expectedRequirement: paperChatPeerRequirement(paperChatAppID))
    }
    private func start() async throws {
        if let startup { try await startup.value; return }
        let task = Task {
            try await Self.openApplication()
            for _ in 0..<40 {
                do { _ = try Self.connect(); return }
                catch PCError.companionUnavailable { try await Task.sleep(nanoseconds: 100_000_000) }
            }
            throw PCError.message("PaperChat could not start its helper. Open Setup to check the connection.")
        }
        startup = task
        defer { startup = nil }
        try await task.value
    }
    static func containingApplication(for extensionURL: URL) throws -> URL {
        let plugins = extensionURL.deletingLastPathComponent(), contents = plugins.deletingLastPathComponent()
        let app = contents.deletingLastPathComponent()
        guard extensionURL.pathExtension == "appex", plugins.lastPathComponent == "PlugIns", contents.lastPathComponent == "Contents", app.pathExtension == "app" else {
            throw PCError.message("The containing PaperChat app could not be located.")
        }
        return app
    }
    static func verifyApplication(_ url: URL) throws {
        var code: SecStaticCode?, requirement: SecRequirement?
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(paperChatPeerRequirement(paperChatAppID) as CFString, [], &requirement) == errSecSuccess, let requirement,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode), requirement) == errSecSuccess else {
            throw PCError.message("The installed PaperChat app signature did not match. Reinstall the verified package.")
        }
    }
    @MainActor private static func openApplication() async throws {
        let url = try containingApplication(for: Bundle.main.bundleURL)
        try verifyApplication(url)
        if NSRunningApplication.runningApplications(withBundleIdentifier: paperChatAppID).contains(where: { $0.bundleURL?.standardizedFileURL == url.standardizedFileURL }) { return }
        let options = NSWorkspace.OpenConfiguration()
        options.activates = false; options.hides = true
        options.allowsRunningApplicationSubstitution = false
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.openApplication(at: url, configuration: options) { app, error in
                if error != nil || app == nil { continuation.resume(throwing: PCError.message("PaperChat could not start. Open the installed app's Setup window, then try again.")) }
                else { continuation.resume() }
            }
        }
    }
}
