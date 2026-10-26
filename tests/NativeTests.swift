import Foundation
import Security
import Network

func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if !(try condition()) { throw PCError.message("TEST FAILED: " + message) }
}
func rejects(_ action: () throws -> Void, _ message: String) throws {
    do { try action() } catch { return }
    throw PCError.message("TEST FAILED: " + message)
}
func integerComponents(_ der: Data) -> (Data, Data) {
    let bytes = [UInt8](der); var offset = 0
    func length() -> Int {
        let first = Int(bytes[offset]); offset += 1
        if first < 128 { return first }
        var value = 0
        for _ in 0..<(first & 127) { value = value * 256 + Int(bytes[offset]); offset += 1 }
        return value
    }
    offset += 1; _ = length()
    func integer() -> Data {
        offset += 1; let size = length(); var value = Data(bytes[offset..<offset+size]); offset += size
        if value.first == 0 { value.removeFirst() }; return value
    }
    return (integer(), integer())
}

@main struct NativeTests {
    static func main() async throws {
        let fixture = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        let catalog = try ChatGPTService.modelChoices(["models": [
            ["slug": "hidden", "visibility": "hidden"],
            ["slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list"],
            ["slug": "fixture", "visibility": "list", "supported_reasoning_levels": [["effort": "low"], ["effort": "high"], ["effort": "unsupported"], ["effort": "low"]], "default_reasoning_level": "high"],
            ["slug": "unknown", "visibility": "list"],
            ["slug": "gpt-6.1-sol-override", "visibility": "list", "supported_reasoning_levels": [String]()]
        ]])
        try check(catalog.count == 4 && catalog[0]["slug"] as? String == "gpt-6.1-sol", "catalog preserves account order and visibility")
        try check(catalog[0]["reasoningLevels"] as? [String] == ["low", "medium", "high", "xhigh", "max"], "documented Sol reasoning fallback")
        try check(catalog[1]["reasoningLevels"] as? [String] == ["low", "high"] && catalog[1]["defaultReasoning"] as? String == "high", "catalog capability filtering and default")
        try check(catalog[2]["reasoningLevels"] as? [String] == [] && catalog[3]["reasoningLevels"] as? [String] == [], "unknown or explicitly empty capabilities keep model default")
        let question: [String: Any] = ["model": "fixture", "input": [["role": "user", "content": "Synthetic question"]], "store": true, "stream": false, "secret": "NEVER_FORWARD"]
        var tuned = question; tuned["reasoning"] = ["effort": "max", "summary": "NEVER_FORWARD"]
        let inference = try ChatGPTService.inferenceBody(tuned)
        try check((inference["reasoning"] as? [String: String]) == ["effort": "max"], "native bridge forwards selected effort only")
        try check(inference["store"] as? Bool == false && inference["stream"] as? Bool == true && inference["secret"] == nil, "native request retains storage and field whitelist")
        try check(try ChatGPTService.inferenceBody(question)["reasoning"] == nil, "model default omits explicit reasoning")
        tuned["reasoning"] = ["effort": "unsupported"]
        try rejects({ _ = try ChatGPTService.inferenceBody(tuned) }, "unsupported reasoning rejected before HTTP")
        tuned["reasoning"] = "max"
        try rejects({ _ = try ChatGPTService.inferenceBody(tuned) }, "malformed reasoning rejected before HTTP")
        let nested = URL(fileURLWithPath: "/Applications/PaperChat.app/Contents/PlugIns/PaperChat Extension.appex")
        try check(try CompanionLauncher.containingApplication(for: nested).path == "/Applications/PaperChat.app", "launcher derives exact containing app")
        try rejects({ _ = try CompanionLauncher.containingApplication(for: URL(fileURLWithPath: "/Applications/Other.app/extension.appex")) }, "malformed app hierarchy rejected")
        let impostor = fixture.appendingPathComponent("Impostor.app"), contents = impostor.appendingPathComponent("Contents"), macos = contents.appendingPathComponent("MacOS")
        try FileManager.default.createDirectory(at: macos, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: URL(fileURLWithPath: CommandLine.arguments[0]), to: macos.appendingPathComponent("Impostor"))
        try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": paperChatAppID, "CFBundleExecutable": "Impostor", "CFBundlePackageType": "APPL"], format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
        try rejects({ try CompanionLauncher.verifyApplication(impostor) }, "launcher rejects a signed binary claiming the app identifier without the pinned identity")
        print("PASS: reasoning catalog, native request selection, default/invalid effort, and launch-path/signature boundaries")
        let store = HistoryStore(testDirectory: fixture)
        let id = String(repeating: "a", count: 64)
        var payload: [String: Any] = ["expectedRevision": "", "paper": ["id": id, "url": "https://example.org/paper", "title": "Fixture paper", "blocks": ["NEVER_SAVE_THIS_CONTEXT"]],
          "messages": [["role": "user", "text": "Explain the method", "createdAt": "2026-10-07T00:00:00Z", "state": "complete", "image": "NEVER_SAVE_THIS_IMAGE"]], "pdf": "NEVER_SAVE_THIS_PDF"]
        let first = try store.save(payload); try check(!first.isEmpty, "first revision")
        let file = fixture.appendingPathComponent(id + ".json.gz")
        let raw = try Gzip.transform(Data(contentsOf: file), compress: false)
        let json = String(data: raw, encoding: .utf8)!
        try check(!json.contains("NEVER_SAVE"), "field whitelist excludes source contents and images")
        try check(try store.read(id)?.messages.first?.text == "Explain the method", "compressed history round trip")
        try rejects({ _ = try store.save(payload) }, "stale tab revision rejected")
        payload["expectedRevision"] = first
        let second = try store.save(payload); try check(second != first, "matching revision accepted with a fresh version")
        try check(try store.list().count == 1, "history index uses actual saved chats")
        try rejects({ _ = try store.read("../outside") }, "path traversal rejected")
        let linkedID = String(repeating: "b", count: 64)
        let linked = fixture.appendingPathComponent(linkedID + ".json.gz")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: file)
        try rejects({ _ = try store.read(linkedID) }, "linked file rejected")
        try FileManager.default.removeItem(at: linked)
        payload["expectedRevision"] = second
        payload["messages"] = Array(repeating: ["role": "assistant", "text": String(repeating: "z", count: 900000)], count: 10)
        try rejects({ _ = try store.save(payload) }, "oversized history rejected before writing")
        try check(try store.read(id)?.revision == second, "rejected save preserves the previous file")
        let inflated = Data(repeating: 65, count: 8_000_001)
        let bomb = try Gzip.transform(inflated, compress: true)
        try rejects({ _ = try Gzip.transform(bomb, compress: false) }, "inflate limit rejects compressed oversized contents")
        let permissions = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as! NSNumber
        try check(permissions.intValue == 0o600, "history file permissions")
        try store.delete(id); try check(try store.list().isEmpty, "explicit delete")
        payload["messages"] = [["role": "user", "text": "New chat"]]; payload["expectedRevision"] = ""
        let recreated = try store.save(payload); try check(recreated != first && recreated != second, "recreated history has a new version")
        payload["expectedRevision"] = first
        try rejects({ _ = try store.save(payload) }, "pre-deletion stale tab cannot overwrite recreated history")
        try store.delete(id)
        print("PASS: compressed history, field whitelist, size limits, revisions, links, permissions and deletion")

