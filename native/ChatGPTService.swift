import Foundation
import AppKit
import CryptoKit

actor ChatGPTService {
    private let session: URLSession
    private var record: Credential?
    private var refreshing: Task<Credential, Error>?
    private var signingIn = false
    private var signingOut = false
    private var generation = 0
    private let defaults = UserDefaults.standard
    private let requiredScope = "chatgpt.tokens.use.direct"

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 600
        session = URLSession(configuration: configuration)
    }

    func status() -> [String: Any] {
        if record == nil, defaults.bool(forKey: "sessionEnabled"), let id = defaults.string(forKey: "activeClient") { record = try? CredentialVault.load(id) }
        let profiles = defaults.dictionary(forKey: "profiles") as? [String: String] ?? [:]
        return ["connected": record?.scopes.contains(requiredScope) == true,
                "email": record?.email ?? "", "activeClient": defaults.string(forKey: "activeClient") ?? "",
                "profiles": profiles.map { ["id": $0.key, "email": $0.value] }.sorted { $0["id"]! < $1["id"]! }]
    }

    func signIn(newAccount: Bool = false, profile: String? = nil) async throws -> String {
        guard !signingIn && !signingOut else { throw PCError.message("Another account operation is in progress.") }
        signingIn = true
        defer { signingIn = false }
        let clientID = newAccount ? nil : (profile ?? defaults.string(forKey: "activeClient"))
        let previous = clientID.flatMap { try? CredentialVault.load($0) }
        let identities = defaults.dictionary(forKey: "subjects") as? [String: String] ?? [:]
        let expectedSubject = clientID.flatMap { identities[$0] }
        let hostID: String
        if let saved = defaults.string(forKey: "hostID") { hostID = saved }
        else { hostID = "urn:uuid:\(UUID().uuidString.lowercased())"; defaults.set(hostID, forKey: "hostID") }
        let state = try randomToken(), nonce = try randomToken(), verifier = try randomToken(64)
        let listener = OAuthLoopback()
        let callbackURI = try await listener.start(state: state)
        var query = URLComponents(string: "https://auth.openai.com/api/accounts/authorize")!
        var items = [
            "client_id": clientID ?? "dynamic_agent_client", "ext_agent_host_id": hostID,
            "response_type": "code", "redirect_uri": callbackURI.absoluteString,
            "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            "resource": "https://api.openai.com/v1", "state": state, "nonce": nonce,
            "code_challenge_method": "S256", "code_challenge": Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
        ]
        if clientID == nil { items["agent_name_hint"] = "PaperChat" }
        if let previous { items["id_token_hint"] = previous.idToken }
        query.queryItems = items.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let authorizeURL = query.url else { throw PCError.message("Could not prepare sign-in.") }
        let returned = try await listener.wait { NSWorkspace.shared.open(authorizeURL) }
        if returned["error"] != nil { throw PCError.message("ChatGPT authorization was declined. Nothing has been connected.") }
        guard let code = returned["code"], !code.isEmpty else { throw PCError.message("No authorization code was returned.") }
        let issued: String
        if let clientID {
            guard returned["client_id"] == nil || returned["client_id"] == clientID else { throw PCError.message("The returned account registration does not match.") }
            issued = clientID
        } else {
            guard let value = returned["client_id"], value != "dynamic_agent_client", !value.isEmpty else { throw PCError.message("ChatGPT registration was incomplete.") }
            issued = value
        }
        let tokens = try await tokenRequest(["grant_type": "authorization_code", "client_id": issued, "code": code,
            "code_verifier": verifier, "redirect_uri": callbackURI.absoluteString, "resource": "https://api.openai.com/v1"])
        guard let idToken = tokens["id_token"] as? String else { throw PCError.message("ChatGPT did not return a verifiable identity.") }
        let jwks = try await fetchJSON(URL(string: "https://auth.openai.com/.well-known/jwks.json")!)
        let identity = try JWTValidator.validate(idToken, clientID: issued, nonce: nonce, jwks: jwks)
        guard expectedSubject == nil || expectedSubject == identity.subject else { throw PCError.message("This is a different account. Choose Use another account instead.") }
        let scopes = (tokens["scope"] as? String ?? "").split(separator: " ").map(String.init)
        guard scopes.contains(requiredScope) else { throw PCError.message("Permission to use your ChatGPT plan was not granted. Sign in again and enable plan usage.") }
        guard let access = tokens["access_token"] as? String, let refresh = tokens["refresh_token"] as? String,
              !access.isEmpty, !refresh.isEmpty, tokens["token_type"] as? String == "Bearer" else { throw PCError.message("ChatGPT returned incomplete credentials.") }
        let credential = Credential(clientID: issued, subject: identity.subject, email: identity.email, accessToken: access,
            refreshToken: refresh, idToken: idToken, scopes: scopes, expiresAt: Date().addingTimeInterval(tokens["expires_in"] as? Double ?? 3600))
        try CredentialVault.save(credential)
        generation += 1
        record = credential
        defaults.set(true, forKey: "sessionEnabled")
        defaults.set(issued, forKey: "activeClient")
        var profiles = defaults.dictionary(forKey: "profiles") as? [String: String] ?? [:]
        profiles[issued] = identity.email; defaults.set(profiles, forKey: "profiles")
        var subjects = identities; subjects[issued] = identity.subject; defaults.set(subjects, forKey: "subjects")
        return identity.email
    }

    func selectProfile(_ id: String) throws {
        guard !signingIn && !signingOut else { throw PCError.message("Finish the account operation first.") }
        guard let value = try CredentialVault.load(id) else { throw PCError.message("Sign in again to reconnect that account.") }
        generation += 1; record = value; defaults.set(id, forKey: "activeClient"); defaults.set(true, forKey: "sessionEnabled")
    }

    func signOut() async throws -> Bool {
        _ = status()
        guard let value = record else { return true }
        signingOut = true
        defer { signingOut = false }
        generation += 1
        defaults.set(false, forKey: "sessionEnabled")
        record = nil
        refreshing?.cancel()
        var revoked = false
        do {
            let discovery = try await fetchJSON(URL(string: "https://auth.openai.com/.well-known/openid-configuration")!)
            if let endpoint = discovery["revocation_endpoint"] as? String, let url = URL(string: endpoint), url.scheme == "https", url.host == "auth.openai.com" {
                var request = URLRequest(url: url); request.httpMethod = "POST"
                request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                request.httpBody = Self.form(["token": value.refreshToken, "token_type_hint": "refresh_token", "client_id": value.clientID])
                let (_, response) = try await session.data(for: request)
                revoked = (response as? HTTPURLResponse)?.statusCode == 200
            }
        } catch { revoked = false }
        try CredentialVault.remove(value.clientID)
        return revoked
    }

    private func credential() async throws -> Credential {
        _ = status()
        guard let current = record, current.scopes.contains(requiredScope) else { throw PCError.message("Open the PaperChat app and Continue with ChatGPT first.") }
        if current.expiresAt.timeIntervalSinceNow > 90 { return current }
        let currentGeneration = generation
        if let refreshing {
            let value = try await refreshing.value
            guard generation == currentGeneration, record?.clientID == current.clientID,
                  defaults.bool(forKey: "sessionEnabled") else { throw PCError.message("ChatGPT account changed during refresh. Try again.") }
            try Task.checkCancellation()
            return value
        }
        let task = Task<Credential, Error> {
            let tokens = try await self.tokenRequest(["grant_type": "refresh_token", "client_id": current.clientID,
                "refresh_token": current.refreshToken, "resource": "https://api.openai.com/v1"])
            guard let access = tokens["access_token"] as? String, !access.isEmpty else { throw PCError.message("ChatGPT token refresh was incomplete.") }
            var next = current
            next.accessToken = access
            next.refreshToken = tokens["refresh_token"] as? String ?? current.refreshToken
            next.scopes = (tokens["scope"] as? String)?.split(separator: " ").map(String.init) ?? current.scopes
            guard next.scopes.contains(self.requiredScope) else { throw PCError.message("ChatGPT plan access has been revoked. Sign in again.") }
            if let idToken = tokens["id_token"] as? String {
                let jwks = try await self.fetchJSON(URL(string: "https://auth.openai.com/.well-known/jwks.json")!)
                let identity = try JWTValidator.validate(idToken, clientID: current.clientID, nonce: nil, jwks: jwks)
                guard identity.subject == current.subject else { throw PCError.message("The refreshed ChatGPT identity changed.") }
                next.idToken = idToken
            }
            next.expiresAt = Date().addingTimeInterval(tokens["expires_in"] as? Double ?? 3600)
            guard self.generation == currentGeneration, self.record?.clientID == current.clientID,
                  self.defaults.bool(forKey: "sessionEnabled") else { throw PCError.message("ChatGPT account changed during refresh. Try again.") }
            try Task.checkCancellation()
            try CredentialVault.save(next)
            return next
        }
        refreshing = task
        defer { refreshing = nil }
        let refreshed = try await task.value
        guard generation == currentGeneration, record?.clientID == current.clientID else { throw PCError.message("ChatGPT account changed during refresh. Try again.") }
        record = refreshed; return refreshed
    }

    func models() async throws -> [[String: Any]] {
        let account = try await credential()
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        request.setValue("Bearer \(account.accessToken)", forHTTPHeaderField: "Authorization")
        let data = try await json(request)
        return try Self.modelChoices(data)
    }

    static let reasoningLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
    static func modelChoices(_ data: [String: Any]) throws -> [[String: Any]] {
        guard let values = data["models"] as? [[String: Any]] else { throw PCError.message("The account model catalog was not available.") }
        return values.filter { $0["visibility"] as? String == "list" }.compactMap {
            guard let slug = $0["slug"] as? String else { return nil }
            var levels: [String] = []
            if let advertised = $0["supported_reasoning_levels"] as? [Any] {
                levels = advertised.compactMap { ($0 as? String) ?? ($0 as? [String: Any])?["effort"] as? String }
            } else if slug == "gpt-6.1-sol" || slug.hasPrefix("gpt-6.1-sol-") {
                // Documented fallback when the account catalog omits capability metadata.
                levels = ["low", "medium", "high", "xhigh", "max"]
            }
            var seen = Set<String>()
            levels = levels.filter { reasoningLevels.contains($0) && seen.insert($0).inserted }
            var choice: [String: Any] = ["slug": slug, "name": $0["display_name"] as? String ?? slug, "reasoningLevels": levels]
            if let value = $0["default_reasoning_level"] as? String, reasoningLevels.contains(value) { choice["defaultReasoning"] = value }
            else if slug == "gpt-6.1-sol" || slug.hasPrefix("gpt-6.1-sol-") { choice["defaultReasoning"] = "medium" }
            return choice
        }
    }

    static func inferenceBody(_ body: [String: Any]) throws -> [String: Any] {
        guard let model = body["model"] as? String, let input = body["input"] as? [[String: Any]], input.count < 1000 else { throw PCError.message("Invalid paper question.") }
        var allowed: [String: Any] = ["model": model, "input": input, "store": false, "stream": true]
        if let instructions = body["instructions"] as? String { allowed["instructions"] = instructions }
        if let value = body["reasoning"] {
            guard let reasoning = value as? [String: Any], let effort = reasoning["effort"] as? String, reasoningLevels.contains(effort) else {
                throw PCError.message("Choose an available reasoning level.")
            }
            allowed["reasoning"] = ["effort": effort]
        }
        return allowed
    }

    func respond(body: [String: Any], onEvent: @escaping @Sendable ([String: Any]) -> Void) async throws {
        let account = try await credential()
        try Task.checkCancellation()
        let allowed = try Self.inferenceBody(body)
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(account.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: allowed)
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw PCError.message("ChatGPT did not return an HTTP response.") }
        if !(200..<300).contains(http.statusCode) {
            var errorData = Data()
            for try await byte in bytes { errorData.append(byte); if errorData.count > 16384 { break } }
            let error = (try? JSONSerialization.jsonObject(with: errorData)) as? [String: Any] ?? [:]
            throw Self.requestError(error, status: http.statusCode)
        }
        var parser = SSEByteParser()
        for try await byte in bytes {
            try Task.checkCancellation()
            if let event = try parser.consume(byte) {
                let kind = event["type"] as? String ?? ""
                if kind == "response.output_text.delta", let delta = event["delta"] as? String { onEvent(identifiedStreamEvent(["type": "delta", "text": delta], sequence: event["sequence_number"] as? Int)) }
                else if kind == "response.completed" { onEvent(["type": "completed"]); return }
                else if kind == "error" || kind == "response.failed" || kind == "response.incomplete" {
                    let value = event["response"] as? [String: Any] ?? event
                    throw Self.requestError(value, status: 200)
                }
            }
        }
        throw PCError.message("The response was interrupted before completion. Your draft reply has been preserved.")
    }

    static func form(_ fields: [String: String]) -> Data {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        return Data(fields.sorted { $0.key < $1.key }.map { "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)" }.joined(separator: "&").utf8)
    }
    private func tokenRequest(_ fields: [String: String]) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://auth.openai.com/api/accounts/oauth/token")!)
        request.httpMethod = "POST"; request.httpBody = Self.form(fields)
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        return try await json(request)
    }
    private func fetchJSON(_ url: URL) async throws -> [String: Any] { try await json(URLRequest(url: url)) }
    private func json(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await session.data(for: request)
        let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.requestError(value, status: status) }
        return value
    }
    static func requestError(_ body: [String: Any], status: Int) -> PCError {
        let error = body["error"] as? [String: Any] ?? body
        let code = error["code"] as? String ?? ""
        switch code {
        case "subscription_sharing_usage_limit_exceeded": return .message("ChatGPT plan usage limit reached. Open Manage usage to review your allowance.")
        case "subscription_sharing_user_not_eligible": return .message("This ChatGPT account or workspace is not eligible to use its plan in PaperChat.")
        case "invalid_grant", "invalid_refresh_token", "refresh_token_expired", "refresh_token_reused": return .message("Your ChatGPT connection expired. Sign in again from PaperChat.")
        case "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable": return .message("ChatGPT cannot check your plan right now. Please try again later.")
        case "subscription_sharing_unsupported_capability": return .message("The selected model does not support this request. Try another account-available model or remove the image.")
        default:
            // Do not reflect arbitrary upstream payloads or credentials into the browser.
            return .message("ChatGPT request failed (HTTP \(status)\(code.isEmpty ? "" : ", \(code.prefix(100))")).")
        }
    }
}

