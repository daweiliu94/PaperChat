import Foundation
import Darwin

@main struct SandboxPeerFixture {
    static var bridge: SocketBridge?
    static var shutdown: DispatchSourceSignal?
    static func report(_ text: String) { print(text); fflush(stdout) }
    static func main() throws {
        let mode = CommandLine.arguments[1]
        if mode == "server" {
            let socket = try bridgeDirectory().appendingPathComponent(CommandLine.arguments[2])
            bridge = try SocketBridge(path: socket, expectedRequirement: paperChatPeerRequirement("local.paperchat.PeerFixture.Client")) { data, reply in
                report("HANDLED")
                reply(data)
            }
            signal(SIGTERM, SIG_IGN)
            shutdown = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
            shutdown?.setEventHandler { bridge?.stop(); exit(0) }
            shutdown?.resume()
            report("READY " + socket.path)
            dispatchMain()
        }
        let channel = try SocketChannel(connecting: URL(fileURLWithPath: CommandLine.arguments[2]), expectedRequirement: paperChatPeerRequirement("local.paperchat.PeerFixture.Server"))
        report("CONNECTED")
        let message = Data("synthetic socket fixture".utf8)
        do {
            try channel.send(message)
            guard try channel.receive() == message else { throw PCError.message("Fixture response mismatch.") }
            guard mode == "client" else { throw PCError.message("An untrusted fixture was accepted.") }
            report("ROUNDTRIP")
        } catch {
            guard mode == "reject", (error as? PCError)?.localizedDescription != "An untrusted fixture was accepted." else { throw error }
            report("REJECTED")
        }
    }
}
