// 生成 App 图标:矢量绘制的扁平化学士帽 + 紫色渐变圆角方块。
// 纯 CoreGraphics 路径绘制(不依赖 emoji 字体渲染),任意尺寸清晰。
// 用法: swift make-icon.swift <输出路径>
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.png"
let size: CGFloat = 1024
let image = NSImage(size: NSSize(width: size, height: size))

image.lockFocus()

// ---- 底板:Big Sur 风格圆角方块(824px 居中,四周留 ~10% 边距) ----
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = NSBezierPath(roundedRect: tile, xRadius: 184, yRadius: 184)
tilePath.addClip()

NSGradient(colors: [
    NSColor(calibratedRed: 0.27, green: 0.23, blue: 0.90, alpha: 1), // 靛蓝
    NSColor(calibratedRed: 0.58, green: 0.36, blue: 0.97, alpha: 1), // 紫
])?.draw(in: tile, angle: -60)

// 左上柔光,增加层次
let glow = NSGradient(colors: [NSColor.white.withAlphaComponent(0.16), NSColor.white.withAlphaComponent(0)])
glow?.draw(in: NSBezierPath(ovalIn: NSRect(x: -180, y: 420, width: 900, height: 900)), angle: -90)

// 帽体整体上移,落到视觉中心(光学校中心略高于几何中心)
NSGraphicsContext.current?.cgContext.translateBy(x: 0, y: 50)

// ---- 学士帽(AppKit y 轴向上) ----
let cx: CGFloat = 512
// 帽筒(帽板下方的开口,先画,上大半会被帽板盖住)
let base = NSBezierPath(ovalIn: NSRect(x: cx - 205, y: 205, width: 410, height: 310))
NSColor(calibratedRed: 0.13, green: 0.11, blue: 0.35, alpha: 1).setFill() // 深靛
base.fill()

// 帽板厚度:同一菱形下移 22px,深色
let boardTop   = CGPoint(x: cx, y: 640)
let boardRight = CGPoint(x: 822, y: 480)
let boardBot   = CGPoint(x: cx, y: 320)
let boardLeft  = CGPoint(x: 202, y: 480)

func rhombus(offsetY: CGFloat) -> NSBezierPath {
    let p = NSBezierPath()
    p.move(to: NSPoint(x: boardTop.x, y: boardTop.y + offsetY))
    p.line(to: NSPoint(x: boardRight.x, y: boardRight.y + offsetY))
    p.line(to: NSPoint(x: boardBot.x, y: boardBot.y + offsetY))
    p.line(to: NSPoint(x: boardLeft.x, y: boardLeft.y + offsetY))
    p.close()
    return p
}

NSColor(calibratedRed: 0.17, green: 0.14, blue: 0.48, alpha: 1).setFill() // 板侧影
rhombus(offsetY: -22).fill()

// 帽板顶面:白 → 淡紫渐变
NSGradient(colors: [
    NSColor(calibratedWhite: 1.0, alpha: 1),
    NSColor(calibratedRed: 0.90, green: 0.87, blue: 1.0, alpha: 1),
])?.draw(in: rhombus(offsetY: 0), angle: 90)

// 板中央纽扣
let button = NSBezierPath(ovalIn: NSRect(x: cx - 24, y: 470 - 24, width: 48, height: 48))
NSColor(calibratedRed: 0.98, green: 0.76, blue: 0.25, alpha: 1).setFill() // 金
button.fill()

// ---- 流苏:从纽扣搭过板沿垂下 ----
let cord = NSBezierPath()
cord.move(to: NSPoint(x: cx, y: 470))
cord.curve(to: NSPoint(x: 700, y: 330),
           controlPoint1: NSPoint(x: cx + 90, y: 455),
           controlPoint2: NSPoint(x: 690, y: 420))
cord.line(to: NSPoint(x: 700, y: 265))
cord.lineWidth = 15
cord.lineCapStyle = .round
NSColor(calibratedRed: 0.99, green: 0.80, blue: 0.30, alpha: 1).setStroke()
cord.stroke()

// 流苏穗(胶囊形)+ 束环
let tasselRect = NSRect(x: 700 - 30, y: 120, width: 60, height: 165)
NSGradient(colors: [
    NSColor(calibratedRed: 1.0, green: 0.84, blue: 0.38, alpha: 1),
    NSColor(calibratedRed: 0.95, green: 0.66, blue: 0.16, alpha: 1),
])?.draw(in: NSBezierPath(roundedRect: tasselRect, xRadius: 28, yRadius: 28), angle: -90)
let band = NSBezierPath(ovalIn: NSRect(x: 700 - 21, y: 262, width: 42, height: 34))
NSColor(calibratedRed: 0.85, green: 0.58, blue: 0.10, alpha: 1).setFill()
band.fill()

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fputs("图标渲染失败\n", stderr)
    exit(1)
}
try png.write(to: URL(fileURLWithPath: out))
print("✓ 图标已生成: \(out) (\(Int(size))px)")
