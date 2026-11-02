// petprobe.swift — Mac 端桌宠定位探针（只读；不修改 Coopanion、不写用户配置）
// 用途：给显示窗 App 提供「桌宠窗口 + 角色头顶/脚底/水平中心」的实时数据。
// 编译：swiftc -O -o petprobe petprobe.swift -framework Cocoa -framework ScreenCaptureKit
// 用法：
//   petprobe info                     # 一次性输出屏幕/窗格信息 JSON
//   petprobe scan [--save out.png]    # 截一次并扫描，输出 JSON（物理像素 + 逻辑坐标）
//   petprobe watch [--interval 250] [--pid 37996] [--max 0]
//                                     # 常驻：每 interval 毫秒输出一行 JSON（App 逐行读取）
// 说明：
//   - 权限：需要「屏幕录制」（SCK）。未授权时输出 {"ok":false,"reason":"no-screen-permission"}，由 App 引导老板点允许。
//   - 只截「Cortico 桌宠」覆盖窗（透明），像素扫描用 alpha 与 RGB 双阈值（与 Win 版同思路，Retina 物理像素）。
//   - 输出里 px 为物理像素，pt 为逻辑点（除以 backingScale，再加窗口原点），可直接给窗口定位用。
import Foundation
import AppKit
import CoreGraphics
import ScreenCaptureKit

// ---------------- JSON 工具 ----------------
func jstr(_ s: String?) -> String {
    if s == nil { return "null" }
    var out = "\""
    for ch in s! {
        switch ch {
        case "\\": out += "\\\\"
        case "\"": out += "\\\""
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default: out.append(ch)
        }
    }
    return out + "\""
}
func jnum(_ v: Double, _ digits: Int = 2) -> String {
    return String(format: "%.\(digits)f", v)
}
func emit(_ obj: [String: String]) {
    let parts = obj.map { "\"\($0.key)\":\($0.value)" }.sorted()
    print("{" + parts.joined(separator: ",") + "}")
    fflush(stdout)
}

// ---------------- 窗口查找 ----------------
struct PetWin {
    var wid: Int
    var pid: Int
    var title: String
    var frame: CGRect     // 逻辑点，屏幕坐标（左上原点，与 CGWindow 一致）
    var layer: Int
    var owner: String
}

let ownerNames = ["Coopanion"]

func findPetWindow() -> PetWin? {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    var candidates: [(PetWin, Double)] = []
    for w in list {
        let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
        let title = (w[kCGWindowName as String] as? String) ?? ""
        let layer = (w[kCGWindowLayer as String] as? Int) ?? 0
        let bid = (w[kCGWindowOwnerPID as String] as? Int) ?? 0
        guard ownerNames.contains(where: { owner.contains($0) }) else { continue }
        guard let b = w[kCGWindowBounds as String] as? [String: Any] else { continue }
        let x = (b["X"] as? Double) ?? 0, y = (b["Y"] as? Double) ?? 0
        let ww = (b["Width"] as? Double) ?? 0, hh = (b["Height"] as? Double) ?? 0
        if ww < 200 || hh < 200 { continue }
        let isPet = title.contains("桌宠") || layer == 3
        if !isPet { continue }
        let wid = (w[kCGWindowNumber as String] as? Int) ?? 0
        let pw = PetWin(wid: wid, pid: bid, title: title, frame: CGRect(x: x, y: y, width: ww, height: hh), layer: layer, owner: owner)
        // 优先：标题含桌宠、layer 高、尺寸大
        var score = 0.0
        if title.contains("桌宠") { score += 1000 }
        score += Double(layer) * 10
        score += ww * hh / 1_000_000.0
        candidates.append((pw, score))
    }
    candidates.sort { $0.1 > $1.1 }
    return candidates.first?.0
}

func backingScale(for frame: CGRect) -> CGFloat {
    var best: CGFloat = 2.0
    for s in NSScreen.screens {
        if s.frame.intersects(frame) { best = s.backingScaleFactor; break }
    }
    return best
}

