import Foundation
import Security
import CryptoKit

func randomToken(_ count: Int = 32) throws -> String {
    var bytes = [UInt8](repeating: 0, count: count)
    guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
        throw PCError.message("Could not create a secure sign-in attempt.")
    }
    return Data(bytes).base64URLEncoded
}

extension Data {
    var base64URLEncoded: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    init?(base64URL: String) {
        let value = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        self.init(base64Encoded: value + String(repeating: "=", count: (4 - value.count % 4) % 4))
    }
}

struct Credential: Codable {
    var clientID: String
    var subject: String
    var email: String
    var accessToken: String
    var refreshToken: String
    var idToken: String
    var scopes: [String]
    var expiresAt: Date
}

enum CredentialVault {
    static let service = "local.paperchat.ChatGPT"
    static func load(_ clientID: String) throws -> Credential? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: clientID, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw PCError.message("Keychain access failed (\(status)).") }
        return try JSONDecoder().decode(Credential.self, from: data)
    }
    static func save(_ record: Credential) throws {
        let key: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: record.clientID]
        let value = try JSONEncoder().encode(record)
        let status = SecItemUpdate(key as CFDictionary, [kSecValueData as String: value] as CFDictionary)
        if status == errSecItemNotFound {
            var entry = key
            entry[kSecValueData as String] = value
            entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(entry as CFDictionary, nil) == errSecSuccess else { throw PCError.message("Could not save the ChatGPT connection in Keychain.") }
        } else if status != errSecSuccess { throw PCError.message("Could not update the ChatGPT connection in Keychain.") }
    }
    static func remove(_ clientID: String) throws {
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: clientID] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw PCError.message("Could not clear the local connection.") }
    }
}

struct JWTIdentity {
    let subject: String
    let email: String
}

enum JWTValidator {
    static func der(_ tag: UInt8, _ content: Data) -> Data {
        var length = content.count
        var header = Data([tag])
        if length < 128 { header.append(UInt8(length)) }
        else {
            var bytes = [UInt8]()
            while length > 0 { bytes.insert(UInt8(length & 255), at: 0); length >>= 8 }
            header.append(UInt8(128 + bytes.count)); header.append(contentsOf: bytes)
        }
        header.append(content); return header
    }
    static func integer(_ data: Data) -> Data { der(0x02, data.first.map { $0 & 128 != 0 } == true ? Data([0]) + data : data) }
    static func validate(_ token: String, clientID: String, nonce: String?, jwks: [String: Any], now: Date = Date()) throws -> JWTIdentity {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, let headerData = Data(base64URL: parts[0]), let bodyData = Data(base64URL: parts[1]),
              let signature = Data(base64URL: parts[2]),
              let header = try JSONSerialization.jsonObject(with: headerData) as? [String: Any],
              let body = try JSONSerialization.jsonObject(with: bodyData) as? [String: Any],
              header["alg"] as? String == "RS256", let kid = header["kid"] as? String,
              let keys = jwks["keys"] as? [[String: Any]],
              let jwk = keys.first(where: { $0["kid"] as? String == kid && $0["kty"] as? String == "RSA" }),
              let n = jwk["n"] as? String, let e = jwk["e"] as? String,
              let modulus = Data(base64URL: n), let exponent = Data(base64URL: e) else { throw PCError.message("Invalid identity token.") }
        let keyData = der(0x30, integer(modulus) + integer(exponent))
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(keyData as CFData, [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic] as CFDictionary, &error),
              SecKeyVerifySignature(key, .rsaSignatureMessagePKCS1v15SHA256, Data("\(parts[0]).\(parts[1])".utf8) as CFData, signature as CFData, &error) else {
            throw PCError.message("ChatGPT identity signature could not be verified.")
        }
        let audiences = (body["aud"] as? [String]) ?? [body["aud"] as? String ?? ""]
        guard body["iss"] as? String == "https://auth.openai.com", audiences.contains(clientID),
              let expiry = body["exp"] as? Double, expiry > now.timeIntervalSince1970,
              let subject = body["sub"] as? String, !subject.isEmpty,
              nonce == nil || body["nonce"] as? String == nonce,
              (body["nbf"] as? Double ?? 0) <= now.timeIntervalSince1970 + 30 else { throw PCError.message("ChatGPT identity did not match this sign-in attempt.") }
        return JWTIdentity(subject: subject, email: body["email"] as? String ?? "ChatGPT account")
    }
}
