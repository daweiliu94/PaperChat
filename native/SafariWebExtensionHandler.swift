import Foundation
import SafariServices
import AppKit

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let launcher = CompanionLauncher()
    func beginRequest(with context: NSExtensionContext) {
        guard let item = context.inputItems.first as? NSExtensionItem,
              let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any] else { complete(context, ["ok": false, "error": "Invalid native message."]); return }
        let request: [String: Any] = message["action"] as? String == "openApp" ? ["action": "openSetup"] : message
        DispatchQueue.global(qos: .userInitiated).async {
          Task {
            do {
                let channel = try await Self.launcher.channel()
                try channel.send(JSONSerialization.data(withJSONObject: request))
                let reply = (try JSONSerialization.jsonObject(with: channel.receive())) as? [String: Any] ?? ["ok": false, "error": "Invalid companion response."]
                self.complete(context, reply)
            } catch let error as PCError {
                self.complete(context, ["ok": false, "error": error.localizedDescription])
            } catch { self.complete(context, ["ok": false, "error": "The companion connection failed. Restart PaperChat, then try again."]) }
          }
        }
    }
    private func complete(_ context: NSExtensionContext, _ value: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: value]
        context.completeRequest(returningItems: [response])
    }
}