// ---------------- SCK 常驻上下文 ----------------
final class CaptureCtx {
    var content: SCShareableContent?
    var lastContentAt: Date = .distantPast
    var win: SCWindow?
    var winId: Int = 0

    func refreshContent() async -> Bool {
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            lastContentAt = Date()
            win = nil
            return content != nil
        } catch {
            content = nil
            return false
        }
    }

    func matchWindow(_ id: Int) async -> SCWindow? {
        if let c = content, let w = c.windows.first(where: { $0.windowID == id }) { return w }
        // 内容过期或窗口 id 变了：重新拉一次
        _ = await refreshContent()
        if let c = content, let w = c.windows.first(where: { $0.windowID == id }) { return w }
        return nil
    }
}

// ---------------- 扫描算法（Win 口径移植 + Retina 缩放） ----------------
struct ScanResult {
    var imgW = 0, imgH = 0
    var opaque = 0
    var topY = -1, feetY = -1, left = -1, right = -1
    var centerX = -1.0
    var bodyCenterX = -1.0
    var headY = -1
    var bodyW = -1, bodyH = -1
    var captureMs = 0.0, scanMs = 0.0
    var ok = false
    var reason = ""
}

func rgbaBuffer(_ img: CGImage) -> (Int, Int, [UInt8])? {
    let w = img.width, h = img.height
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    // 不翻转：第 0 行 = 图像顶部（经验证）
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (w, h, buf)
}

