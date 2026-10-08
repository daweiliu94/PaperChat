import Foundation
import Network

final class OAuthLoopback: @unchecked Sendable {
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "PaperChat.OAuth")
    private let lock = NSLock()
    private var callback: CheckedContinuation<[String: String], Error>?
    private var timer: DispatchWorkItem?
    private var finished = false
    private var expectedState = ""
    private var port: UInt16 = 0
    private var readyResolved = false

    func start(state: String) async throws -> URL {
        expectedState = state
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let server = try NWListener(using: parameters)
        listener = server
        server.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        try await withCheckedThrowingContinuation { (ready: CheckedContinuation<Void, Error>) in
            server.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                if !self.readyResolved {
                    switch state {
                    case .ready:
                        self.readyResolved = true; self.port = server.port?.rawValue ?? 0; ready.resume()
                    case .failed(let error): self.readyResolved = true; ready.resume(throwing: error)
                    case .cancelled: self.readyResolved = true; ready.resume(throwing: CancellationError())
                    default: break
                    }
                }
            }
            server.start(queue: queue)
        }
        guard port != 0 else { throw PCError.message("Could not open the sign-in callback.") }
        return URL(string: "http://127.0.0.1:\(port)/auth/callback")!
    }

    func wait(open: () -> Void) async throws -> [String: String] {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock(); callback = continuation; lock.unlock()
            let timeout = DispatchWorkItem { [weak self] in self?.finish(.failure(PCError.message("Sign-in timed out. Please try again."))) }
            timer = timeout
            queue.asyncAfter(deadline: .now() + 300, execute: timeout)
            open()
        }
    }

    static func parseRequest(_ data: Data, expectedState: String) -> [String: String]? {
        guard data.count <= 8192, let line = String(data: data, encoding: .utf8)?.components(separatedBy: "\r\n").first else { return nil }
        let parts = line.split(separator: " ")
        guard parts.count == 3, parts[0] == "GET", parts[2] == "HTTP/1.1",
              let components = URLComponents(string: String(parts[1])), components.path == "/auth/callback",
              components.scheme == nil, components.host == nil else { return nil }
        var values: [String: String] = [:]
        for item in components.queryItems ?? [] {
            guard values[item.name] == nil else { return nil }
            values[item.name] = item.value ?? ""
        }
        guard values["state"] == expectedState, !expectedState.isEmpty else { return nil }
        return values
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, accumulated: Data())
    }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8193) { [weak self] data, _, done, error in
            guard let self else { connection.cancel(); return }
            let all = accumulated + (data ?? Data())
            if all.count > 8192 { connection.cancel(); return }
            if all.range(of: Data("\r\n\r\n".utf8)) == nil {
                if done || error != nil { connection.cancel() } else { self.receive(connection, accumulated: all) }
                return
            }
            let parsed = Self.parseRequest(all, expectedState: self.expectedState)
            let text = parsed == nil ? "This callback does not match the sign-in attempt." : "You can return to PaperChat. The app is completing sign-in."
            let status = parsed == nil ? "400 Bad Request" : "200 OK"
            let body = Data(text.utf8)
            let reply = Data("HTTP/1.1 \(status)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".utf8) + body
            connection.send(content: reply, completion: .contentProcessed { _ in connection.cancel() })
            if let parsed { self.finish(.success(parsed)) }
        }
    }
    private func finish(_ result: Result<[String: String], Error>) {
        lock.lock()
        guard !finished, let continuation = callback else { lock.unlock(); return }
        finished = true; callback = nil; lock.unlock()
        timer?.cancel(); listener?.cancel(); continuation.resume(with: result)
    }
    deinit { listener?.cancel(); timer?.cancel() }
}