        let valid = Data("GET /auth/callback?state=expected&code=fixture&client_id=issued HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".utf8)
        try check(OAuthLoopback.parseRequest(valid, expectedState: "expected")?["code"] == "fixture", "OAuth callback accepted")
        try check(OAuthLoopback.parseRequest(valid, expectedState: "wrong") == nil, "wrong OAuth state rejected")
        try check(OAuthLoopback.parseRequest(Data("GET /auth/callback?state=expected&state=evil HTTP/1.1\r\n\r\n".utf8), expectedState: "expected") == nil, "duplicate OAuth state rejected")
        try check(OAuthLoopback.parseRequest(Data("GET https://evil.example/auth/callback?state=expected HTTP/1.1\r\n\r\n".utf8), expectedState: "expected") == nil, "absolute callback URL rejected")
        let randomA = try randomToken(), randomB = try randomToken()
        try check(randomA != randomB && randomA.count == 43, "secure random state and verifier")
        try check(String(data: ChatGPTService.form(["code": "a+b&c=", "state": "one two"]), encoding: .utf8) == "code=a%2Bb%26c%3D&state=one%20two", "token request encoding")

        let key = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048] as CFDictionary, nil)!
        let publicKey = SecKeyCopyPublicKey(key)!
        let components = integerComponents(SecKeyCopyExternalRepresentation(publicKey, nil)! as Data)
        let jwks: [String: Any] = ["keys": [["kid": "fixture", "kty": "RSA", "n": components.0.base64URLEncoded, "e": components.1.base64URLEncoded]]]
        func token(_ override: [String: Any] = [:], algorithm: String = "RS256") throws -> String {
            var claims: [String: Any] = ["iss": "https://auth.openai.com", "aud": "issued-client", "sub": "fixture-subject", "nonce": "fixture-nonce", "exp": Date().timeIntervalSince1970 + 300]
            claims.merge(override) { _, next in next }
            let header = try JSONSerialization.data(withJSONObject: ["alg": algorithm, "kid": "fixture"]).base64URLEncoded
            let body = try JSONSerialization.data(withJSONObject: claims).base64URLEncoded
            let unsigned = header + "." + body
            let signature = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, Data(unsigned.utf8) as CFData, nil)! as Data
            return unsigned + "." + signature.base64URLEncoded
        }
        let jwt = try token()
        try check(try JWTValidator.validate(jwt, clientID: "issued-client", nonce: "fixture-nonce", jwks: jwks).subject == "fixture-subject", "RSA identity verified")
        try rejects({ _ = try JWTValidator.validate(jwt, clientID: "another-client", nonce: "fixture-nonce", jwks: jwks) }, "wrong audience rejected")
        try rejects({ _ = try JWTValidator.validate(jwt, clientID: "issued-client", nonce: "wrong", jwks: jwks) }, "wrong nonce rejected")
        try rejects({ _ = try JWTValidator.validate(token(["exp": 1]), clientID: "issued-client", nonce: "fixture-nonce", jwks: jwks) }, "expired identity rejected")
        try rejects({ _ = try JWTValidator.validate(token(algorithm: "none"), clientID: "issued-client", nonce: "fixture-nonce", jwks: jwks) }, "unapproved signing algorithm rejected")
        try rejects({ _ = try JWTValidator.validate(String(jwt.dropLast(10)) + "AAAAAAAAAA", clientID: "issued-client", nonce: "fixture-nonce", jwks: jwks) }, "tampered signature rejected")
        print("PASS: OAuth state, callback shape, encoding, randomness and RSA identity validation")

        let delta: [String: Any] = ["type": "delta", "text": "very "]
        let identified = identifiedStreamEvent(delta, sequence: 10)
        try check(identified["eventId"] as? String == identifiedStreamEvent(delta, sequence: 10)["eventId"] as? String, "upstream replays retain event identity")
        try check(identified["eventId"] as? String != identifiedStreamEvent(delta, sequence: 11)["eventId"] as? String, "intentional identical chunks retain separate identities")
        try check(identifiedStreamEvent(identified)["eventId"] as? String == identified["eventId"] as? String, "Safari forwarding preserves upstream identity")
        let unsequenced = identifiedStreamEvent(delta)
        try check(unsequenced["eventId"] as? String != identifiedStreamEvent(delta)["eventId"] as? String, "unsequenced events get distinct delivery identities")

        let server = try NWListener(using: .tcp, on: .any)
        let eventText = "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"A fixture answer\"}\n\nevent: response.completed\ndata: {\"type\":\"response.completed\"}\n\n"
        server.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { _, _, _, _ in
                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: \(eventText.utf8.count)\r\nConnection: close\r\n\r\n" + eventText
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        await withCheckedContinuation { ready in server.stateUpdateHandler = { state in if case .ready = state { ready.resume() } }; server.start(queue: .global()) }
        let session = URLSession(configuration: .ephemeral)
        let (bytes, _) = try await session.bytes(from: URL(string: "http://127.0.0.1:\(server.port!.rawValue)/fixture")!)
        var parser = SSEByteParser(), events = [[String: Any]]()
        for try await byte in bytes { if let event = try parser.consume(byte) { events.append(event) } }
        server.cancel(); session.invalidateAndCancel()
        try check(events.count == 2, "real URLSession SSE line boundaries retained")
        try check(events[0]["delta"] as? String == "A fixture answer" && events[1]["type"] as? String == "response.completed", "SSE deltas and completion parsed")
        print("PASS: actual HTTP streaming through URLSession and SSE parser")

        let executable = URL(fileURLWithPath: CommandLine.arguments[0])
        let socket = fixture.appendingPathComponent("test.sock")
        let peerRequirement = try signingRequirement(at: executable)
        let bridge = try SocketBridge(path: socket, expectedRequirement: peerRequirement) { data, reply in reply(data) }
        try rejects({ _ = try SocketBridge(path: socket, expectedRequirement: peerRequirement) { _, _ in } }, "second bridge cannot replace a live endpoint")
        let channel = try SocketChannel(connecting: socket, expectedRequirement: peerRequirement)
        let message = Data("{\"fixture\":true}".utf8)
        try channel.send(message); try check(try channel.receive() == message, "signed socket peer and framed round trip")
        try rejects({ _ = try SocketChannel(connecting: socket, expectedRequirement: try signingRequirement(at: URL(fileURLWithPath: "/usr/bin/true"))) }, "different server signature rejected")
        bridge.stop()
        let replacement = try SocketBridge(path: socket, expectedRequirement: peerRequirement) { data, reply in reply(data) }
        bridge.stop(); try check(FileManager.default.fileExists(atPath: socket.path), "stopping old bridge cannot remove the new endpoint")
        replacement.stop()
        try rejects({ _ = try SocketBridge(path: fixture.appendingPathComponent(String(repeating: "x", count: 200)), expectedRequirement: peerRequirement) { _, _ in } }, "bridge startup failure returns an error without crashing")
        print("PASS: Unix socket framing, kernel audit peer validation, exact signature checks and startup failure")
    }
}