// 与 Win 同口径的常量；scale = backingScale（Retina=2）
func scanImage(_ img: CGImage, dpiScale: Double) -> ScanResult {
    var r = ScanResult()
    let t0 = Date()
    guard let (w, h, buf) = rgbaBuffer(img) else { r.reason = "buffer"; return r }
    r.imgW = w; r.imgH = h
    let alphaMin: UInt8 = 16
    // 1) bbox + 不透明像素
    var minX = w, maxX = -1, minY = h, maxY = -1, opaque = 0
    for y in 0..<h {
        let rowBase = y * w * 4
        for x in 0..<w {
            if buf[rowBase + x * 4 + 3] > alphaMin {
                if x < minX { minX = x }; if x > maxX { maxX = x }
                if y < minY { minY = y }; if y > maxY { maxY = y }
                opaque += 1
            }
        }
    }
    r.opaque = opaque
    if opaque == 0 { r.reason = "empty"; return r }
    r.topY = minY; r.feetY = maxY; r.left = minX; r.right = maxX
    r.centerX = Double(minX + maxX) / 2.0
    r.bodyCenterX = r.centerX

    // 2) 地面带（Win: 窗口高-2 往上 230px@100%；按 dpiScale 放大）
    let bandBottom = h - 2
    var bandHeight = Int(230.0 * dpiScale)
    if bandHeight > h - 8 { bandHeight = h - 8 }
    let bandTop = max(0, bandBottom - bandHeight)
    if bandBottom > bandTop {
        var colCount = [Int](repeating: 0, count: w)
        var colBottom = [Int](repeating: -1, count: w)
        var bandMinX = -1, bandMaxX = -1
        let pxThr: UInt8 = 24
        let feetThr: UInt8 = 60
        for y in bandTop..<bandBottom {
            let rowBase = y * w * 4
            for x in 0..<w {
                let p = rowBase + x * 4
                let rr = buf[p], gg = buf[p + 1], bb = buf[p + 2]
                var mx = rr; if gg > mx { mx = gg }; if bb > mx { mx = bb }
                if mx > pxThr || buf[p + 3] > alphaMin {
                    colCount[x] += 1
                    if bandMinX < 0 { bandMinX = x }
                    bandMaxX = x
                    if mx > feetThr || buf[p + 3] > 200 { colBottom[x] = y }
                }
            }
        }
        // 3) 脚部锚点：bbox 底部 10% 像素带的列质量质心（Win 口径）
        var bboxBottom = -1
        for x in 0..<w where colBottom[x] > bboxBottom { bboxBottom = colBottom[x] }
        if bboxBottom > bandTop {
            let footH = max(Int(6.0 * dpiScale), Int(Double(bboxBottom - bandTop) * 0.10))
            let footTop = max(bandTop, bboxBottom - footH + 1)
            var colFoot = [Int](repeating: 0, count: w)
            for y in footTop...bboxBottom {
                let rowBase = y * w * 4
                for x in 0..<w {
                    let p = rowBase + x * 4
                    let rr = buf[p], gg = buf[p + 1], bb = buf[p + 2]
                    var mx = rr; if gg > mx { mx = gg }; if bb > mx { mx = bb }
                    if mx > pxThr || buf[p + 3] > alphaMin { colFoot[x] += 1 }
                }
            }
            var mass = 0.0, sum = 0.0
            for x in 0..<w where colFoot[x] > 0 {
                mass += Double(colFoot[x]); sum += Double(x) * Double(colFoot[x])
            }
            if mass >= 40 { r.centerX = sum / mass }
        }
        // 4) 头顶：以脚部中心 ± 半宽先找候选行，再按「整行宽度」过滤掉头顶气泡/细箭头
        //    Win 原算法只取「最长连续行带」，遇到气泡与身体相连时会误把气泡顶当头顶（Mac 实测踩到）。
        //    改进：先用地面带 bbox 估身体宽度 Wbody；整行宽 > 2.2×Wbody 的行（气泡）或 < 0.18×Wbody（箭头）不算身体行。
        let petPxW0 = 77.0 * dpiScale
        // 身体宽度估计：取地面带「下三分之一」各行的整行宽度中位数（气泡底部即使探进地面带，
        // 也只占少数行，不会把中位数带偏；脚部/腿部宽度足够代表身体量级）
        var widths: [Int] = []
        var bboxBottomForW = -1
        for x in 0..<w where colBottom[x] > bboxBottomForW { bboxBottomForW = colBottom[x] }
        let lowerTop = (bboxBottomForW > bandTop) ? max(bandTop, bboxBottomForW - Int(Double(bboxBottomForW - bandTop) * 0.30)) : bandTop
        if bboxBottomForW > lowerTop {
            var yy = lowerTop
            while yy <= bboxBottomForW {
                let rowBase = yy * w * 4
                var mn = -1, mxX = -1
                var xx = 0
                while xx < w {
                    if buf[rowBase + xx * 4 + 3] > alphaMin { if mn < 0 { mn = xx }; mxX = xx }
                    xx += 1
                }
                if mn >= 0 {
                    let rw = mxX - mn + 1
                    if rw > 8 { widths.append(rw) }
                }
                yy += 2
            }
        }
        var Wbody = petPxW0
        if !widths.isEmpty {
            widths.sort()
            Wbody = Double(widths[widths.count / 2])
        }
        if Wbody < petPxW0 * 0.4 { Wbody = petPxW0 * 0.4 }
        let maxRowW = Int(Wbody * 2.4)
        let minRowW = max(3, Int(Wbody * 0.15))
        let halfW = max(Int(60.0 * dpiScale), Int(77.0 * dpiScale * 0.95))
        let cx = Int(r.centerX.rounded())
        let x0 = max(0, cx - halfW), x1 = min(w - 1, cx + halfW)
        if x1 > x0 {
            // 4a) 候选行：中心带内是否有像素
            var cand = [Bool](repeating: false, count: bandBottom)
            for y in 0..<bandBottom {
                let rowBase = y * w * 4
                for x in x0...x1 {
                    let p = rowBase + x * 4
                    if buf[p + 3] > alphaMin { cand[y] = true; break }
                }
            }
            // 4b) 候选行的整行宽度（物理像素），按宽度过滤
            var bodyRow = [Bool](repeating: false, count: bandBottom)
            var rowMinX = [Int](repeating: -1, count: bandBottom)
            var rowMaxX = [Int](repeating: -1, count: bandBottom)
            for y in 0..<bandBottom where cand[y] {
                let rowBase = y * w * 4
                var mn = -1, mxX = -1, cnt = 0
                var xx = 0
                while xx < w {
                    if buf[rowBase + xx * 4 + 3] > alphaMin { if mn < 0 { mn = xx }; mxX = xx; cnt += 1 }
                    xx += 1
                }
                if mn < 0 { continue }
                let rw = mxX - mn + 1
                if rw > maxRowW || rw < minRowW { continue }   // 气泡太宽 / 箭头太窄 → 不算身体
                if cnt < 2 { continue }
                bodyRow[y] = true
                rowMinX[y] = mn
                rowMaxX[y] = mxX
            }
            // 4c) 最长连续身体行带 = 本体；头顶 = 该带顶边
            var bestH = 0, bestTop = -1, runTop = -1, runLast = -1
            for y in 0..<bandBottom {
                if !bodyRow[y] {
                    if runTop >= 0 { let hh = runLast - runTop + 1; if hh > bestH { bestH = hh; bestTop = runTop }; runTop = -1 }
                    continue
                }
                if runTop < 0 { runTop = y; runLast = y; continue }
                runLast = y
            }
            if runTop >= 0 { let hh = runLast - runTop + 1; if hh > bestH { bestH = hh; bestTop = runTop } }
            if bestTop >= 0 && bestH >= 10 {
                r.headY = bestTop
                var mnX = Int.max, mxX = -1
                for y in bestTop..<bandBottom where bodyRow[y] {
                    if rowMinX[y] >= 0 && rowMinX[y] < mnX { mnX = rowMinX[y] }
                    if rowMaxX[y] > mxX { mxX = rowMaxX[y] }
                }
                if mxX >= 0 && mnX != Int.max {
                    r.bodyCenterX = Double(mnX + mxX) / 2.0
                    r.bodyW = mxX - mnX + 1
                    r.bodyH = r.feetY - bestTop + 1
                }
            }
        }
    }
    r.scanMs = Date().timeIntervalSince(t0) * 1000.0
    r.ok = true
    return r
}

