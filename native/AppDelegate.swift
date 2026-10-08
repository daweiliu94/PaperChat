import AppKit
import SwiftUI

@main struct PaperChatMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
        withExtendedLifetime(delegate) {}
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var model: CompanionModel!
    func applicationDidFinishLaunching(_ notification: Notification) {
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem()
        mainMenu.addItem(applicationItem)
        let applicationMenu = NSMenu(title: "PaperChat")
        applicationItem.submenu = applicationMenu
        applicationMenu.addItem(withTitle: "Quit PaperChat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        NSApp.mainMenu = mainMenu
        NotificationCenter.default.addObserver(self, selector: #selector(showSetup), name: paperChatSetupRequested, object: nil)
        model = CompanionModel()
    }
    @objc private func showSetup() {
        NSApp.setActivationPolicy(.regular)
        if window == nil {
            let setup = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 608, height: 760), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
            setup.title = "PaperChat Setup"; setup.isReleasedWhenClosed = false; setup.delegate = self
            setup.contentView = NSHostingView(rootView: CompanionView(model: model))
            setup.center(); window = setup
        }
        window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func application(_ application: NSApplication, open urls: [URL]) { showSetup() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showSetup(); return true }
    func windowWillClose(_ notification: Notification) { NSApp.setActivationPolicy(.accessory) }
    func applicationWillTerminate(_ notification: Notification) { model?.shutdown() }
}