struct SSEParser {
    private var lines: [String] = []
    private var size = 0
    mutating func consume(_ line: String) throws -> [String: Any]? {
        if line.isEmpty {
            defer { lines.removeAll(keepingCapacity: true); size = 0 }
            let text = lines.joined(separator: "\n")
            guard let data = text.data(using: .utf8) else { return nil }
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }
        if line.hasPrefix("data:") {
            size += line.utf8.count
            guard size <= 2_000_000 else { throw PCError.message("The streamed response event exceeded the size limit.") }
            lines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
        }
        return nil
    }
}

// AsyncBytes.lines discards empty lines on macOS. SSE requires them to separate events.
struct SSEByteParser {
    private var line = Data()
    private var parser = SSEParser()
    mutating func consume(_ byte: UInt8) throws -> [String: Any]? {
        if byte == 10 {
            if line.last == 13 { line.removeLast() }
            defer { line.removeAll(keepingCapacity: true) }
            guard let text = String(data: line, encoding: .utf8) else { throw PCError.message("The streamed response was not valid text.") }
            return try parser.consume(text)
        }
        line.append(byte)
        guard line.count <= 2_000_000 else { throw PCError.message("The streamed response line exceeded the size limit.") }
        return nil
    }
}

// Preserve upstream identity across replays; assign one before Safari delivery otherwise.
func identifiedStreamEvent(_ event: [String: Any], sequence: Int? = nil) -> [String: Any] {
    var identified = event
    if identified["eventId"] == nil {
        identified["eventId"] = sequence.map { "response:\($0)" } ?? UUID().uuidString
    }
    return identified
}