// ---------------- 截图 ----------------
final class Capturer {
    var ctx = CaptureCtx()

    func capture(wid: Int) async -> (CGImage?, PetWin?, String) {
        // R-49：先用不弹窗的 CGPreflight 判断；无授权直接返回，绝不调用 SCK（避免后台反复请求/弹窗）
        guard CGPreflightScreenCaptureAccess() else { return (nil, findPetWindow(), "no-screen-permission") }
        guard let w = await ctx.matchWindow(wid) else { return (nil, findPetWindow(), "window-not-found") }
        let f = w.frame
        let scale = backingScale(for: f)
        let cfg = SCStreamConfiguration()
        cfg.width = Int(f.width * scale)
        cfg.height = Int(f.height * scale)
        cfg.showsCursor = false
        cfg.ignoreShadowsSingleWindow = true
        cfg.captureResolution = .best
        do {
            let filter = SCContentFilter(desktopIndependentWindow: w)
            let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
            let pw = PetWin(wid: Int(w.windowID), pid: 0, title: w.title ?? "", frame: f, layer: w.windowLayer, owner: "Coopanion")
            return (img, pw, "")
        } catch {
            return (nil, nil, "capture-error: \(error.localizedDescription)")
        }
    }
}

// ---------------- 输出 ----------------
func emitScan(_ r: ScanResult, _ pw: PetWin?, _ scale: CGFloat) {
    var o: [String: String] = [:]
    o["ok"] = r.ok ? "true" : "false"
    if !r.ok { o["reason"] = jstr(r.reason) }
    o["imgW"] = "\(r.imgW)"; o["imgH"] = "\(r.imgH)"
    o["opaque"] = "\(r.opaque)"
    o["captureMs"] = jnum(r.captureMs, 1)
    o["scanMs"] = jnum(r.scanMs, 1)
    if let pw = pw {
        o["wid"] = "\(pw.wid)"
        o["winX"] = jnum(Double(pw.frame.origin.x))
        o["winY"] = jnum(Double(pw.frame.origin.y))
        o["winW"] = jnum(Double(pw.frame.width))
        o["winH"] = jnum(Double(pw.frame.height))
        o["winLayer"] = "\(pw.layer)"
        o["winTitle"] = jstr(pw.title)
        o["scale"] = jnum(Double(scale))
        let s = Double(scale)
        // 物理像素 → 屏幕逻辑坐标
        o["feetPt"] = jnum(Double(pw.frame.origin.y) + Double(r.feetY) / s)
        o["headPt"] = r.headY >= 0 ? jnum(Double(pw.frame.origin.y) + Double(r.headY) / s) : "-1"
        o["centerPt"] = jnum(Double(pw.frame.origin.x) + r.centerX / s)
        o["bodyCenterPt"] = jnum(Double(pw.frame.origin.x) + r.bodyCenterX / s)
        let bodyTop = r.headY >= 0 ? r.headY : r.topY
        o["charHpt"] = jnum(Double(r.feetY - bodyTop + 1) / s)
        o["charWpt"] = jnum(r.bodyW > 0 ? Double(r.bodyW) / s : Double(r.right - r.left + 1) / s)
    }
    emit(o)
}

