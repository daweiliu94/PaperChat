import Foundation
import zlib

enum Gzip {
    static func transform(_ input: Data, compress: Bool, limit: Int = 8_000_000) throws -> Data {
        var stream = z_stream()
        let result = compress ? deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 31, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
            : inflateInit2_(&stream, 31, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard result == Z_OK else { throw PCError.message("Could not initialize conversation compression.") }
        defer { if compress { deflateEnd(&stream) } else { inflateEnd(&stream) } }
        return try input.withUnsafeBytes { source in
            stream.next_in = UnsafeMutablePointer(mutating: source.bindMemory(to: UInt8.self).baseAddress)
            stream.avail_in = uInt(input.count)
            var output = Data(), buffer = [UInt8](repeating: 0, count: 65536)
            var status: Int32 = Z_OK
            repeat {
                let count = buffer.count
                status = buffer.withUnsafeMutableBytes { destination in
                    stream.next_out = destination.bindMemory(to: UInt8.self).baseAddress
                    stream.avail_out = uInt(count)
                    return compress ? deflate(&stream, Z_FINISH) : inflate(&stream, Z_NO_FLUSH)
                }
                guard status == Z_OK || status == Z_STREAM_END else { throw PCError.message("This conversation file could not be decoded.") }
                output.append(contentsOf: buffer.prefix(count - Int(stream.avail_out)))
                guard output.count <= limit else { throw PCError.message("This conversation exceeds the storage size limit.") }
            } while status != Z_STREAM_END
            return output
        }
    }
}

struct HistoryMessage: Codable {
    let role: String
    let text: String
    let createdAt: String
    let state: String
}
struct PaperReference: Codable {
    let id: String
    let title: String
    let url: String
}
struct Conversation: Codable {
    var schemaVersion = 1
    let revision: String
    let paper: PaperReference
    let messages: [HistoryMessage]
    let updatedAt: String
}

final class HistoryStore {
    private var root: URL?
    private var securityURL: URL?
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let bookmark = defaults.data(forKey: "historyBookmark") {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale), url.startAccessingSecurityScopedResource() {
                securityURL = url; root = url.appendingPathComponent("history", isDirectory: true)
                if stale { defaults.set(try? url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil), forKey: "historyBookmark") }
            }
        }
    }
    // Test-only initializer keeps fixtures in the project and never touches the user's history.
    init(testDirectory: URL) { defaults = UserDefaults(suiteName: "PaperChatTests")!; root = testDirectory }
    var location: String? { root?.path }
    func choose(_ folder: URL) throws {
        let access = folder.startAccessingSecurityScopedResource()
        guard access else { throw PCError.message("Access to the selected history folder was not granted.") }
        do {
            let bookmark = try folder.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
            let directory = folder.appendingPathComponent("history", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw PCError.message("Choose a project with a regular history folder.") }
            securityURL?.stopAccessingSecurityScopedResource()
            securityURL = folder; root = directory
            defaults.set(bookmark, forKey: "historyBookmark")
        } catch { folder.stopAccessingSecurityScopedResource(); throw error }
    }
    private func file(_ id: String) throws -> URL {
        guard id.count == 64, id.allSatisfy({ "0123456789abcdef".contains($0) }), let root else {
            throw PCError.message(root == nil ? "Choose the history project folder in the PaperChat app first." : "Invalid paper identifier.")
        }
        guard try root.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw PCError.message("The history folder must not be a symbolic link.") }
        return root.appendingPathComponent(id + ".json.gz")
    }
    func read(_ id: String) throws -> Conversation? {
        let url = try file(id)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey])
        guard attributes.isSymbolicLink != true, (attributes.fileSize ?? 8_000_001) <= 8_000_000 else { throw PCError.message("The conversation file is linked or too large.") }
        let data = try Data(contentsOf: url)
        guard data.count <= 8_000_000 else { throw PCError.message("The conversation file is too large.") }
        let value = try JSONDecoder().decode(Conversation.self, from: Gzip.transform(data, compress: false))
        guard value.schemaVersion == 1, value.paper.id == id else { throw PCError.message("The conversation format or paper identifier does not match.") }
        return value
    }
    func save(_ payload: [String: Any]) throws -> String {
        guard let p = payload["paper"] as? [String: Any], let id = p["id"] as? String,
              let url = p["url"] as? String, url.count <= 8192,
              let items = payload["messages"] as? [[String: Any]], items.count <= 1000 else { throw PCError.message("Invalid conversation data.") }
        let destination = try file(id)
        let revision = try read(id)?.revision ?? ""
        guard payload["expectedRevision"] as? String == revision else { throw PCError.message("This chat changed in another tab. Copy any unsaved messages, then reopen the sidebar to reload its history.") }
        // Select fields explicitly. Never serialize context blocks, selections, PDFs, images or tokens.
        let messages = try items.map { item -> HistoryMessage in
            guard let role = item["role"] as? String, ["user", "assistant"].contains(role),
                  let text = item["text"] as? String, text.count <= 1_000_000 else { throw PCError.message("Invalid conversation message.") }
            return HistoryMessage(role: role, text: text, createdAt: String((item["createdAt"] as? String ?? "").prefix(40)),
                state: ["complete", "incomplete", "cancelled"].contains(item["state"] as? String ?? "") ? item["state"] as! String : "complete")
        }
        let nextRevision = UUID().uuidString
        let value = Conversation(revision: nextRevision, paper: PaperReference(id: id, title: String((p["title"] as? String ?? "Paper").prefix(500)), url: url),
            messages: messages, updatedAt: ISO8601DateFormatter().string(from: Date()))
        let encoded = try JSONEncoder().encode(value)
        guard encoded.count <= 8_000_000 else { throw PCError.message("This conversation exceeds the storage size limit. Export it before starting a new one.") }
        let data = try Gzip.transform(encoded, compress: true)
        if FileManager.default.fileExists(atPath: destination.path), try destination.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
            throw PCError.message("Refusing to overwrite a linked history file.")
        }
        try data.write(to: destination, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        return nextRevision
    }
    func delete(_ id: String) throws {
        let url = try file(id)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    func list() throws -> [[String: Any]] {
        guard let root else { return [] }
        return try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).filter { $0.pathExtension == "gz" }.compactMap { url in
            let id = url.deletingPathExtension().deletingPathExtension().lastPathComponent
            guard let item = try? read(id) else { return nil }
            return ["id": id, "title": item.paper.title, "url": item.paper.url, "updatedAt": item.updatedAt]
        }.sorted { ($0["updatedAt"] as? String ?? "") > ($1["updatedAt"] as? String ?? "") }
    }
    deinit { securityURL?.stopAccessingSecurityScopedResource() }
}
