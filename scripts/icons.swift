import AppKit
import Foundation
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for size in [64, 128, 256, 512, 1024] {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    NSColor(calibratedRed: 0.06, green: 0.37, blue: 0.36, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size, height: size), xRadius: CGFloat(size) * 0.22, yRadius: CGFloat(size) * 0.22).fill()
    let rectangle = NSRect(x: CGFloat(size) * 0.22, y: CGFloat(size) * 0.16, width: CGFloat(size) * 0.53, height: CGFloat(size) * 0.68)
    NSColor.white.setStroke()
    let page = NSBezierPath(roundedRect: rectangle, xRadius: CGFloat(size) * 0.04, yRadius: CGFloat(size) * 0.04)
    page.lineWidth = CGFloat(size) * 0.045; page.stroke()
    for offset in [0.40, 0.54, 0.68] {
        let line = NSBezierPath(); line.move(to: NSPoint(x: CGFloat(size) * 0.34, y: CGFloat(size) * offset)); line.line(to: NSPoint(x: CGFloat(size) * 0.64, y: CGFloat(size) * offset)); line.lineWidth = CGFloat(size) * 0.035; line.stroke()
    }
    image.unlockFocus()
    let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("icon-\(size).png"))
}