func emitInfo(_ pw: PetWin?, _ scale: CGFloat) {
    var o: [String: String] = ["ok": pw != nil ? "true" : "false"]
    o["screens"] = "[\(NSScreen.screens.map { "[\(jnum(Double($0.frame.origin.x))),\(jnum(Double($0.frame.origin.y))),\(jnum(Double($0.frame.width))),\(jnum(Double($0.frame.height))),\(jnum(Double($0.backingScaleFactor)))]" }.joined(separator: ","))]"
    if let pw = pw {
        o["wid"] = "\(pw.wid)"; o["pid"] = "\(pw.pid)"; o["title"] = jstr(pw.title)
        o["winX"] = jnum(Double(pw.frame.origin.x)); o["winY"] = jnum(Double(pw.frame.origin.y))
        o["winW"] = jnum(Double(pw.frame.width)); o["winH"] = jnum(Double(pw.frame.height))
        o["winLayer"] = "\(pw.layer)"; o["scale"] = jnum(Double(scale))
        o["screenCapture"] = CGPreflightScreenCaptureAccess() ? "true" : "false"
    }
    emit(o)
}

// ---------------- main ----------------
_ = NSApplication.shared
NSApplication.shared.setActivationPolicy(.accessory)
_ = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "info"

func argValue(_ name: String, _ def: String) -> String {
    if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }
    return def
}

