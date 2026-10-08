import Foundation
import Security
import Darwin
import OSLog

enum PCError: LocalizedError {
    case message(String)
    case companionUnavailable
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        case .companionUnavailable: return "The PaperChat helper is not running."
        }
    }
}

func signingRequirement(at url: URL) throws -> String {
    var code: SecStaticCode?
    var requirement: SecRequirement?
    var text: CFString?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code,
          SecCodeCopyDesignatedRequirement(code, [], &requirement) == errSecSuccess, let requirement,
          SecRequirementCopyString(requirement, [], &text) == errSecSuccess, let text else {
        throw PCError.message("Could not verify the local app's signing requirement.")
    }
    return text as String
}

let paperChatAppID = "local.paperchat.PaperChat"
let paperChatExtensionID = "local.paperchat.PaperChat.Extension"
let paperChatSetupRequested = Notification.Name("PaperChatShowSetup")
let paperChatGroup = Bundle.main.object(forInfoDictionaryKey: "PaperChatAppGroup") as? String ?? "group.local.paperchat.shared"

func encodeReply(_ value: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{\"ok\":false,\"error\":\"Could not encode response.\"}".utf8)
}

func bridgeDirectory() throws -> URL {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: paperChatGroup) else {
        throw PCError.message("The local app group is unavailable. Rebuild with a development signing identity or allow the local development build.")
    }
    return url
}

func verifySocketPeer(_ fd: Int32, expectedRequirement: String) throws {
    var uid: uid_t = 0, gid: gid_t = 0, token = audit_token_t()
    var size = socklen_t(MemoryLayout<audit_token_t>.size)
    guard getpeereid(fd, &uid, &gid) == 0, uid == getuid(),
          getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) == 0,
          size == MemoryLayout<audit_token_t>.size else { throw PCError.message("The local connection could not be verified.") }
    let audit = Data(bytes: &token, count: Int(size))
    var code: SecCode?, requirement: SecRequirement?
    // Use the kernel's signature data; App Sandbox forbids reading another process's executable path.
    let lookup = SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: audit, kSecGuestAttributeDynamicCode: true] as CFDictionary, [], &code)
    guard lookup == errSecSuccess, let code else {
        Logger(subsystem: "local.paperchat.bridge", category: "peer").error("Peer lookup failed: \(lookup, privacy: .public)")
        throw PCError.message("The local app identity could not be verified. Restart PaperChat, then try again.")
    }
    let creation = SecRequirementCreateWithString(expectedRequirement as CFString, [], &requirement)
    guard creation == errSecSuccess, let requirement else { throw PCError.message("The local app signing requirement is unavailable.") }
    let validity = SecCodeCheckValidity(code, [], requirement)
    guard validity == errSecSuccess else {
        Logger(subsystem: "local.paperchat.bridge", category: "peer").error("Peer signature validation failed: \(validity, privacy: .public)")
        throw PCError.message("The local app signature did not match. Restart PaperChat, then try again.")
    }
}

