import Foundation
let project = URL(fileURLWithPath: "/Users/daweiliu/Documents/Codex Projects/Workspace/01_ACTIVE_PROJECTS/20261007_PaperChatHistory_001", isDirectory: true)
for path in ["working/PaperChat/.cache", "outputs/PaperChat 2.app"] {
    let url = project.appendingPathComponent(path)
    guard FileManager.default.fileExists(atPath: url.path) else { continue }
    guard (try url.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink != true else { continue }
    try FileManager.default.trashItem(at: url, resultingItemURL: nil)
    print("Moved disposable build artifact to Trash: " + path)
}