let sem = DispatchSemaphore(value: 0)
Task {
    let capturer = Capturer()
    switch mode {
    case "info":
        let pw = findPetWindow()
        emitInfo(pw, pw != nil ? backingScale(for: pw!.frame) : 2.0)
        sem.signal()
    case "scan":
        let savePath = argValue("--save", "")
        guard CGPreflightScreenCaptureAccess() else { emit(["ok": "false", "reason": jstr("no-screen-permission"), "preflight": "false"]); sem.signal(); return }
        guard let pw0 = findPetWindow() else { emit(["ok": "false", "reason": jstr("no-pet-window")]); sem.signal(); return }
        let t0 = Date()
        let (img, pw, err) = await capturer.capture(wid: pw0.wid)
        let captureMs = Date().timeIntervalSince(t0) * 1000.0
        if let img = img, let pw = pw {
            let scale = backingScale(for: pw.frame)
            var r = scanImage(img, dpiScale: Double(scale))
            r.captureMs = captureMs
            let savePath = argValue("--save", "")
            if !savePath.isEmpty {
                if let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: savePath) as CFURL, "public.png" as CFString, 1, nil) {
                    CGImageDestinationAddImage(dest, img, nil)
                    _ = CGImageDestinationFinalize(dest)
                }
            }
            emitScan(r, pw, scale)
        } else {
            emit(["ok": "false", "reason": jstr(err)])
        }
        sem.signal()
    case "scanfile":
        // 离线回归：scanfile --input <png> [--scale 2]（用真实截图验证扫描算法，不需要现场桌宠）
        let input = argValue("--input", "")
        let scaleIn = Double(argValue("--scale", "2")) ?? 2.0
        guard !input.isEmpty, let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: input) as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            emit(["ok": "false", "reason": jstr("bad-input")]); sem.signal(); return
        }
        let pw = findPetWindow()
        let scale = pw != nil ? backingScale(for: pw!.frame) : CGFloat(scaleIn)
        let r = scanImage(img, dpiScale: Double(scale))
        emitScan(r, pw, scale)
        sem.signal()
    case "watch":
        // R-49：无授权直接退出（只输出一次 preflight 结果，不调 SCK、不循环请求）
        guard CGPreflightScreenCaptureAccess() else {
            emit(["ok": "false", "reason": jstr("no-screen-permission"), "preflight": "false"])
            sem.signal(); return
        }
        let interval = Int(argValue("--interval", "250")) ?? 250
        let maxTicks = Int(argValue("--max", "0")) ?? 0
        var tick = 0
        // 先发一条「fast 行」：只用 CGWindowList 拿窗口 bounds（不需要屏幕录制、毫秒级），
        // 让 App 的兜底定位立刻有桌宠窗口位置；随后 SCK 首采可能较慢（冷启动），检测到了再纠正。
        if let pw0 = findPetWindow() {
            let scale = backingScale(for: pw0.frame)
            emit(["ok": "false", "fast": "true", "reason": jstr("warming"),
                  "wid": "\(pw0.wid)", "winX": jnum(Double(pw0.frame.origin.x)),
                  "winY": jnum(Double(pw0.frame.origin.y)),
                  "winW": jnum(Double(pw0.frame.width)), "winH": jnum(Double(pw0.frame.height)),
                  "scale": jnum(Double(scale)), "winTitle": jstr(pw0.title)])
        }
        while true {
            let tickStart = Date()
            if let pw0 = findPetWindow() {
                if capturer.ctx.winId != pw0.wid {
                    capturer.ctx.winId = pw0.wid
                    _ = await capturer.ctx.refreshContent()
                }
                let t0 = Date()
                let (img, pw, err) = await capturer.capture(wid: pw0.wid)
                let captureMs = Date().timeIntervalSince(t0) * 1000.0
                if let img = img, let pw = pw {
                    let scale = backingScale(for: pw.frame)
                    var r = scanImage(img, dpiScale: Double(scale))
                    r.captureMs = captureMs
                    emitScan(r, pw, scale)
                } else {
                    var o: [String: String] = ["ok": "false", "reason": jstr(err), "captureMs": jnum(captureMs, 1)]
                    if let pb = findPetWindow() {
                        o["wid"] = "\(pb.wid)"; o["winX"] = jnum(Double(pb.frame.origin.x))
                        o["winY"] = jnum(Double(pb.frame.origin.y)); o["winW"] = jnum(Double(pb.frame.width))
                        o["winH"] = jnum(Double(pb.frame.height)); o["scale"] = jnum(Double(backingScale(for: pb.frame)))
                    }
                    emit(o)
                }
            } else {
                emit(["ok": "false", "reason": jstr("no-pet-window")])
            }
            tick += 1
            if maxTicks > 0 && tick >= maxTicks { break }
            let elapsed = Date().timeIntervalSince(tickStart)
            let wait = max(0.01, Double(interval) / 1000.0 - elapsed)
            Thread.sleep(forTimeInterval: wait)
        }
        sem.signal()
    default:
        print("modes: info | scan [--save png] | watch [--interval ms] [--max n]")
        sem.signal()
    }
}
sem.wait()