final class SocketChannel: @unchecked Sendable {
    let fd: Int32
    init(fd: Int32) {
        self.fd = fd
        var timeout = timeval(tv_sec: 30, tv_usec: 0), noSignal: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
    }
    convenience init(connecting url: URL, expectedRequirement: String) throws {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw PCError.message("Could not create the local connection.") }
        self.init(fd: fd)
        var address = try Self.address(url)
        let result = withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard result == 0 else {
            if errno == ENOENT || errno == ECONNREFUSED { throw PCError.companionUnavailable }
            throw PCError.message("The local connection could not be opened.")
        }
        try verifySocketPeer(fd, expectedRequirement: expectedRequirement)
    }
    static func address(_ url: URL) throws -> sockaddr_un {
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX); address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let path = Array(url.path.utf8) + [0]
        guard path.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw PCError.message("The local connection path is too long.") }
        withUnsafeMutableBytes(of: &address.sun_path) { destination in destination.copyBytes(from: path) }
        return address
    }
    private func read(_ count: Int) throws -> Data {
        var data = Data(count: count), offset = 0
        try data.withUnsafeMutableBytes { bytes in
            while offset < count {
                let size = Darwin.recv(fd, bytes.baseAddress!.advanced(by: offset), count - offset, 0)
                if size < 0 && errno == EINTR { continue }
                guard size > 0 else { throw PCError.message("The local connection was interrupted.") }; offset += size
            }
        }
        return data
    }
    func receive() throws -> Data {
        let header = try read(4); let count = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard count > 0, count <= 24_000_000 else { throw PCError.message("Invalid local request size.") }
        return try read(Int(count))
    }
    func send(_ data: Data) throws {
        guard !data.isEmpty, data.count <= 24_000_000 else { throw PCError.message("The selected content is too large.") }
        var count = UInt32(data.count).bigEndian
        let framed = withUnsafeBytes(of: &count) { Data($0) } + data
        try framed.withUnsafeBytes { bytes in
            var offset = 0
            while offset < framed.count {
                let size = Darwin.send(fd, bytes.baseAddress!.advanced(by: offset), framed.count - offset, 0)
                if size < 0 && errno == EINTR { continue }
                guard size > 0 else { throw PCError.message("The local connection was interrupted.") }; offset += size
            }
        }
    }
    deinit { Darwin.close(fd) }
}

final class SocketLock {
    private var fd: Int32
    init(_ path: URL) throws {
        fd = Darwin.open(path.path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw PCError.message("Could not lock the local connection.") }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { Darwin.close(fd); fd = -1; throw PCError.message("PaperChat is already running. Close its other instance first.") }
    }
    func release() { if fd >= 0 { flock(fd, LOCK_UN); Darwin.close(fd); fd = -1 } }
    deinit { release() }
}

final class SocketBridge: @unchecked Sendable {
    private let fd: Int32
    private let path: URL
    private let source: DispatchSourceRead
    private let slots = DispatchSemaphore(value: 8)
    private let ownership: SocketLock
    private let stopLock = NSLock()
    private var stopped = false
    init(path: URL, expectedRequirement: String, request: @escaping @Sendable (Data, @escaping @Sendable (Data) -> Void) -> Void) throws {
        self.path = path
        ownership = try SocketLock(URL(fileURLWithPath: path.path + ".lock"))
        let fd = socket(AF_UNIX, SOCK_STREAM, 0); self.fd = fd
        guard fd >= 0 else { throw PCError.message("Could not start the local connection.") }
        source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: DispatchQueue(label: "PaperChat.Bridge"))
        source.setCancelHandler { Darwin.close(fd) }
        var started = false
        defer { if !started { source.cancel(); source.resume() } }
        try? FileManager.default.removeItem(at: path)
        var address = try SocketChannel.address(path)
        let result = withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard result == 0, chmod(path.path, 0o600) == 0, listen(fd, 8) == 0 else { throw PCError.message("Could not open the local connection (\(errno)).") }
        source.setEventHandler { [weak self] in
            guard let self else { return }
            let peer = accept(fd, nil, nil); guard peer >= 0 else { return }
            guard self.slots.wait(timeout: .now()) == .success else { Darwin.close(peer); return }
            DispatchQueue.global(qos: .userInitiated).async {
                let channel = SocketChannel(fd: peer)
                do {
                    try verifySocketPeer(peer, expectedRequirement: expectedRequirement)
                    let data = try channel.receive()
                    request(data) { reply in
                        DispatchQueue.global().async { defer { self.slots.signal() }; try? channel.send(reply) }
                    }
                } catch { self.slots.signal() }
            }
        }
        source.resume(); started = true
    }
    func stop() {
        stopLock.lock(); defer { stopLock.unlock() }
        guard !stopped else { return }; stopped = true
        source.cancel(); try? FileManager.default.removeItem(at: path); ownership.release()
    }
    deinit { stop() }
}
