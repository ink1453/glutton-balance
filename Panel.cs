// -*- coding: utf-8 -*-
// 饭桶余额（X：独立显示窗）
// 无边框 / 置顶 / 逐像素透明 / 点击穿透 / 不抢焦点 / 不进 Alt+Tab / 无任务栏按钮。
// 编译：csc.exe /nologo /target:winexe /out:panel.exe /r:System.dll /r:System.Drawing.dll /r:System.Core.dll Panel.cs
// 只读余额接口；密钥运行时从本机文件读取，绝不打印 / 写日志。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// ---- 0.0.7（第 27 轮）：Win 显示窗版本元数据同号 0.0.7，与 Mac / npm / 插件市场统一 ----
// 只写 exe 的 Win32 版本资源（属性→详细信息 可查），不改任何运行逻辑；
// 编译后可在 Win 侧核对：(Get-Item .\panel.exe).VersionInfo.FileVersion → 0.0.7.0
// 0.0.7 变化：新增 minicard 小面板形态（一行一家）；金额去小数；CREDITS 改「C 2177」口径。
[assembly: System.Reflection.AssemblyVersion("0.0.7.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.0.7.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("0.0.7")]

namespace GluttonBalance
{
    internal static class Program
    {
        internal static AppContext App;
        private static Native.WndProcDelegate s_wndProc;

        [STAThread]
        private static int Main(string[] args)
        {
            EnableModernTls();
            bool quitRequested = false;
            int demoCount = 0;
            string shotPath = null;
            string selftestPath = null;
            string shotLabel = null;
            string shotWear = null;
            string shotLayout = null;
            string shotTheme = null;
            string shotState = null;
            double shotScale = 0;
            string probePath = null;
            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string a = args[i] == null ? "" : args[i];
                    if (a == "--quit" || a == "-quit" || a == "/quit") { quitRequested = true; continue; }
                    if ((a == "--demo" || a == "-demo") && i + 1 < args.Length)
                    {
                        int n;
                        if (int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out n) && n > 0 && n <= 12)
                        {
                            demoCount = n;
                            i++;
                        }
                        continue;
                    }
                    if ((a == "--shot" || a == "-shot") && i + 1 < args.Length) { shotPath = args[i + 1]; i++; continue; }
                    if ((a == "--selftest" || a == "-selftest") && i + 1 < args.Length) { selftestPath = args[i + 1]; i++; continue; }
                    if ((a == "--label" || a == "-label") && i + 1 < args.Length) { shotLabel = args[i + 1]; i++; continue; }
                    if ((a == "--wear" || a == "-wear") && i + 1 < args.Length) { shotWear = args[i + 1]; i++; continue; }
                    if ((a == "--layout" || a == "-layout") && i + 1 < args.Length) { shotLayout = args[i + 1]; i++; continue; }
                    if ((a == "--theme" || a == "-theme") && i + 1 < args.Length) { shotTheme = args[i + 1]; i++; continue; }
                    if ((a == "--state" || a == "-state") && i + 1 < args.Length) { shotState = args[i + 1]; i++; continue; }
                    if ((a == "--scale" || a == "-scale") && i + 1 < args.Length)
                    {
                        double sd;
                        if (double.TryParse(args[i + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out sd)) shotScale = sd;
                        i++; continue;
                    }
                    if ((a == "--probe-pet" || a == "-probe-pet") && i + 1 < args.Length) { probePath = args[i + 1]; i++; continue; }
                }
            }
            if (quitRequested) return QuitRunningInstance();
            // v3：无窗口模式（给测试/出图用，不碰正在运行的面板窗口）
            if (!string.IsNullOrEmpty(selftestPath)) return ProgramV3.RunSelftest(selftestPath);
            if (!string.IsNullOrEmpty(probePath)) return ProgramV3.ProbePet(probePath);
            if (!string.IsNullOrEmpty(shotPath)) return ProgramV3.RunShot(shotPath, demoCount <= 0 ? 2 : demoCount, shotLabel, shotWear, shotLayout, shotTheme, shotScale, shotState);

            bool created = false;
            using (Mutex mutex = new Mutex(true, AppContext.MutexName, out created))
            {
                if (!created) return 0; // 已有实例在跑，直接退出
                try { return Run(demoCount); }
                finally
                {
                    try { mutex.ReleaseMutex(); }
                    catch { }
                }
            }
        }

        /// <summary>
        /// 0.0.7 修复：.NET Framework 4.0 的默认 SecurityProtocol 只有 Ssl3+Tls（1.0），
        /// 而 Qoder 的 openapi.qoder.com.cn 只接受 TLS 1.2 以上，握手直接 SecureChannelFailure
        /// （日志表现为 NETWORK (qoder.exchange)）。这里显式开启 TLS 1.2/1.1，
        /// 老系统不支持时静默跳过，保留原有行为，不影响 DeepSeek / A6 等仍走 TLS 1.0 的站点。
        /// </summary>
        private static void EnableModernTls()
        {
            try
            {
                // 3072 = Tls12，768 = Tls11（用数值兜底：老编译器可能没有 Tls12 枚举成员）
                ServicePointManager.SecurityProtocol =
                    (SecurityProtocolType)3072 | (SecurityProtocolType)768 | SecurityProtocolType.Tls;
            }
            catch
            {
                try { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls; } catch { }
            }
        }

        /// <summary>通知已在运行的实例退出；最多等 5 秒，进程真的没了才返回 0。</summary>
        private static int QuitRunningInstance()
        {
            try
            {
                using (EventWaitHandle ev = EventWaitHandle.OpenExisting(AppContext.QuitEventName)) { ev.Set(); }
            }
            catch (WaitHandleCannotBeOpenedException) { return 0; }
            catch (Exception) { return 0; }
            Stopwatch sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < 5000)
            {
                try
                {
                    using (Mutex probe = Mutex.OpenExisting(AppContext.MutexName)) { }
                }
                catch (WaitHandleCannotBeOpenedException) { return 0; }
                catch (Exception) { return 0; }
                Thread.Sleep(100);
            }
            return 1;
        }

        // ---------------- 改名兼容（2026-11-02）：旧配置目录 → 新配置目录一次性迁移 ----------------
        // 规则：程序目录下没有 config.json 且旧目录有 → 复制 config.json、bowls/、rice/；
        // 旧目录原样保留；幂等、不覆盖新目录已有文件；日志一行说明。
        internal static string UserDataDir()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(Path.Combine(home, ".dsh"), "glutton-balance");
        }

        internal static string LegacyUserDataDir()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(Path.Combine(home, ".dsh"), "pet-balance-panel");
        }

        private static void MigrateLegacyUserData(string baseDir)
        {
            try
            {
                string legacyDir = LegacyUserDataDir();
                string userDir = UserDataDir();
                string legacyCfg = Path.Combine(legacyDir, "config.json");
                string targetCfg = Path.Combine(baseDir, "config.json");
                bool migrated = false;
                if (!File.Exists(targetCfg) && File.Exists(legacyCfg))
                {
                    Directory.CreateDirectory(baseDir);
                    File.Copy(legacyCfg, targetCfg, false);
                    migrated = true;
                }
                string legacyBowls = Path.Combine(legacyDir, "bowls");
                if (Directory.Exists(legacyBowls))
                {
                    migrated |= CopyDirMissing(legacyBowls, Path.Combine(userDir, "bowls"));
                }
                string legacyRice = Path.Combine(legacyDir, "rice");
                if (Directory.Exists(legacyRice))
                {
                    migrated |= CopyDirMissing(legacyRice, Path.Combine(userDir, "rice"));
                }
                if (migrated)
                {
                    Log.Write("config migrated from legacy dir: " + legacyDir + " -> " + userDir + " (old dir kept)");
                }
            }
            catch (Exception ex)
            {
                Log.Write("WARN legacy config migrate failed: " + SafeText(ex.Message));
            }
        }

        private static bool CopyDirMissing(string src, string dst)
        {
            bool copied = false;
            try { Directory.CreateDirectory(dst); } catch { return false; }
            foreach (string file in Directory.GetFiles(src))
            {
                string target = Path.Combine(dst, Path.GetFileName(file));
                if (File.Exists(target)) continue;
                try { File.Copy(file, target, false); copied = true; }
                catch { }
            }
            foreach (string dir in Directory.GetDirectories(src))
            {
                copied |= CopyDirMissing(dir, Path.Combine(dst, Path.GetFileName(dir)));
            }
            return copied;
        }

        private static int Run(int demoCount)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            baseDir = baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            Log.Init(Path.Combine(baseDir, "panel.log"));
            MigrateLegacyUserData(baseDir);
            NativeV3.TryEnablePerMonitorV2();
            App = new AppContext(baseDir);
            App.DemoCount = Math.Max(0, Math.Min(12, demoCount));
            Log.Write("start pid=" + Process.GetCurrentProcess().Id + " demo=" + App.DemoCount + " dpiAware=" + NativeV3.DpiAwarenessMode);

            s_wndProc = new Native.WndProcDelegate(WndProc);
            IntPtr hInstance = Native.GetModuleHandle(null);
            Native.WNDCLASSEX wc = new Native.WNDCLASSEX();
            wc.cbSize = Marshal.SizeOf(typeof(Native.WNDCLASSEX));
            wc.style = 0;
            wc.lpfnWndProc = s_wndProc;
            wc.hInstance = hInstance;
            wc.hCursor = IntPtr.Zero;
            wc.hbrBackground = IntPtr.Zero;
            wc.lpszMenuName = null;
            wc.lpszClassName = AppContext.WindowClass;
            wc.hIcon = IntPtr.Zero;
            wc.hIconSm = IntPtr.Zero;
            ushort atom = Native.RegisterClassEx(ref wc);
            if (atom == 0)
            {
                Log.Write("ERROR RegisterClassEx failed err=" + Marshal.GetLastWin32Error());
                return 2;
            }
            IntPtr hwnd = Native.CreateWindowEx(
                0, AppContext.WindowClass, "GluttonBalance", Native.WS_POPUP,
                0, 0, 448, 46, IntPtr.Zero, IntPtr.Zero, hInstance, IntPtr.Zero);
            if (hwnd == IntPtr.Zero)
            {
                Log.Write("ERROR CreateWindowEx failed err=" + Marshal.GetLastWin32Error());
                return 3;
            }
            Native.SetWindowText(hwnd, "GluttonBalance");
            int titleLen = Native.GetWindowTextLength(hwnd);
            StringBuilder titleBuf = new StringBuilder(128);
            Native.GetWindowText(hwnd, titleBuf, titleBuf.Capacity);
            Log.Write("window hwnd=0x" + hwnd.ToInt64().ToString("X") + " titleLen=" + titleLen + " title=" + titleBuf.ToString());
            App.AttachWindow(hwnd);
            App.Start();
            Native.MSG msg;
            int gm;
            while ((gm = Native.GetMessage(out msg, IntPtr.Zero, 0, 0)) > 0)
            {
                Native.TranslateMessage(ref msg);
                Native.DispatchMessage(ref msg);
            }
            App.Shutdown();
            Log.Write("exit code=" + gm);
            return 0;
        }

        private static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                switch (msg)
                {
                    case Native.WM_HOTKEY:
                        if (App != null) App.RequestRefresh();
                        return IntPtr.Zero;
                    case Native.WM_TIMER:
                        if (App != null) App.AnimTick();
                        return IntPtr.Zero;
                    case 0x0202: // WM_LBUTTONUP：可选交互（仅 clickThrough=false 时生效）
                        if (App != null) App.OnPanelClick();
                        return IntPtr.Zero;
                    case Native.WM_NCHITTEST:
                        // 点击穿透：命中测试直接放行；关闭穿透时正常接收鼠标
                        if (App != null && App.IsClickThrough())
                        {
                            return new IntPtr(Native.HTTRANSPARENT);
                        }
                        return new IntPtr(Native.HTCLIENT);
                    case AppContext.WM_APP_REDRAW:
                        if (App != null) App.Repaint();
                        return IntPtr.Zero;
                    case AppContext.WM_APP_QUIT:
                        Native.DestroyWindow(hWnd);
                        return IntPtr.Zero;
                    case Native.WM_CLOSE:
                        Native.DestroyWindow(hWnd);
                        return IntPtr.Zero;
                    case Native.WM_DESTROY:
                        if (App != null) App.MarkQuit();
                        Native.PostQuitMessage(0);
                        return IntPtr.Zero;
                }
            }
            catch (Exception ex)
            {
                Log.Write("ERROR WndProc msg=" + msg + ": " + SafeText(ex.Message));
            }
            return Native.DefWindowProc(hWnd, msg, wParam, lParam);
        }

        internal static string SafeText(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            s = s.Replace("\r", " ").Replace("\n", " ");
            if (s.Length > 200) s = s.Substring(0, 200);
            return s;
        }
    }

    // ------------------------------------------------------------------ 状态与定位

    internal struct Placement
    {
        public bool Valid;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public string Mode;
        public string ZOrder;
        public double PetCenterX;
        public int RawX;
        public int ClampOffsetX;
        /// <summary>本帧角色中心来源：detect（PrintWindow 实时检测）/ startX（/api/state 兜底）/ fallback-*。</summary>
        public string Source;
        /// <summary>v4：本帧饭桶位置（feet/head）与头顶屏幕 y（head 用，日志/诊断）。</summary>
        public string Wear;
        public int HeadScreenY;

        public bool SameAs(Placement o)
        {
            return Valid == o.Valid && X == o.X && Y == o.Y && Width == o.Width && Height == o.Height
                && RawX == o.RawX && Math.Abs(PetCenterX - o.PetCenterX) < 0.01
                && string.Equals(Mode, o.Mode, StringComparison.Ordinal)
                && string.Equals(ZOrder, o.ZOrder, StringComparison.Ordinal)
                && string.Equals(Source, o.Source, StringComparison.Ordinal)
                && string.Equals(Wear, o.Wear, StringComparison.Ordinal)
                && HeadScreenY == o.HeadScreenY;
        }
    }

    internal sealed class ProviderView
    {
        public string Name = "";
        public bool HasResult;
        public bool Ok;
        public double Amount;
        public bool Low;
        public string Error = "";
        public string Currency = "CNY";
        /// <summary>0.0.7：显示单位 CNY / USD / CREDITS（明细卡阈值文案与金额格式用；qoder 默认 CREDITS）。</summary>
        public string Unit = "CNY";
        // ---- v3：白饭桶 / 明细展开用 ----
        public string Id = "";
        public bool Rice;
        public double Ratio = 1.0;
        public double FullAmount = 100;
        public double Threshold = double.NaN;
        public int IntervalSec = 60;
        public long LastAttemptMs = -1;
        public long LastOkMs = -1;
        // ---- v22 网络瞬断韧性：失败后 10 分钟内继续显示「最后一次成功金额」（灰字=非实时）----
        /// <summary>是否有过成功值（rt.LastGoodMs &gt; 0）。</summary>
        public bool HasLastGood;
        /// <summary>本次结果失败、但上次成功值还在 10 分钟窗口内 → 显示上次金额（灰字）。</summary>
        public bool ShowLastGood;
        public double LastGoodAmount;
        public string LastGoodCurrency = "CNY";
        public long LastGoodMs = -1;
    }

    internal sealed class ProviderRuntime
    {
        public ProviderConfig Cfg;
        public BalanceResult Result;
        public long NextDueMs;
        public int FailStreak;
        public volatile bool Fetching;
        public long LastAttemptMs = -1;
        public long LastOkMs = -1;
        // ---- v22 网络瞬断韧性：记住最后一次成功值（失败不清空），并跟踪「灰字上次金额」当前是否在显示 ----
        public double LastGoodAmount;
        public string LastGoodCurrency = "CNY";
        /// <summary>最后一次成功的时间（-1 = 从未成功）。</summary>
        public long LastGoodMs = -1;
        /// <summary>UI 当前是否正在显示「上次成功金额」（用于 10 分钟窗口到期时触发一次重绘）。</summary>
        public bool StaleShown;
    }

    internal sealed class AppContext
    {
        public const string WindowClass = "GluttonBalanceWnd";
        public const string MutexName = "Local\\GluttonBalance.SingleInstance";
        public const string QuitEventName = "Local\\GluttonBalance.Quit";
        public const uint WM_APP_REDRAW = 0x8001;
        public const uint WM_APP_QUIT = 0x8002;

        /// <summary>脚底相对工作区底部的内缩（实测：工作区底 1392，角色脚底 1390）。</summary>
        private const int FootInset = 2;
        /// <summary>无 /api/state 时的兜底角色中心比例（贴右侧屏幕的通用估值，正常情况一律用接口值）。</summary>
        private const double DefaultStartX = 0.95;

        // ---- 实时定位（PrintWindow 地面带像素簇检测）：/api/state 的 startX 是「保存值」，拖动桌宠后不跟 ----
        /// <summary>地面带：窗口高-2 往上这么多像素（避开头顶气泡/悬停按钮）。</summary>
        private const int DetectBandHeight = 230;
        /// <summary>地面带里 (R,G,B) 最大值超过该阈值才算角色像素（透明区 PrintWindow 渲染为纯黑 0）。</summary>
        private const int DetectPixelThreshold = 24;
        /// <summary>单列至少这么多像素才算「有效列」，滤掉抗锯齿杂点。</summary>
        private const int DetectMinColumnPixels = 2;
        /// <summary>列簇允许宽度范围（像素）；太窄是杂点、太宽不是单个角色。</summary>
        private const int DetectMinClusterWidth = 60;
        private const int DetectMaxClusterWidth = 450;
        /// <summary>列簇内允许的小空隙（抗锯齿/服饰镂空）。</summary>
        private const int DetectClusterGapPx = 2;
        /// <summary>脚底检测阈值：比角色中心检测更亮一些，避开淡淡的地面影子。</summary>
        private const int DetectFeetThreshold = 60;
        /// <summary>连续检测失败达到该次数后，退回 /api/state 的 startX。</summary>
        private const int DetectFailFallback = 3;
        /// <summary>检测到的中心变化小于该像素数不重排（防抖）。</summary>
        private const double DetectDeadbandPx = 2.0;
        /// <summary>检测坐标超过该时长没有成功更新则视为过期，退回 startX（v3.3 检测间隔 250ms，给 3 个周期余量）。</summary>
        private const long DetectStaleMs = 15000;
        /// <summary>一次抓图耗时超过该毫秒数则改为每 4s 抓一次（拖动跟随延迟 <= 4s）。</summary>
        private const long DetectSlowMs = 150;

        // ---- v21（第 21 轮乙路）：桌宠生命周期跟随（Win 对齐 Mac 0.0.4）----
        /// <summary>桌宠窗口连续缺失达到该时长才隐藏显示窗（去抖；与 Mac 的 600ms 对齐）。</summary>
        private const long PetMissingHideMs = 600;
        /// <summary>启动宽限：AppContext 创建后该时长内不因桌宠缺失隐藏（给桌宠自启/首次定位留时间；对齐 Mac 的 10s）。</summary>
        private const long PetMissingStartupGraceMs = 10000;
        /// <summary>桌宠状态（/api/state + 桌宠窗口）轮询间隔：v21 起 500→250ms，让 600ms 去抖的隐藏延迟落在 1s 内。</summary>
        private const long PetStatePollMs = 250;

        // ---- v22（第 22 轮）：网络瞬断韧性 ----
        /// <summary>
        /// 失败后保留「最后一次成功金额」的窗口（10 分钟）：窗口内网络瞬断继续灰字显示上次金额（不显示「连接失败」），
        /// 超过窗口仍无成功结果才回退成「连接失败」。
        /// </summary>
        private const long LastGoodWindowMs = 600000;

        public readonly object Gate = new object();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly string rootDir;

        public string RootDir { get { return rootDir; } }
        public string ConfigPath { get; private set; }

        public IntPtr Hwnd = IntPtr.Zero;
        public IntPtr PetHwnd = IntPtr.Zero;
        public int PetLeft, PetTop, PetWidth, PetHeight;
        public bool PetValid;

        public Config Cfg = Config.BuildDefault();
        public List<ProviderRuntime> Providers = new List<ProviderRuntime>();
        public DateTime ConfigMtimeUtc = DateTime.MinValue;
        public long RefreshSeqApplied = -1;
        public bool PetStateOk;
        public double? StartX;
        public double? StartY;
        public double PetScale = 1;
        public string PetStateError = "";
        public bool Dirty = true;
        public volatile bool Quit;
        public float DpiScale = 1f;
        public int ScreenW, ScreenH;
        public int WorkLeft, WorkTop, WorkRight, WorkBottom;
        public int HotkeyId;
        public string HotkeyComboApplied = "";
        public bool Visible;
        // ---- v21（第 21 轮乙路）：桌宠生命周期跟随状态（全部只在 lock(Gate) 内改；仅 UI 线程 Repaint 消费）----
        /// <summary>桌宠窗口缺失计时起点 = 首次发现缺失的时刻（NowMs；小于 0 表示当前未缺失）。</summary>
        private long petMissingSinceMs = -1;
        /// <summary>本次隐藏是否由「桌宠缺失 ≥600ms」触发（与配置/数量导致的隐藏互斥；回来只恢复由它隐藏的窗口）。</summary>
        public bool HiddenByMissingPet;
        /// <summary>桌宠回来、等待 Repaint 重显示（Repaint 消费后清零，用于输出 reason=pet-detected 日志）。</summary>
        private bool petReshowPending;
        public Placement LastPlacement;
        private double lastStartX = double.NaN;
        private bool lastPetStateOk;

        // ---- v3：白饭桶 / 主题联动 / 点击展开 / 演示模式 ----
        public int DemoCount;
        public ThemeInfo ThemeInfo = new ThemeInfo();
        public VisualStyle Style = VisualStyle.Fallback("dark");
        public bool Expanded;
        public float WheelAngle;
        public BowlLayout LastLayout;
        private string lastThemeKey = "";
        private bool themeLoggedOnce;
        private int lastDisplayCount = -1;
        private string lastDisplaySig = "";
        private int lastTransitionCount = -1;
        private int lastTransitionGroupH = -1;
        private long lastPaintX = long.MinValue;
        private long lastPaintY = long.MinValue;
        private bool idleTimerSlow;
        private double velX, velY;
        public bool SnapPending;
        public int MonLeft, MonTop, MonRight, MonBottom;
        public string MonitorName = "";
        // ---- v3：尺寸跟随桌宠（/api/state scale → graphicsScale） ----
        public double PetScaleApi = 1.05;
        public double GraphicsScaleVal = 1.0;
        private double lastLoggedGraphicsScale = -1;
        // ---- 实时定位状态（PrintWindow 地面带检测） ----
        public bool DetectOk;
        public double DetectCenterX;
        /// <summary>v3：角色脚底在桌宠窗口内的局部 y（PrintWindow 实测；-1=未知）。</summary>
        public int PetLocalFeetY = -1;
        public long PetLocalFeetMs = -100000;
        /// <summary>v4：角色本体（sprite bbox）顶部在桌宠窗口内的局部 y（-1=未知；头顶形态锚点）。</summary>
        public int PetLocalHeadY = -1;
        public long PetLocalHeadMs = -100000;
        /// <summary>v4：角色本体（sprite bbox）中心 x（屏幕坐标；头顶形态水平锚点；NaN=未知）。</summary>
        public double PetLocalHeadX = double.NaN;
        public long PetLocalHeadXMs = -100000;
        /// <summary>v4：上次有效头顶屏幕 y（检测暂不可用时保持，不回跳）。</summary>
        public int LastHeadScreenY = -1;
        public int DetectFailStreak;
        public long DetectLastOkMs = -100000;
        public long DetectLastMs;
        public int DetectTicks;
        public string DetectLastClusterInfo = "";
        private double lastUsedDetectCenter = double.NaN;
        private double smoothDetectCenter = double.NaN;
        private int pendingDir = 0;
        private long pendingSinceMs = 0;
        // 1000% 静止锁定：3/5 帧中值（非 1000% 用 3 帧）+ 稳定 2s 锁定，偏差超 unlockBand 才解锁
        private readonly double[] centerHist = new double[5];
        private int centerHistCount = 0;
        private int centerHistIdx = 0;
        private double lastMedianCenter = double.NaN;
        private long stableSinceMs = 0;
        private bool anchorLocked = false;
        private double lockedAnchor = double.NaN;
        private readonly int[] feetHist = new int[5];
        private int feetHistCount = 0;
        private int feetHistIdx = 0;
        private int lastFeetMedian = -1;
        private readonly int[] headHist = new int[5];
        private int headHistCount = 0;
        private int headHistIdx = 0;
        private int lastHeadMedian = -1;
        private readonly double[] headXHist = new double[5];
        private int headXHistCount = 0;
        private int headXHistIdx = 0;
        private double lastHeadXMedian = double.NaN;
        private long lastDetectAttemptMs = -100000;
        private bool slowDetectLogged;

        // ---- v2：桌宠上移 / 平滑跟随 / 置顶重设 ----
        /// <summary>首次观察到的桌宠窗原顶边（通常 0），退出/停用时恢复。</summary>
        public int PetBaseTop = int.MinValue;
        private double lastLoggedLift = double.MinValue;
        private double currentLift;
        private double targetLift;
        private double animX, animY;
        private double targetX, targetY;
        private bool animInit;
        private bool animActive;
        private Bitmap cachedBitmap;
        private int cachedW, cachedH;
        private string contentKey = "";
        private long lastTopmostMs = -100000;
        private Thread worker;
        private EventWaitHandle quitEvent;
        private Thread quitWatcher;

        public AppContext(string rootDir)
        {
            this.rootDir = rootDir;
            string cfgOverride = Environment.GetEnvironmentVariable("GLUTTONBALANCE_PANEL_CONFIG");
            if (cfgOverride == null || cfgOverride.Trim().Length == 0)
            {
                // 改名兼容（2026-11-02）：新变量优先，旧变量保留为回退
                cfgOverride = Environment.GetEnvironmentVariable("PET_BALANCE_PANEL_CONFIG");
            }
        this.ConfigPath = (cfgOverride != null && cfgOverride.Trim().Length > 0)
            ? Path.GetFullPath(cfgOverride.Trim())
            : Path.Combine(rootDir, "config.json");
        }

        private long NowMs { get { return clock.ElapsedMilliseconds; } }

        // ---------------------------------------------------------- 生命周期

        public void AttachWindow(IntPtr hwnd)
        {
            Hwnd = hwnd;
            DpiScale = NativeV3.GetWindowScale(hwnd);
            NativeV3.GetMonitorRect(hwnd, out MonLeft, out MonTop, out MonRight, out MonBottom, out MonitorName);
            if (MonRight <= MonLeft || MonBottom <= MonTop)
            {
                MonLeft = 0; MonTop = 0;
                MonRight = Native.GetSystemMetrics(Native.SM_CXSCREEN);
                MonBottom = Native.GetSystemMetrics(Native.SM_CYSCREEN);
            }
            ScreenW = MonRight - MonLeft;
            ScreenH = MonBottom - MonTop;
            WorkLeft = MonLeft; WorkTop = MonTop; WorkRight = MonRight; WorkBottom = MonBottom;
            Native.RECT wa;
            if (Native.SystemParametersInfo(Native.SPI_GETWORKAREA, 0, out wa, 0))
            {
                WorkLeft = wa.Left; WorkTop = wa.Top; WorkRight = wa.Right; WorkBottom = wa.Bottom;
            }
            if (WorkRight <= WorkLeft || WorkBottom <= WorkTop)
            {
                WorkLeft = MonLeft; WorkTop = MonTop; WorkRight = MonRight; WorkBottom = MonBottom;
            }
            EnsureDefaultConfig();
            LoadConfig();
            ApplyExtendedStyles();
            RegisterHotkeyFromConfig();
            quitEvent = new EventWaitHandle(false, EventResetMode.ManualReset, QuitEventName);
            quitWatcher = new Thread(QuitWatcherMain);
            quitWatcher.IsBackground = true;
            quitWatcher.Start();
            Log.Write(string.Format(CultureInfo.InvariantCulture,
                "env monitor={0} scale={1:0.###} screen={2}x{3} work={4},{5},{6},{7} dpiAware={8}",
                MonitorName, DpiScale, ScreenW, ScreenH, WorkLeft, WorkTop, WorkRight, WorkBottom, NativeV3.DpiAwarenessMode));
        }

        public void Start()
        {
            worker = new Thread(WorkerMain);
            worker.IsBackground = true;
            worker.Start();
            Repaint();
        }

        public void Shutdown()
        {
            MarkQuit();
            Renderer.Dispose();
        }

        public void MarkQuit()
        {
            lock (Gate) { Quit = true; Dirty = false; }
            if (HotkeyId != 0)
            {
                Native.UnregisterHotKey(Hwnd, HotkeyId);
                HotkeyId = 0;
            }
            if (Hwnd != IntPtr.Zero) Native.KillTimer(Hwnd, 1);
            RestorePetTop();
            Log.Write("stop");
        }

        private void QuitWatcherMain()
        {
            try
            {
                quitEvent.WaitOne();
                if (Hwnd != IntPtr.Zero) Native.PostMessage(Hwnd, WM_APP_QUIT, IntPtr.Zero, IntPtr.Zero);
            }
            catch (Exception ex)
            {
                Log.Write("ERROR quit watcher: " + Program.SafeText(ex.Message));
            }
        }

        // ---------------------------------------------------------- 配置

        private void EnsureDefaultConfig()
        {
            if (File.Exists(ConfigPath)) return;
            try
            {
                ConfigStore.WriteDefault(ConfigPath);
                Log.Write("config created: " + ConfigPath);
            }
            catch (Exception ex)
            {
                Log.Write("ERROR config create failed: " + Program.SafeText(ex.Message));
            }
        }

        public void LoadConfig()
        {
            Config loaded = null;
            DateTime mtime = DateTime.MinValue;
            try
            {
                loaded = ConfigStore.Load(ConfigPath);
                mtime = File.GetLastWriteTimeUtc(ConfigPath);
            }
            catch (Exception ex)
            {
                Log.Write("WARN config load failed (keep old): " + Program.SafeText(ex.Message));
                return;
            }
            if (loaded == null) return;
            lock (Gate)
            {
                Dictionary<string, BalanceResult> oldResults = new Dictionary<string, BalanceResult>();
                Dictionary<string, int> oldFails = new Dictionary<string, int>();
                // v22.1：按 provider id 记住旧 runtime，热重载后继承「最后一次成功金额」记忆
                // （否则改过 config 后首查失败 → showLastGood=0，韧性目标失效；实测 2026-11-08 22:06 暴露）
                Dictionary<string, ProviderRuntime> oldRuntimes = new Dictionary<string, ProviderRuntime>();
                foreach (ProviderRuntime rt in Providers)
                {
                    oldResults[rt.Cfg.Id] = rt.Result;
                    oldFails[rt.Cfg.Id] = rt.FailStreak;
                    oldRuntimes[rt.Cfg.Id] = rt;
                }
                List<ProviderRuntime> next = new List<ProviderRuntime>();
                int maxRuntimeProviders = loaded.Capsule != null ? loaded.Capsule.MaxProviders : 9;
                foreach (ProviderConfig pc in loaded.Providers)
                {
                    if (next.Count >= maxRuntimeProviders) break;
                    ProviderRuntime rt = new ProviderRuntime();
                    rt.Cfg = pc;
                    BalanceResult prev;
                    if (oldResults.TryGetValue(pc.Id, out prev)) rt.Result = prev;
                    int fs;
                    if (oldFails.TryGetValue(pc.Id, out fs)) rt.FailStreak = fs;
                    ProviderRuntime oldRt;
                    if (oldRuntimes.TryGetValue(pc.Id, out oldRt))
                    {
                        // 与 Result/FailStreak 同法：同一 provider 的 last-good 记忆跨热重载保留
                        rt.LastGoodAmount = oldRt.LastGoodAmount;
                        rt.LastGoodCurrency = oldRt.LastGoodCurrency;
                        rt.LastGoodMs = oldRt.LastGoodMs;
                        rt.StaleShown = oldRt.StaleShown;
                    }
                    rt.NextDueMs = NowMs; // 配置变化后立刻重查
                    next.Add(rt);
                }
                Cfg = loaded;
                Providers = next;
                ConfigMtimeUtc = mtime;
                Dirty = true;
            }
            ApplyExtendedStyles();
            RegisterHotkeyFromConfig();
            Log.Write(string.Format(CultureInfo.InvariantCulture,
                "config loaded providers={0} mode={1} zOrder={2} clickThrough={3} refreshSeq={4} wear={5} nineLayout={6}",
                Providers.Count, Cfg.Position.Mode, Cfg.Position.ZOrder, Cfg.ClickThrough, Cfg.RefreshSeq, Cfg.Display.Wear, Cfg.Display.NineLayout));
        }

        /// <summary>无窗口模式初始化（--selftest / --shot）：读配置、算 DPI/工作区、拉主题，不建窗口。</summary>
        public void HeadlessInit()
        {
            DpiScale = NativeV3.GetWindowScale(IntPtr.Zero);
            NativeV3.GetMonitorRect(IntPtr.Zero, out MonLeft, out MonTop, out MonRight, out MonBottom, out MonitorName);
            if (MonRight <= MonLeft || MonBottom <= MonTop)
            {
                MonLeft = 0; MonTop = 0;
                MonRight = Native.GetSystemMetrics(Native.SM_CXSCREEN);
                MonBottom = Native.GetSystemMetrics(Native.SM_CYSCREEN);
            }
            ScreenW = MonRight - MonLeft;
            ScreenH = MonBottom - MonTop;
            WorkLeft = MonLeft; WorkTop = MonTop; WorkRight = MonRight; WorkBottom = MonBottom;
            Native.RECT wa;
            if (Native.SystemParametersInfo(Native.SPI_GETWORKAREA, 0, out wa, 0))
            {
                WorkLeft = wa.Left; WorkTop = wa.Top; WorkRight = wa.Right; WorkBottom = wa.Bottom;
            }
            Log.Write(string.Format(CultureInfo.InvariantCulture,
                "headless init monitor={0} scale={1:0.###} work={2},{3},{4},{5} dpiAware={6}",
                MonitorName, DpiScale, WorkLeft, WorkTop, WorkRight, WorkBottom, NativeV3.DpiAwarenessMode));
            LoadConfig();
            // 无窗口模式也读一次 /api/state，拿到桌宠 scale 算缩放
            try
            {
                int port = Cfg != null && Cfg.Position != null ? Cfg.Position.PetPort : 7797;
                PetState st = Net.QueryPetState(port);
                if (st != null && st.Ok && st.Scale > 0) PetScaleApi = st.Scale;
                GraphicsScaleVal = ScaleMath.GraphicsScale(Cfg, PetScaleApi);
                Log.Write(string.Format(CultureInfo.InvariantCulture,
                    "scale apply petScale={0:0.###} petScaleRef={1:0.###} graphicsScale={2:0.###}",
                    PetScaleApi, Cfg != null && Cfg.Display != null ? Cfg.Display.PetScaleRef : 1.05, GraphicsScaleVal));
            }
            catch { }
            PollTheme();
        }

        private void CheckConfig()
        {
            DateTime mtime;
            try { mtime = File.GetLastWriteTimeUtc(ConfigPath); }
            catch { return; }
            if (mtime == ConfigMtimeUtc) return;
            LoadConfig();
        }

        public void ApplyExtendedStyles()
        {
            if (Hwnd == IntPtr.Zero) return;
            Config cfg = Cfg;
            long ex = Native.GetWindowExStyle(Hwnd);
            ex |= Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            if (cfg != null && !cfg.ClickThrough) ex &= ~Native.WS_EX_TRANSPARENT;
            else ex |= Native.WS_EX_TRANSPARENT;
            Native.SetWindowExStyle(Hwnd, ex);
        }

        private void RegisterHotkeyFromConfig()
        {
            if (Hwnd == IntPtr.Zero) return; // 无窗口模式（--selftest/--shot）不注册热键
            Config cfg = Cfg;
            string combo = (cfg != null && cfg.Hotkey.Enabled) ? (cfg.Hotkey.Combo ?? "") : "";
            if (string.Equals(combo, HotkeyComboApplied, StringComparison.Ordinal)) return;
            if (HotkeyId != 0)
            {
                Native.UnregisterHotKey(Hwnd, HotkeyId);
                HotkeyId = 0;
            }
            HotkeyComboApplied = combo;
            if (string.IsNullOrEmpty(combo))
            {
                Log.Write("hotkey disabled");
                return;
            }
            uint mods, vk;
            if (!HotkeyParser.TryParse(combo, out mods, out vk))
            {
                Log.Write("WARN hotkey parse failed: " + combo);
                return;
            }
            if (Native.RegisterHotKey(Hwnd, 1, mods, vk))
            {
                HotkeyId = 1;
                Log.Write("hotkey registered: " + combo);
            }
            else
            {
                Log.Write("WARN hotkey register failed: " + combo + " err=" + Marshal.GetLastWin32Error());
            }
        }

        // ---------------------------------------------------------- 工作线程

        private void WorkerMain()
        {
            long nextState = 0;
            long nextConfig = 0;
            long nextBowlSweep = 0;
            long nextDetect = 0;
            long nextTheme = 0;
            while (true)
            {
                lock (Gate) { if (Quit) return; }
                try
                {
                    long now = NowMs;
                    // v21：桌宠状态轮询 500→250ms（600ms 去抖 + 250ms 采样网格 → 隐藏延迟 0.6–0.9s，对齐 Mac ≤1s）
                    if (now >= nextState) { nextState = now + PetStatePollMs; PollPetState(); }
                    int detectMs;
                    lock (Gate) { detectMs = (Cfg != null && Cfg.LiveFollow != null) ? Cfg.LiveFollow.DetectMs : 250; }
                    if (detectMs < 100) detectMs = 100;
                    if (detectMs > 5000) detectMs = 5000;
                    if (now >= nextDetect) { nextDetect = now + detectMs; DetectTick(); }
                    if (now >= nextConfig) { nextConfig = now + 5000; CheckConfig(); }
                    if (now >= nextBowlSweep) { nextBowlSweep = now + 5000; try { BowlAssets.Sweep(); } catch { } }
                    int themePollMs;
                    lock (Gate) { themePollMs = (Cfg != null && Cfg.Theme != null) ? Cfg.Theme.PollMs : 3000; }
                    if (themePollMs < 1000) themePollMs = 1000;
                    if (now >= nextTheme) { nextTheme = now + themePollMs; PollTheme(); }
                    ApplyLiftTick();
                    if (now - lastTopmostMs >= 500)
                    {
                        lastTopmostMs = now;
                        ResetTopmost();
                    }
                    List<ProviderRuntime> toStart = new List<ProviderRuntime>();
                    bool post = false;
                    lock (Gate)
                    {
                        if (Cfg != null && Cfg.Enabled && DemoCount == 0)
                        {
                            foreach (ProviderRuntime rt in Providers)
                            {
                                if (!rt.Cfg.Enabled || rt.Fetching || rt.Cfg.IsRice) continue;
                                if (now >= rt.NextDueMs) { rt.Fetching = true; toStart.Add(rt); }
                            }
                        }
                        // v22 网络瞬断韧性：跟踪「灰字上次金额」显示状态；10 分钟窗口到期时强制重绘一次
                        // （失败结果本身不会重绘，否则窗口到期后还会一直挂着上次金额）
                        foreach (ProviderRuntime rt in Providers)
                        {
                            bool stale = rt.Result != null && !rt.Result.Ok && rt.LastGoodMs > 0
                                && (now - rt.LastGoodMs) <= LastGoodWindowMs;
                            if (rt.StaleShown != stale)
                            {
                                rt.StaleShown = stale;
                                Dirty = true;
                            }
                        }
                        if (Dirty) { Dirty = false; post = true; }
                    }
                    foreach (ProviderRuntime rt in toStart) StartFetch(rt);
                    if (post && Hwnd != IntPtr.Zero)
                    {
                        Native.PostMessage(Hwnd, WM_APP_REDRAW, IntPtr.Zero, IntPtr.Zero);
                    }
                }
                catch (Exception ex)
                {
                    Log.Write("ERROR worker: " + Program.SafeText(ex.Message));
                }
                // v3.3：睡到下一个 detect 截止点（最多 150ms、最少 10ms），
                // 让 detectMs=250 的检测节拍真正落在 250ms，而不是被固定 150ms 粒度拉成 300ms。
                // v21：同时照顾桌宠状态轮询截止点（250ms），否则隐藏判定会被 150ms 睡眠粒度拉偏。
                long waitMs = 150;
                long untilDetect = nextDetect - NowMs;
                if (untilDetect < 10) waitMs = 10;
                else if (untilDetect < waitMs) waitMs = untilDetect;
                long untilState = nextState - NowMs;
                if (untilState < 10) waitMs = 10;
                else if (untilState < waitMs) waitMs = untilState;
                Thread.Sleep((int)waitMs);
            }
        }

        // ---------------------------------------------------------- v2：桌宠上移 / 置顶 / 穿透

        internal static void CapsuleMetrics(Config cfg, float dpiScale, out int cw, out int ch, out int step)
        {
            int designW = 200, designH = 30, designOverlap = 6;
            if (cfg != null && cfg.Capsule != null)
            {
                designW = cfg.Capsule.Width;
                designH = cfg.Capsule.Height;
                designOverlap = cfg.Capsule.Overlap;
            }
            cw = (int)Math.Round(designW * dpiScale);
            ch = (int)Math.Round(designH * dpiScale);
            int overlap = (int)Math.Round(designOverlap * dpiScale);
            step = ch - overlap;
            if (step < 4) step = 4;
            if (cw < 40) cw = 40;
            if (ch < 12) ch = 12;
        }

        /// <summary>把桌宠透明覆盖窗整体上移 lift（= 6 + 胶囊总高），给脚下胶囊腾地方；每 tick 校正并缓动。</summary>
        private void ApplyLiftTick()
        {
            IntPtr pet;
            int wantLift = 0;
            bool shouldLift;
            float dpiScale;
            lock (Gate)
            {
                pet = PetHwnd;
                dpiScale = DpiScale;
                int n = 0;
                if (DemoCount > 0) n = DemoCount;
                else if (Cfg != null && Cfg.Enabled)
                {
                    foreach (ProviderRuntime rt in Providers) if (rt.Cfg.Enabled) n++;
                }
                shouldLift = n > 0 && Cfg != null && Cfg.PetLift != null && Cfg.PetLift.Enabled
                    && !(Cfg.Display != null && string.Equals(Cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase));
                if (shouldLift)
                {
                    BowlLayout lay = BowlLayout.Compute(Cfg, n, dpiScale, GraphicsScaleVal);
                    int gapPx = (int)Math.Round(6.0 * dpiScale);
                    int minLift = gapPx + lay.GroupH;
                    bool feetFresh = PetLocalFeetY > 0 && (NowMs - PetLocalFeetMs) <= 2000;
                    if (feetFresh)
                    {
                        int groupTop = WorkBottom - Cfg.Position.BottomGap - lay.GroupH;
                        int contact = (int)Math.Round(3.0 * dpiScale);
                        // 桌宠窗顶边 = 盆组顶 + 接触像素 − 角色脚底局部 y  → 脚底正好踩在盆沿
                        wantLift = PetBaseTop - groupTop - contact + PetLocalFeetY;
                        if (wantLift < gapPx * 2) wantLift = gapPx * 2;
                        if (wantLift > lay.GroupH + 160) wantLift = lay.GroupH + 160;
                    }
                    else
                    {
                        wantLift = minLift;
                    }
                }
            }
            if (Math.Abs(wantLift - targetLift) >= (PetScaleApi > 4.0 ? 2.0 : 1.0)) targetLift = wantLift;   // 死区：防巨宠待机抖动
            if (Math.Abs(targetLift - lastLoggedLift) >= 1.0)
            {
                lastLoggedLift = targetLift;
                Log.Write(string.Format(CultureInfo.InvariantCulture,
                    "lift target={0} current={1:0.0} localFeet={2} feetScreen={3}", targetLift, currentLift, PetLocalFeetY,
                    PetBaseTop - (int)Math.Round(targetLift) + PetLocalFeetY));
            }
            double diff = targetLift - currentLift;
            if (Math.Abs(diff) < 1.0)
            {
                currentLift = targetLift;
            }
            else
            {
                currentLift += diff * 0.85; // 150ms tick 内小幅步进，约 300-450ms 到位
            }
            if (pet == IntPtr.Zero || PetBaseTop == int.MinValue) return;
            if (!Native.IsWindowVisible(pet)) return;
            int desiredTop = PetBaseTop - (int)Math.Round(currentLift);
            Native.RECT now;
            if (Native.GetWindowRect(pet, out now) && now.Top == desiredTop) return;
            Native.SetWindowPos(pet, IntPtr.Zero, 0, desiredTop, 0, 0,
                Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
            Log.Write(string.Format(CultureInfo.InvariantCulture,
                "pet lift={0:0.0} target={1} baseTop={2} top={3}", currentLift, targetLift, PetBaseTop, desiredTop));
        }

        private void RestorePetTop()
        {
            IntPtr pet;
            int baseTop;
            lock (Gate) { pet = PetHwnd; baseTop = PetBaseTop; }
            if (pet == IntPtr.Zero || baseTop == int.MinValue) return;
            try
            {
                Native.RECT now;
                if (Native.GetWindowRect(pet, out now) && now.Top != baseTop)
                {
                    Native.SetWindowPos(pet, IntPtr.Zero, 0, baseTop, 0, 0,
                        Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
                }
                Log.Write("pet top restored to " + baseTop);
            }
            catch (Exception ex)
            {
                Log.Write("WARN restore pet top: " + Program.SafeText(ex.Message));
            }
        }

        /// <summary>每 500ms 重设置顶+透明样式，防被任务栏/其它置顶窗压到后面。</summary>
        private void ResetTopmost()
        {
            if (Hwnd == IntPtr.Zero || !Visible) return;
            try
            {
                ApplyExtendedStyles();
                Native.SetWindowPos(Hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0,
                    Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                // v3：自检置顶是否真的生效（被别的置顶窗抢占时立刻纠偏并留日志）
                if ((Native.GetWindowExStyle(Hwnd) & 0x8L) == 0)
                {
                    Native.SetWindowPos(Hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0,
                        Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                    long ex2 = Native.GetWindowExStyle(Hwnd);
                    Log.Write("WARN topmost lost, reassert ex=0x" + ex2.ToString("X"));
                }
            }
            catch { }
        }

        public bool IsClickThrough()
        {
            lock (Gate) { return Cfg == null || Cfg.ClickThrough; }
        }

        /// <summary>60fps 平滑跟随：弹簧缓动（轻微回弹）+ 静止 1px 内浮动 + 轮子彩蛋旋转。</summary>
        public void AnimTick()
        {
            Bitmap bmp = null;
            Bitmap paintBmp = null;
            double x = 0, y = 0;
            bool still = false;
            bool wheelsOn = false;
            float wheelAngle = 0f;
            lock (Gate)
            {
                if (Quit || cachedBitmap == null) return;
                if (Cfg != null && Cfg.LiveFollow != null && !Cfg.LiveFollow.Smooth) return;
                // 弹簧：k=0.26、阻尼 0.50 → 100px 跳变约 320ms 收敛，过冲约 1.3px（16ms/帧离散仿真）
                if (SnapPending)
                {
                    velX = 0; velY = 0;
                    animX = targetX; animY = targetY;
                    SnapPending = false;
                }
                velX = (velX + (targetX - animX) * 0.26) * 0.50;
                velY = (velY + (targetY - animY) * 0.26) * 0.50;
                animX += velX;
                animY += velY;
                if (Math.Abs(targetX - animX) < 0.5 && Math.Abs(velX) < 0.08) { animX = targetX; velX = 0; }
                if (Math.Abs(targetY - animY) < 0.5 && Math.Abs(velY) < 0.08) { animY = targetY; velY = 0; }
                still = Math.Abs(targetX - animX) < 0.4 && Math.Abs(targetY - animY) < 0.4;
                double floatOffset = 0;
                if (still) floatOffset = -Math.Abs(Math.Sin(NowMs / 900.0)) * 0.9; // 只向上，保证组底不越界
                wheelsOn = Cfg != null && Cfg.Display != null && Cfg.Display.Wheels
                    && !string.Equals(Cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase);
                if (wheelsOn && !still)
                {
                    double spd = Math.Sqrt(velX * velX + velY * velY);
                    WheelAngle += (float)(spd * 8.0);
                    if (WheelAngle >= 360f) WheelAngle -= 360f;
                }
                wheelAngle = WheelAngle;
                bmp = cachedBitmap;
                x = animX;
                y = animY + floatOffset;
            }
            if (bmp != null && wheelsOn && LastLayout != null)
            {
                paintBmp = BowlRenderer.WithWheels(bmp, LastLayout, Style, wheelAngle);
            }
            if (bmp != null)
            {
                int px = (int)Math.Round(x);
                int py = (int)Math.Round(y);
                if (px != lastPaintX || py != lastPaintY)
                {
                    lastPaintX = px; lastPaintY = py;
                    PaintLayered(paintBmp == null ? bmp : paintBmp, px, py);
                }
            }
            if (paintBmp != null) paintBmp.Dispose();
            // 静止时降频（仍保留 1px 浮动），移动时回到 60fps
            bool wantSlow = still;
            if (wantSlow != idleTimerSlow)
            {
                idleTimerSlow = wantSlow;
                Native.SetTimer(Hwnd, 1, wantSlow ? 50u : 16u, IntPtr.Zero);
            }
        }

        private void EnsureAnimation()
        {
            bool need = false;
            lock (Gate)
            {
                // 平滑跟随开启时定时器常驻（静止也要做 1px 浮动 / 轮子停转状态）
                need = Visible && (Cfg == null || Cfg.LiveFollow == null || Cfg.LiveFollow.Smooth);
                if (need && !animActive)
                {
                    animActive = true;
                    idleTimerSlow = false;
                    Native.SetTimer(Hwnd, 1, 16, IntPtr.Zero);
                }
            }
        }

        private void PaintCurrent()
        {
            Bitmap bmp = null;
            double x = 0, y = 0;
            lock (Gate)
            {
                bmp = cachedBitmap;
                x = animX; y = animY;
            }
            if (bmp != null) PaintLayered(bmp, (int)Math.Round(x), (int)Math.Round(y));
        }

        public void RequestRefresh()
        {
            lock (Gate)
            {
                foreach (ProviderRuntime rt in Providers) rt.NextDueMs = NowMs;
            }
            Log.Write("refresh requested (hotkey)");
        }

        private void StartFetch(ProviderRuntime rt)
        {
            ProviderConfig pc = rt.Cfg;
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                Stopwatch sw = Stopwatch.StartNew();
                BalanceResult res;
                try { res = Net.Query(pc); }
                catch (Exception ex) { res = BalanceResult.Fail(SafeError(ex, pc)); }
                sw.Stop();
                if (res == null) res = BalanceResult.Fail("no result");
                res.LatencyMs = (int)sw.ElapsedMilliseconds;
                bool dirty = false;
                bool logLine = false;
                List<ProviderConfig> placeholder = null;
                if (placeholder != null) { }
                lock (Gate)
                {
                    BalanceResult prev = rt.Result;
                    rt.Result = res;
                    rt.Fetching = false;
                    rt.LastAttemptMs = NowMs;
                    if (res.Ok)
                    {
                        // v22 网络瞬断韧性：记住最后一次成功金额/币种/时间（失败分支不动这些值）
                        rt.LastOkMs = NowMs;
                        rt.LastGoodMs = rt.LastOkMs;
                        rt.LastGoodAmount = res.Amount;
                        rt.LastGoodCurrency = string.IsNullOrEmpty(res.Currency) ? "CNY" : res.Currency;
                        rt.FailStreak = 0;
                        rt.NextDueMs = NowMs + IntervalMs(rt.Cfg.IntervalSec);
                    }
                    else
                    {
                        rt.FailStreak = rt.FailStreak + 1;
                        int nextSec = BackoffSec(rt.FailStreak);
                        // 退避直接按秒换算毫秒（不走 IntervalMs 的「最少 10s」下限，否则 3/8s 的首轮快重试会被吃掉）
                        rt.NextDueMs = NowMs + nextSec * 1000L;
                        // v22：补一条简短 retry 日志（便于事后判断网络瞬断；不打印任何 key）
                        Log.Write(string.Format(CultureInfo.InvariantCulture,
                            "balance retry id={0} streak={1} nextIn={2}s showLastGood={3}",
                            rt.Cfg.Id, rt.FailStreak, nextSec,
                            (rt.LastGoodMs > 0 && (NowMs - rt.LastGoodMs) <= LastGoodWindowMs) ? 1 : 0));
                    }
                    if (!SameResult(prev, res))
                    {
                        dirty = true;
                        logLine = true;
                    }
                    else if (prev == null)
                    {
                        logLine = true;
                    }
                    if (!res.Ok && (prev == null || prev.Ok || rt.FailStreak <= 1)) logLine = true;
                    if (logLine) LogBalance(rt, res);
                    if (dirty) Dirty = true;
                }
            });
        }

        private static bool SameResult(BalanceResult a, BalanceResult b)
        {
            if (a == null || b == null) return false;
            if (a.Ok != b.Ok) return false;
            if (!a.Ok) return true; // 失败态显示固定（「连接失败」或灰字上次金额），错误文案变化不必重绘（窗口到期由 worker 强制重绘）
            return Math.Abs(a.Amount - b.Amount) < 0.0005;
        }

        private void LogBalance(ProviderRuntime rt, BalanceResult res)
        {
            if (res.Ok)
            {
                Log.Write(string.Format(CultureInfo.InvariantCulture,
                    "balance id={0} ok amount={1:0.00} currency={2} latencyMs={3}",
                    rt.Cfg.Id, res.Amount, res.Currency, res.LatencyMs));
            }
            else
            {
                Log.Write(string.Format(CultureInfo.InvariantCulture,
                    "balance id={0} failed fails={1} error={2}", rt.Cfg.Id, rt.FailStreak, res.Error));
            }
        }

        private static int IntervalMs(int sec)
        {
            if (sec < 10) sec = 10;
            if (sec > 3600) sec = 3600;
            return sec * 1000;
        }

        /// <summary>
        /// v22：失败退避（秒）——3 / 8 / 20 / 60 封顶（原 10 / 30 / 60 / 300）。
        /// 目的：网络瞬断（本机实测约 100 秒）恢复后最多 60s 内一定重试到，不再等 5 分钟。
        /// </summary>
        private static int BackoffSec(int failStreak)
        {
            if (failStreak <= 1) return 3;
            if (failStreak == 2) return 8;
            if (failStreak == 3) return 20;
            return 60;
        }

        private string SafeError(Exception ex, ProviderConfig pc)
        {
            string message = ex != null ? ex.Message : "";
            ApiException ae = ex as ApiException;
            if (ae != null) message = ae.SafeMessage;
            string secret = "";
            try { secret = KeyLoader.Load(pc.KeySource); }
            catch { }
            return Net.Redact(Program.SafeText(message), secret);
        }

        // ---------------------------------------------------------- v3：主题联动 / 可选交互

        /// <summary>读 Coopanion 主题接口，构建铭牌/文字配色（白饭+盆体材质不跟主题变）。</summary>
        private void PollTheme()
        {
            Config cfg = Cfg;
            if (cfg == null || cfg.Theme == null) return;
            if (!cfg.Theme.Follow && string.IsNullOrEmpty(cfg.Theme.Force)) return;
            ThemeInfo ti = Net.QueryTheme(cfg.Theme.Port, cfg.Theme.StatePort);
            VisualStyle st = VisualStyleBuilder.Build(ti, cfg.Theme.Force, cfg.Display.BowlStyle, cfg.Theme.Follow);
            bool changed = false;
            lock (Gate)
            {
                if (st.Key != lastThemeKey || !themeLoggedOnce)
                {
                    lastThemeKey = st.Key;
                    changed = true;
                }
                ThemeInfo = ti;
                Style = st;
                if (changed) Dirty = true;
            }
            if (changed)
            {
                themeLoggedOnce = true;
                Log.Write("theme apply src=" + (ti.PaletteSource ?? "fallback") + " theme=" + st.Theme
                    + " selectedId=" + (ti.SelectedId ?? "") + " force=" + (cfg.Theme.Force ?? "")
                    + " bowl=" + st.BowlStyleName + " ok=" + (ti.Ok ? 1 : 0)
                    + (string.IsNullOrEmpty(ti.Error) ? "" : " err=" + Program.SafeText(ti.Error)));
            }
        }

        /// <summary>可选交互：clickThrough=false 时点面板展开/收起明细。</summary>
        public void OnPanelClick()
        {
            Config cfg = Cfg;
            if (cfg == null || cfg.Interaction == null || !cfg.Interaction.ExpandOnClick) return;
            if (cfg.ClickThrough) return;
            bool now;
            lock (Gate)
            {
                Expanded = !Expanded;
                now = Expanded;
                Dirty = true;
            }
            Log.Write("interact " + (now ? "expand" : "collapse") + " source=click");
        }

        private int EffectiveProviderCountLocked()
        {
            if (DemoCount > 0) return Math.Min(DemoCount, 12);
            int n = 0;
            foreach (ProviderRuntime rt in Providers) if (rt.Cfg.Enabled) n++;
            return n;
        }

        // ---------------------------------------------------------- /api/state + 桌宠窗口

        private void PollPetState()
        {
            int port;
            lock (Gate) { port = (Cfg != null && Cfg.Position != null) ? Cfg.Position.PetPort : 7797; }
            PetState st = Net.QueryPetState(port);
            IntPtr pet = FindPetWindow();
            Native.RECT rect = new Native.RECT();
            bool haveRect = false;
            if (pet != IntPtr.Zero)
            {
                haveRect = Native.GetWindowRect(pet, out rect);
            }
            // 桌宠所在显示器的工作区（换屏/缩放时面板仍算对）
            Native.RECT workRect = new Native.RECT();
            bool haveWork = false;
            if (pet != IntPtr.Zero)
            {
                haveWork = TryGetMonitorWorkArea(pet, out workRect);
            }
            lock (Gate)
            {
                bool dirty = false;
                lastPetStateOk = PetStateOk;
                if (st.Ok)
                {
                    StartX = st.StartX;
                    StartY = st.StartY;
                    PetScale = st.Scale;
                    PetScaleApi = st.Scale > 0 ? st.Scale : 1.05;
                    double gs = ScaleMath.GraphicsScale(Cfg, PetScaleApi);
                    if (Math.Abs(gs - GraphicsScaleVal) > 0.001)
                    {
                        GraphicsScaleVal = gs;
                        SnapPending = true;
                        dirty = true;
                        if (Math.Abs(gs - lastLoggedGraphicsScale) > 0.001)
                        {
                            lastLoggedGraphicsScale = gs;
                            Log.Write(string.Format(CultureInfo.InvariantCulture,
                                "scale apply petScale={0:0.###} petScaleRef={1:0.###} graphicsScale={2:0.###}",
                                PetScaleApi, Cfg != null && Cfg.Display != null ? Cfg.Display.PetScaleRef : 1.05, gs));
                        }
                    }
                    PetStateOk = true;
                    PetStateError = "";
                }
                else
                {
                    PetStateOk = false;
                    PetStateError = st.Error;
                }
                if (lastPetStateOk != PetStateOk)
                {
                    dirty = true;
                    Log.Write(PetStateOk
                        ? "pet state ok startX=" + (StartX.HasValue ? StartX.Value.ToString("0.000000", CultureInfo.InvariantCulture) : "null")
                        : "pet state failed: " + Program.SafeText(PetStateError));
                }
                bool startXChanged = false;
                if (StartX.HasValue && !double.IsNaN(lastStartX))
                {
                    if (Math.Abs(StartX.Value - lastStartX) > 1e-9) startXChanged = true;
                }
                if (StartX.HasValue) lastStartX = StartX.Value;
                if (pet != IntPtr.Zero && pet != PetHwnd)
                {
                    PetHwnd = pet;
                    dirty = true;
                }
                if (pet == IntPtr.Zero && PetHwnd != IntPtr.Zero)
                {
                    PetHwnd = IntPtr.Zero;
                    PetValid = false;
                    dirty = true;
                }
                // ---- v21（第 21 轮乙路）：桌宠生命周期跟随（Win 对齐 Mac 0.0.4）----
                // 缺失计时起点 = 首次发现桌宠窗口缺失的时刻；状态轮询 250ms + 去抖 600ms
                // → 实际隐藏延迟约 0.6–1.0s；启动 10s 宽限内不动显示窗。
                long nowPetMs = NowMs;
                if (pet != IntPtr.Zero)
                {
                    petMissingSinceMs = -1;
                    if (HiddenByMissingPet)
                    {
                        // 桌宠回来：清「因缺失而隐藏」标志，交给 Repaint 现有的 SW_SHOWNOACTIVATE 路径重显示
                        HiddenByMissingPet = false;
                        petReshowPending = true;
                        dirty = true;
                    }
                }
                else
                {
                    if (petMissingSinceMs < 0) petMissingSinceMs = nowPetMs;
                    long petMissingMs = nowPetMs - petMissingSinceMs;
                    if (!HiddenByMissingPet && petMissingMs >= PetMissingHideMs && nowPetMs >= PetMissingStartupGraceMs)
                    {
                        HiddenByMissingPet = true;
                        dirty = true;
                    }
                }
                if (haveRect)
                {
                    if (PetLeft != rect.Left || PetTop != rect.Top || PetWidth != rect.Right - rect.Left || PetHeight != rect.Bottom - rect.Top)
                    {
                        PetLeft = rect.Left; PetTop = rect.Top;
                        PetWidth = rect.Right - rect.Left;
                        PetHeight = rect.Bottom - rect.Top;
                        if (PetBaseTop == int.MinValue) PetBaseTop = rect.Top < 0 ? 0 : rect.Top; // 全屏覆盖窗原顶边按 0；防止上次被强杀时把已抬升的 -N 当成原顶边
                        dirty = true;
                        Log.Write(string.Format(CultureInfo.InvariantCulture,
                            "pet window hwnd=0x{0:X} rect={1},{2},{3},{4}", pet.ToInt64(), PetLeft, PetTop, PetWidth, PetHeight));
                    }
                    PetValid = true;
                }
                else
                {
                    PetValid = false;
                }
                if (haveWork && (Cfg == null || Cfg.Position == null || Cfg.Position.MonitorFollow))
                {
                    int ml, mt, mr, mb;
                    string mname;
                    NativeV3.GetMonitorRect(pet, out ml, out mt, out mr, out mb, out mname);
                    float newScale = NativeV3.GetWindowScale(pet);
                    bool monitorChanged = (ml != MonLeft || mt != MonTop || mr != MonRight || mb != MonBottom);
                    bool scaleChanged = Math.Abs(newScale - DpiScale) > 0.001f;
                    if (monitorChanged || scaleChanged)
                    {
                        MonLeft = ml; MonTop = mt; MonRight = mr; MonBottom = mb;
                        MonitorName = mname;
                        DpiScale = newScale;
                        dirty = true;
                        Log.Write(string.Format(CultureInfo.InvariantCulture,
                            "monitor follow name={0} scale={1:0.###} rect={2},{3},{4},{5}", mname, DpiScale, ml, mt, mr, mb));
                    }
                    if (WorkLeft != workRect.Left || WorkTop != workRect.Top || WorkRight != workRect.Right || WorkBottom != workRect.Bottom)
                    {
                        WorkLeft = workRect.Left; WorkTop = workRect.Top;
                        WorkRight = workRect.Right; WorkBottom = workRect.Bottom;
                        dirty = true;
                    }
                }
                // 实时定位在 DetectTick（默认每 250ms，见 config.liveFollow.detectMs）里做；这里只在检测不可用/未启用时跟随 startX
                if (startXChanged && !DetectOk)
                {
                    dirty = true;
                }
                if (dirty) Dirty = true;
            }
        }

        /// <summary>实时定位 tick（默认每 250ms，见 config.liveFollow.detectMs）：PrintWindow 抓桌宠窗地面带像素簇得到角色中心。</summary>
        private void DetectTick()
        {
            IntPtr pet;
            Native.RECT rect = new Native.RECT();
            lock (Gate)
            {
                pet = PetHwnd;
                rect.Left = PetLeft;
                rect.Top = PetTop;
                rect.Right = PetLeft + PetWidth;
                rect.Bottom = PetTop + PetHeight;
            }
            if (pet == IntPtr.Zero) return;
            if (rect.Right - rect.Left < 64 || rect.Bottom - rect.Top < 64) return;

            long nowMs = NowMs;
            double detectCenter;
            string detectInfo;
            long detectElapsedMs;
            int feetLocalY = -1;
            int headLocalY = -1;
            double headCenterX = 0;
            bool wantHead = false;
            lock (Gate) { wantHead = Cfg != null && Cfg.Display != null && string.Equals(Cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase); }
            bool detectOk = TryDetectCharacterCenter(pet, rect, out detectCenter, out detectInfo, out detectElapsedMs, out feetLocalY, wantHead, out headLocalY, out headCenterX);
            nowMs = NowMs;
            lock (Gate)
            {
                bool dirty = false;
                lastDetectAttemptMs = nowMs;
                if (detectOk)
                {
                    DetectFailStreak = 0;
                    DetectLastOkMs = nowMs;
                    DetectLastMs = detectElapsedMs;
                    DetectTicks++;
                    // 中值滤波：非 1000% 待机用最近 3 帧（250ms 节拍下 5 帧滞后过大）；
                    // PetScaleApi >= 4.0 的 1000% 待机动画会让脚锚缓慢摆动 → 仍用 5 帧防抖。
                    // 不足 N 帧时只用已写入的样本（centerHist 未写入项是 0，不能当中值样本，否则 1000% 启动瞬间跳屏）。
                    // 另配静止锁定（2s 稳定即冻结目标）。
                    double petPxW = 77.0 * PetScaleApi / 1.05;
                    double stableBand = Math.Max(6.0, 0.03 * petPxW);
                    double unlockBand = Math.Max(12.0, 0.06 * petPxW);
                    centerHist[centerHistIdx] = detectCenter;
                    centerHistIdx = (centerHistIdx + 1) % centerHist.Length;
                    if (centerHistCount < centerHist.Length) centerHistCount++;
                    int medN = PetScaleApi >= 4.0 ? Math.Min(centerHist.Length, centerHistCount) : Math.Min(3, centerHistCount);
                    double[] med = new double[medN];
                    for (int k = 0; k < medN; k++)
                    {
                        int histIdx = centerHistIdx - 1 - k;      // ring buffer 取「最近 medN 条」
                        while (histIdx < 0) histIdx += centerHist.Length;
                        med[k] = centerHist[histIdx];
                    }
                    Array.Sort(med);
                    double median = med[med.Length / 2];
                    bool use = false;
                    if (!DetectOk || double.IsNaN(DetectCenterX))
                    {
                        DetectCenterX = median;
                        lockedAnchor = median;
                        anchorLocked = false;
                        stableSinceMs = nowMs;
                        use = true;
                    }
                    else if (anchorLocked)
                    {
                        // 已锁定：中值偏离锁定锚点超过 unlockBand 才解锁
                        if (Math.Abs(median - lockedAnchor) > unlockBand)
                        {
                            anchorLocked = false;
                            lockedAnchor = median;
                            stableSinceMs = nowMs;
                            DetectCenterX = median;
                            Log.Write(string.Format(CultureInfo.InvariantCulture,
                                "anchor unlock median={0:0.0} locked={1:0.0} unlockBand={2:0.0}",
                                median, lockedAnchor, unlockBand));
                            use = true;
                        }
                    }
                    else
                    {
                        // 未锁定：中值稳定（波动 <= stableBand）持续 2s → 锁定；否则跟随中值
                        if (!double.IsNaN(lastMedianCenter) && Math.Abs(median - lastMedianCenter) <= stableBand)
                        {
                            if (stableSinceMs == 0) stableSinceMs = nowMs;
                            if (nowMs - stableSinceMs >= 2000)
                            {
                                anchorLocked = true;
                                lockedAnchor = median;
                                DetectCenterX = median;
                                Log.Write(string.Format(CultureInfo.InvariantCulture,
                                    "anchor stationary lock median={0:0.0} stableBand={1:0.0} unlockBand={2:0.0}",
                                    median, stableBand, unlockBand));
                                use = true;
                            }
                        }
                        else
                        {
                            stableSinceMs = nowMs;
                        }
                        if (!anchorLocked) { DetectCenterX = median; use = true; }
                    }
                    lastMedianCenter = median;
                    if (use)
                    {
                        lastUsedDetectCenter = detectCenter;
                        smoothDetectCenter = DetectCenterX;
                        DetectOk = true;
                        dirty = true;
                    }
                    DetectLastClusterInfo = detectInfo;
                    if (feetLocalY > 0)
                    {
                        feetHist[feetHistIdx] = feetLocalY;
                        feetHistIdx = (feetHistIdx + 1) % feetHist.Length;
                        if (feetHistCount < feetHist.Length) feetHistCount++;
                        int[] fmed = new int[feetHistCount];
                        Array.Copy(feetHist, fmed, feetHistCount);
                        Array.Sort(fmed);
                        int feetMedian = fmed[fmed.Length / 2];
                        int feetDeadband = PetScaleApi > 4.0 ? 6 : 2;
                        bool feetUse = PetLocalFeetY <= 0 || Math.Abs(feetMedian - PetLocalFeetY) >= feetDeadband;
                        if (feetUse)
                        {
                            PetLocalFeetY = feetMedian;
                            PetLocalFeetMs = nowMs;
                        }
                        lastFeetMedian = feetMedian;
                    }
                    if (headLocalY > 0)
                    {
                        headHist[headHistIdx] = headLocalY;
                        headHistIdx = (headHistIdx + 1) % headHist.Length;
                        if (headHistCount < headHist.Length) headHistCount++;
                        int[] hmed = new int[headHistCount];
                        Array.Copy(headHist, hmed, headHistCount);
                        Array.Sort(hmed);
                        int headMedian = hmed[hmed.Length / 2];
                        int headDeadband = PetScaleApi > 4.0 ? 6 : 2;
                        bool headUse = PetLocalHeadY <= 0 || Math.Abs(headMedian - PetLocalHeadY) >= headDeadband;
                        if (headUse)
                        {
                            PetLocalHeadY = headMedian;
                            PetLocalHeadMs = nowMs;
                            // 头顶屏幕 y = 桌宠窗当前顶 + 头顶局部 y（head 模式不 lift，PetBaseTop 即稳态窗顶）
                            int baseTop = PetBaseTop == int.MinValue ? PetTop : PetBaseTop;
                            LastHeadScreenY = baseTop + headMedian;
                        }
                        lastHeadMedian = headMedian;
                    }
                    if (headCenterX > 0)
                    {
                        // head 水平锚点：本体 bbox 中心 x，与头顶 y 同节拍做中值/死区平滑（feet 的 DetectCenterX 不受影响）
                        headXHist[headXHistIdx] = headCenterX;
                        headXHistIdx = (headXHistIdx + 1) % headXHist.Length;
                        if (headXHistCount < headXHist.Length) headXHistCount++;
                        double[] xmed = new double[headXHistCount];
                        Array.Copy(headXHist, xmed, headXHistCount);
                        Array.Sort(xmed);
                        double hxMedian = xmed[xmed.Length / 2];
                        double hxDeadband = PetScaleApi > 4.0 ? 6.0 : 2.0;
                        if (double.IsNaN(PetLocalHeadX) || Math.Abs(hxMedian - PetLocalHeadX) >= hxDeadband)
                        {
                            PetLocalHeadX = hxMedian;
                            PetLocalHeadXMs = nowMs;
                        }
                        lastHeadXMedian = hxMedian;
                    }
                    if (use || (DetectTicks % 10) == 0)
                    {
                        Log.Write(string.Format(CultureInfo.InvariantCulture,
                            "detect ok center={0:0.0} cluster={1} elapsedMs={2} used={3} detectMs={4}",
                            detectCenter, detectInfo, detectElapsedMs, use ? 1 : 0,
                            Cfg != null && Cfg.LiveFollow != null ? Cfg.LiveFollow.DetectMs : 0));
                    }
                    if (detectElapsedMs > DetectSlowMs && !slowDetectLogged)
                    {
                        slowDetectLogged = true;
                        Log.Write(string.Format(CultureInfo.InvariantCulture,
                            "detect slow elapsedMs={0} > {1}（检测间隔仍按配置 {2}ms）", detectElapsedMs, DetectSlowMs,
                            Cfg != null && Cfg.LiveFollow != null ? Cfg.LiveFollow.DetectMs : 0));
                    }
                }
                else
                {
                    DetectFailStreak++;
                    // 失败时保持 last-good 中心/抬升，绝不回跳 /api/state.startX（1000% 下检测抖动会导致来回跳）
                    if (DetectFailStreak == DetectFailFallback || DetectFailStreak == 1 || (DetectFailStreak % 100) == 0)
                    {
                        Log.Write("detect failed times=" + DetectFailStreak + " keep-last-good="
                            + (double.IsNaN(DetectCenterX) ? "none" : DetectCenterX.ToString("0.0", CultureInfo.InvariantCulture))
                            + " reason=" + Program.SafeText(detectInfo));
                    }
                }
                if (dirty) Dirty = true;
            }
        }

        /// <summary>v4 调试：无窗口探测一次桌宠（只读；部署前校验头顶/脚底检测与测试口径是否一致）。</summary>
        public int ProbePetOnce(string outPath)
        {
            try
            {
                HeadlessInit();
                PollPetState();
                System.Threading.Thread.Sleep(400);
                PollPetState();
                if (PetHwnd == IntPtr.Zero)
                {
                    Log.Write("probe-pet: no pet window");
                    return 2;
                }
                Native.RECT rect = new Native.RECT();
                rect.Left = PetLeft; rect.Top = PetTop;
                rect.Right = PetLeft + PetWidth; rect.Bottom = PetTop + PetHeight;
                double cx; string info; long ms; int feet; int head;
                double headCx = 0; bool ok = TryDetectCharacterCenter(PetHwnd, rect, out cx, out info, out ms, out feet, true, out head, out headCx);
                int headScreenNow = head > 0 ? PetTop + head : -1;
                int headScreenBase = head > 0 && PetBaseTop != int.MinValue ? PetBaseTop + head : -1;
                StringBuilder sb = new StringBuilder();
                sb.Append("{\n  \"ok\": ").Append(ok ? "true" : "false")
                  .Append(",\n  \"at\": ").Append(Json.Quote(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)))
                  .Append(",\n  \"petWindow\": { \"left\": ").Append(PetLeft).Append(", \"top\": ").Append(PetTop)
                  .Append(", \"width\": ").Append(PetWidth).Append(", \"height\": ").Append(PetHeight).Append(" }")
                  .Append(",\n  \"petBaseTop\": ").Append(PetBaseTop)
                  .Append(",\n  \"dpiScale\": ").Append(DpiScale.ToString("0.####", CultureInfo.InvariantCulture))
                  .Append(",\n  \"petScale\": ").Append(PetScaleApi.ToString("0.####", CultureInfo.InvariantCulture))
                  .Append(",\n  \"centerX\": ").Append(cx.ToString("0.##", CultureInfo.InvariantCulture))
                  .Append(",\n  \"feetLocalY\": ").Append(feet)
                  .Append(",\n  \"headLocalY\": ").Append(head)
                  .Append(",\n  \"headCenterX\": ").Append(headCx.ToString("0.##", CultureInfo.InvariantCulture))
                  .Append(",\n  \"petLocalHeadX\": ").Append(double.IsNaN(PetLocalHeadX) ? "null" : PetLocalHeadX.ToString("0.##", CultureInfo.InvariantCulture))
                  .Append(",\n  \"headScreenYNow\": ").Append(headScreenNow < 0 ? "null" : headScreenNow.ToString(CultureInfo.InvariantCulture))
                  .Append(",\n  \"headScreenYBase\": ").Append(headScreenBase < 0 ? "null" : headScreenBase.ToString(CultureInfo.InvariantCulture))
                  .Append(",\n  \"elapsedMs\": ").Append(ms)
                  .Append(",\n  \"cluster\": ").Append(Json.Quote(info ?? ""))
                  .Append("\n}\n");
                string dir = Path.GetDirectoryName(outPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(outPath, sb.ToString(), new UTF8Encoding(false));
                Log.Write("probe-pet saved path=" + outPath + " headLocalY=" + head + " feetLocalY=" + feet + " ok=" + ok
                    + " headScreenNow=" + headScreenNow + " headScreenBase=" + headScreenBase);
                return ok ? 0 : 1;
            }
            catch (Exception ex)
            {
                try { Log.Write("ERROR probe-pet: " + Program.SafeText(ex.Message)); } catch { }
                return 3;
            }
        }

        /// <summary>取桌宠窗口所在显示器的工作区（拿不到就用主屏默认值）。</summary>
        private static bool TryGetMonitorWorkArea(IntPtr hwnd, out Native.RECT work)
        {
            work = new Native.RECT();
            try
            {
                IntPtr mon = Native.MonitorFromWindow(hwnd, Native.MONITOR_DEFAULTTONEAREST);
                if (mon == IntPtr.Zero) return false;
                Native.MONITORINFO mi = new Native.MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO));
                if (!Native.GetMonitorInfo(mon, ref mi)) return false;
                work = mi.rcWork;
                return true;
            }
            catch { return false; }
        }

        /// <summary>
        /// 对桌宠透明覆盖窗做 PrintWindow(PW_RENDERFULLCONTENT) 抓图，只扫「地面带」：
        /// 逐列统计 RGB max&gt;24 的像素数 → 有效列 → 连续列簇（宽 60–450）→ 取像素量最大的簇，
        /// 角色中心 x = 窗口 Left + 簇中心。透明区域渲染为纯黑（RGB=0），所以能直接用 RGB 判角色像素。
        /// </summary>
        private bool TryDetectCharacterCenter(IntPtr petHwnd, Native.RECT rect, out double centerX, out string info, out long elapsedMs, out int feetLocalY, bool wantHead, out int headLocalY, out double headCenterX)
        {
            centerX = 0;
            info = "";
            feetLocalY = -1;
            headLocalY = -1;
            headCenterX = 0;
            Stopwatch sw = Stopwatch.StartNew();
            int w = rect.Right - rect.Left;
            int h = rect.Bottom - rect.Top;
            if (petHwnd == IntPtr.Zero || w < 64 || h < 64)
            {
                info = "bad window " + w + "x" + h;
                elapsedMs = sw.ElapsedMilliseconds;
                return false;
            }
            Bitmap bmp = null;
            try
            {
                bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
                bool printed;
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    IntPtr hdc = g.GetHdc();
                    try { printed = Native.PrintWindow(petHwnd, hdc, Native.PW_RENDERFULLCONTENT); }
                    finally { g.ReleaseHdc(hdc); }
                }
                if (!printed)
                {
                    info = "PrintWindow false";
                    elapsedMs = sw.ElapsedMilliseconds;
                    return false;
                }
                int bandBottom = h - 2;
                int bandHeightUse = DetectBandHeight;
                if (PetScaleApi > 4.0)
                {
                    int bigBand = (int)(h * 0.40);
                    if (bigBand > bandHeightUse) bandHeightUse = bigBand;
                }
                int bandTop = bandBottom - bandHeightUse;
                if (bandTop < 0) bandTop = 0;
                if (bandBottom <= bandTop)
                {
                    info = "empty band";
                    elapsedMs = sw.ElapsedMilliseconds;
                    return false;
                }
                int[] colCount = new int[w];
                int[] colBottom = new int[w];
                int[] colLow = new int[w];                 // 仅统计「下 40% 区域」的列质量（超大角色质心法用）
                int bandHeight = bandBottom - bandTop;
                int lowTop = bandTop + (int)(bandHeight * 0.60);
                for (int i = 0; i < w; i++) colBottom[i] = -1;
                BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                try
                {
                    byte[] row = new byte[data.Stride];
                    for (int y = bandTop; y < bandBottom; y++)
                    {
                        Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), row, 0, data.Stride);
                        for (int x = 0; x < w; x++)
                        {
                            int p = x * 4;
                            int b = row[p];
                            int gg = row[p + 1];
                            int r = row[p + 2];
                            int mx = r; if (gg > mx) mx = gg; if (b > mx) mx = b;
                            if (mx > DetectPixelThreshold)
                            {
                                colCount[x]++;
                                if (y >= lowTop) colLow[x]++;
                            }
                            if (mx > DetectFeetThreshold) colBottom[x] = y;
                        }
                    }
                }
                finally { bmp.UnlockBits(data); }

                int bestMass = -1;
                int bestStart = 0;
                int bestEnd = 0;
                int runStart = -1;
                int runLast = -1;
                for (int x = 0; x < w; x++)
                {
                    if (colCount[x] < DetectMinColumnPixels)
                    {
                        if (runStart >= 0)
                        {
                            ConsiderCluster(runStart, runLast, colCount, ref bestMass, ref bestStart, ref bestEnd);
                            runStart = -1;
                        }
                        continue;
                    }
                    if (runStart < 0) { runStart = x; runLast = x; continue; }
                    if (x - runLast <= DetectClusterGapPx + 1) { runLast = x; continue; }
                    ConsiderCluster(runStart, runLast, colCount, ref bestMass, ref bestStart, ref bestEnd);
                    runStart = x;
                    runLast = x;
                }
                if (runStart >= 0) ConsiderCluster(runStart, runLast, colCount, ref bestMass, ref bestStart, ref bestEnd);
                // ---- 脚部锚点：角色 bbox 底部 10% 像素带（脚/鞋）的列质量质心，待机摆手/摆尾不影响 ----
                int bboxBottom = -1;
                for (int x = 0; x < w; x++) if (colBottom[x] > bboxBottom) bboxBottom = colBottom[x];
                if (bboxBottom > bandTop)
                {
                    int footH = Math.Max(6, (int)((bboxBottom - bandTop) * 0.10));
                    int footTop = Math.Max(bandTop, bboxBottom - footH + 1);
                    int[] colFoot = new int[w];
                    BitmapData d2 = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    try
                    {
                        byte[] row2 = new byte[d2.Stride];
                        for (int y = footTop; y <= bboxBottom; y++)
                        {
                            Marshal.Copy(new IntPtr(d2.Scan0.ToInt64() + (long)y * d2.Stride), row2, 0, d2.Stride);
                            for (int x = 0; x < w; x++)
                            {
                                int q = x * 4;
                                int bb = row2[q], gg2 = row2[q + 1], rr = row2[q + 2];
                                int m2 = rr; if (gg2 > m2) m2 = gg2; if (bb > m2) m2 = bb;
                                if (m2 > DetectPixelThreshold) colFoot[x]++;
                            }
                        }
                    }
                    finally { bmp.UnlockBits(d2); }
                    long footMass = 0;
                    double footSum = 0;
                    int fx0 = -1, fx1 = -1;
                    for (int x = 0; x < w; x++)
                    {
                        if (colFoot[x] <= 0) continue;
                        footMass += colFoot[x];
                        footSum += (double)x * colFoot[x];
                        if (fx0 < 0) fx0 = x;
                        fx1 = x;
                    }
                    if (footMass >= 40)
                    {
                        centerX = rect.Left + footSum / footMass;
                        feetLocalY = bboxBottom;
                        info = string.Format(CultureInfo.InvariantCulture,
                            "foot-anchor x{0}..{1} mass={2} footH={3} bboxBottom={4} band={5}",
                            fx0, fx1, footMass, footH, bboxBottom, bandBottom - bandTop);
                        if (wantHead)
                        {
                            double bcx;
                            int hy = DetectHeadTop(bmp, w, h, rect, centerX, out bcx);
                            if (hy > 0) { headLocalY = hy; if (bcx > 0) { centerX = bcx; headCenterX = bcx; } }
                        }
                        elapsedMs = sw.ElapsedMilliseconds;
                        return true;
                    }
                }

                bool bigPet = PetScaleApi > 4.0;
                if (bigPet || bestMass <= 0)
                {
                    // 超大角色（如 1000%）/列簇铺满 band：用「下 40% 区域」列质量加权质心求中心
                    long totalMass = 0;
                    double sumX = 0;
                    int minX = -1, maxX = -1;
                    int feetC = -1;
                    for (int x = 0; x < w; x++)
                    {
                        int m = colLow[x] > 0 ? colLow[x] : (bigPet ? 0 : colCount[x]);
                        if (m <= 0) continue;
                        totalMass += m;
                        sumX += (double)x * m;
                        if (minX < 0) minX = x;
                        maxX = x;
                        if (colBottom[x] > feetC) feetC = colBottom[x];
                    }
                    if (totalMass >= 120 || (totalMass > 0 && bigPet))
                    {
                        centerX = rect.Left + sumX / totalMass;
                        feetLocalY = feetC;
                        info = string.Format(CultureInfo.InvariantCulture,
                            "centroid x{0}..{1} mass={2} band={3} feet={4} big={5}",
                            minX, maxX, totalMass, bandHeight, feetC, bigPet ? 1 : 0);
                        if (wantHead)
                        {
                            double bcx;
                            int hy = DetectHeadTop(bmp, w, h, rect, centerX, out bcx);
                            if (hy > 0) { headLocalY = hy; if (bcx > 0) { centerX = bcx; headCenterX = bcx; } }
                        }
                        elapsedMs = sw.ElapsedMilliseconds;
                        return true;
                    }
                    info = "no mass in band " + bandTop + ".." + (bandBottom - 1);
                    elapsedMs = sw.ElapsedMilliseconds;
                    return false;
                }
                centerX = rect.Left + (bestStart + bestEnd) / 2.0;
                int feet = -1;
                for (int i = bestStart; i <= bestEnd; i++) if (colBottom[i] > feet) feet = colBottom[i];
                feetLocalY = feet;
                info = string.Format(CultureInfo.InvariantCulture, "x{0}..{1} w={2} mass={3} band={4} feet={5}",
                    bestStart, bestEnd, bestEnd - bestStart + 1, bestMass, bandBottom - bandTop, feet);
                if (wantHead)
                {
                    double bcx;
                    int hy = DetectHeadTop(bmp, w, h, rect, centerX, out bcx);
                    if (hy > 0) { headLocalY = hy; if (bcx > 0) { centerX = bcx; headCenterX = bcx; } }
                }
                elapsedMs = sw.ElapsedMilliseconds;
                return true;
            }
            catch (Exception ex)
            {
                info = "error: " + Program.SafeText(ex.Message);
                elapsedMs = sw.ElapsedMilliseconds;
                return false;
            }
            finally
            {
                if (bmp != null) bmp.Dispose();
            }
        }

        /// <summary>
        /// v4 头顶锚点：以脚部检测到的中心为横向中心，扫整幅桌宠窗上半部，找角色本体「最高的连续行带」
        /// （头顶漂浮小图标是短带，会被忽略），取其顶边为头顶局部 y；同时给出本体 bbox 中心 x。
        /// 与桌宠边界测量口径（sprite_bbox.top）一致。
        /// </summary>
        private int DetectHeadTop(Bitmap bmp, int w, int h, Native.RECT rect, double footCenterX, out double bodyCenterX)
        {
            bodyCenterX = 0;
            if (bmp == null || h < 24) return -1;
            int scanBottom = h - 2;   // 最后 1~2 行留给脚底/阴影，避免把底部杂点算进本体带
            if (scanBottom < 16) return -1;
            try
            {
                int petPxW = (int)Math.Round(77.0 * PetScaleApi / 1.05);
                int halfW = Math.Max(60, (int)Math.Round(petPxW * 0.95));
                int cxLocal = (int)Math.Round(footCenterX - rect.Left);
                int x0 = cxLocal - halfW; if (x0 < 0) x0 = 0;
                int x1 = cxLocal + halfW; if (x1 > w - 1) x1 = w - 1;
                if (x1 <= x0) return -1;
                int rw = x1 - x0 + 1;
                int[] rowCount = new int[scanBottom];
                int[] rowMinX = new int[scanBottom];
                int[] rowMaxX = new int[scanBottom];
                BitmapData d = bmp.LockBits(new Rectangle(x0, 0, rw, scanBottom), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                try
                {
                    byte[] row = new byte[rw * 4];
                    for (int y = 0; y < scanBottom; y++)
                    {
                        Marshal.Copy(new IntPtr(d.Scan0.ToInt64() + (long)y * d.Stride), row, 0, rw * 4);
                        int cnt = 0; int mn = -1; int mx = -1;
                        for (int x = 0; x < rw; x++)
                        {
                            int p = x * 4;
                            int b = row[p]; int gg = row[p + 1]; int r = row[p + 2];
                            // 与桌宠边界测量同口径：rgb 三通道之和 > 30（含半透明边缘像素，保证 bbox 中心/顶边一致）
                            if (b + gg + r > 30) { cnt++; if (mn < 0) mn = x; mx = x; }
                        }
                        rowCount[y] = cnt; rowMinX[y] = mn; rowMaxX[y] = mx;
                    }
                }
                finally { bmp.UnlockBits(d); }
                // 连续行带（任一行有像素即可）→ 高度最大的一段 = 角色本体（头顶漂浮小图标是短带，会被忽略）
                int bestH = 0, bestTop = -1, runTop = -1, runLast = -1;
                for (int y = 0; y < scanBottom; y++)
                {
                    if (rowCount[y] < 1)
                    {
                        if (runTop >= 0) { int hh = runLast - runTop + 1; if (hh > bestH) { bestH = hh; bestTop = runTop; } runTop = -1; }
                        continue;
                    }
                    if (runTop < 0) { runTop = y; runLast = y; continue; }
                    runLast = y;
                }
                if (runTop >= 0) { int hh = runLast - runTop + 1; if (hh > bestH) { bestH = hh; bestTop = runTop; } }
                if (bestTop < 0 || bestH < 10) return -1;
                int mnX = int.MaxValue; int mxX = -1;
                for (int y = bestTop; y < scanBottom; y++)
                {
                    if (rowCount[y] < 1) continue;
                    if (rowMinX[y] >= 0 && rowMinX[y] < mnX) mnX = rowMinX[y];
                    if (rowMaxX[y] > mxX) mxX = rowMaxX[y];
                }
                if (mxX < 0 || mnX == int.MaxValue) return -1;
                bodyCenterX = rect.Left + x0 + (mnX + mxX) / 2.0;
                return bestTop;
            }
            catch { return -1; }
        }

        private static void ConsiderCluster(int x0, int x1, int[] colCount, ref int bestMass, ref int bestStart, ref int bestEnd)
        {
            int width = x1 - x0 + 1;
            if (width < DetectMinClusterWidth || width > DetectMaxClusterWidth) return;
            int mass = 0;
            for (int i = x0; i <= x1; i++) mass += colCount[i];
            if (mass > bestMass)
            {
                bestMass = mass;
                bestStart = x0;
                bestEnd = x1;
            }
        }

        private static readonly Dictionary<int, IntPtr> s_petCache = new Dictionary<int, IntPtr>();

        private static IntPtr FindPetWindow()
        {
            HashSet<int> pids = new HashSet<int>();
            Process[] procs = null;
            try
            {
                procs = Process.GetProcessesByName("Coopanion");
                for (int i = 0; i < procs.Length; i++)
                {
                    try { pids.Add(procs[i].Id); }
                    catch { }
                }
            }
            catch { }
            finally
            {
                if (procs != null)
                {
                    for (int i = 0; i < procs.Length; i++)
                    {
                        try { procs[i].Dispose(); }
                        catch { }
                    }
                }
            }
            if (pids.Count == 0) return IntPtr.Zero;
            IntPtr found = IntPtr.Zero;
            Native.EnumWindowsProc cb = delegate(IntPtr hWnd, IntPtr lParam)
            {
                uint pid;
                Native.GetWindowThreadProcessId(hWnd, out pid);
                if (!pids.Contains((int)pid)) return true;
                if (!Native.IsWindowVisible(hWnd)) return true;
                StringBuilder cls = new StringBuilder(64);
                Native.GetClassName(hWnd, cls, cls.Capacity);
                if (cls.ToString() != "Chrome_WidgetWin_1") return true;
                StringBuilder title = new StringBuilder(256);
                Native.GetWindowText(hWnd, title, title.Capacity);
                if (title.ToString() != "Cortico 桌宠") return true;
                found = hWnd;
                return false;
            };
            Native.EnumWindows(cb, IntPtr.Zero);
            return found;
        }

        // ---------------------------------------------------------- 绘制

        public void Repaint()
        {
            if (Hwnd == IntPtr.Zero) return;
            Placement pl = new Placement();
            ProviderView[] views = new ProviderView[0];
            bool visible = false;
            bool logPlacement = false;
            bool smooth = true;
            Config cfgSnap = null;
            int countSnap = 0;   // 0.0.7：lock 内的 n 作用域不外露，带出来给 mini 渲染用
            bool rice = false;
            bool mini = false;   // 0.0.7：minicard 小面板形态
            bool expanded = false;
            BowlLayout lay = null;
            // ---- v21（第 21 轮乙路）：桌宠缺失隐藏快照（lock 内赋值，lock 外用于日志/显隐）----
            bool hiddenByMissingPet = false;
            bool showByPetDetected = false;
            long missingMsSnap = 0;
            lock (Gate)
            {
                if (Quit) return;
                Config cfg = Cfg;
                if (cfg == null) return;
                cfgSnap = cfg;
                int n = EffectiveProviderCountLocked();
                countSnap = n;
                visible = cfg.Enabled && n > 0;
                // 桌宠缺失 ≥600ms：本次不计算位置/布局、不跑动画，直接走已有的 SW_HIDE 分支（保持最后位置）
                hiddenByMissingPet = HiddenByMissingPet;
                showByPetDetected = petReshowPending;
                if (showByPetDetected) petReshowPending = false;
                missingMsSnap = petMissingSinceMs < 0 ? 0 : NowMs - petMissingSinceMs;
                if (hiddenByMissingPet) visible = false;
                smooth = cfg.LiveFollow == null || cfg.LiveFollow.Smooth;
                rice = cfg.Display != null && string.Equals(cfg.Display.Style, "ricebowl", StringComparison.OrdinalIgnoreCase);
                mini = cfg.Display != null && string.Equals(cfg.Display.Style, "minicard", StringComparison.OrdinalIgnoreCase);
                bool headWear = cfg.Display != null && string.Equals(cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase);
                expanded = Expanded && rice && cfg.Interaction != null && cfg.Interaction.ExpandOnClick;
                if (visible)
                {
                    if (rice) lay = BowlLayout.Compute(cfg, n, DpiScale, GraphicsScaleVal, headWear);
                    pl = ComputePlacementLocked(cfg, n, expanded);
                    views = BuildViewsLocked(n);
                    if (rice)
                    {
                        LastLayout = lay;
                        string sig = lay.Signature(cfg, n, expanded);
                        if (n != lastDisplayCount || sig != lastDisplaySig)
                        {
                            lastDisplayCount = n;
                            lastDisplaySig = sig;
                            Log.Write(string.Format(CultureInfo.InvariantCulture,
                                "display style={0} bowl={1} labelStyle={2} wear={3} count={4} compact={5} layout={6} pyramid={7} twoRows={8} rows={9} groupW={10} groupH={11} lift={12} expanded={13}",
                                cfg.Display.Style, cfg.Display.BowlStyle, cfg.Display.LabelStyle, cfg.Display.Wear, n, lay.Compact ? 1 : 0,
                                cfg.Display.NineLayout, lay.Pyramid ? 1 : 0, lay.TwoRows ? 1 : 0, lay.RowCountsText(),
                                lay.GroupW, lay.GroupH, (headWear ? 0 : (int)Math.Round(6.0 * DpiScale) + lay.GroupH), expanded ? 1 : 0));
                        }
                        if (n != lastTransitionCount || lay.GroupH != lastTransitionGroupH)
                        {
                            if (lastTransitionCount > 0)
                            {
                                Log.Write(string.Format(CultureInfo.InvariantCulture,
                                    "transition providers={0}->{1} groupH={2}->{3}", lastTransitionCount, n, lastTransitionGroupH, lay.GroupH));
                            }
                            lastTransitionCount = n;
                            lastTransitionGroupH = lay.GroupH;
                        }
                    }
                }
                if (!hiddenByMissingPet)
                {
                    // 缺失期间不重算位置：保持 LastPlacement（隐藏后再显示在原位置恢复）
                    if (!pl.SameAs(LastPlacement)) logPlacement = true;
                    LastPlacement = pl;
                }
                if (visible)
                {
                    targetX = pl.X;
                    targetY = pl.Y;
                    if (!smooth || !animInit)
                    {
                        animX = pl.X;
                        animY = pl.Y;
                        animInit = true;
                    }
                }
            }
            if (!visible)
            {
                if (Visible)
                {
                    Native.ShowWindow(Hwnd, Native.SW_HIDE);
                    Native.KillTimer(Hwnd, 1);
                    Visible = false;
                    animActive = false;
                    idleTimerSlow = false;
                    if (hiddenByMissingPet)
                    {
                        // 与 Mac 日志对齐：panel hide reason=pet-hidden missingMs=<ms>
                        Log.Write(string.Format(CultureInfo.InvariantCulture,
                            "panel hide reason=pet-hidden missingMs={0}", missingMsSnap));
                    }
                    else
                    {
                        Log.Write("panel hidden");
                    }
                }
                return;
            }
            if (!Visible)
            {
                Native.ShowWindow(Hwnd, Native.SW_SHOWNOACTIVATE);
                Visible = true;
                if (showByPetDetected)
                {
                    // 与 Mac 日志对齐：panel show reason=pet-detected
                    Log.Write("panel show reason=pet-detected");
                }
                else
                {
                    Log.Write("panel shown");
                }
            }
            // 内容没变只挪位置，不重绘（动画 60fps 时靠缓存位图）
            string key = ContentKeyOf(views);
            bool reRender = cachedBitmap == null || key != contentKey || cachedW != pl.Width || cachedH != pl.Height;
            if (reRender)
            {
                Bitmap bmp = null;
                try
                {
                    if (mini)
                    {
                        // 0.0.7 小面板：必须与 ComputePlacementLocked 用同一个 n 重算，
                        // 否则图与窗口尺寸不一致 → PaintLayered 整幅 Blit 只画一部分/留白。
                        // McRenderer 对越界 view 已做 null 兜底（灰点 + "--"），不会崩。
                        // n 与 views 实际条数取较小值：DemoCount 等场景下两者可能不等，
                        // 用较小值保证「图里的行数 = 有数据的行数」，也不越界。
                        int mn = countSnap;
                        if (views == null) mn = 0;
                        else if (views.Length < mn) mn = views.Length;
                        McLayout mcl = McLayout.Compute(cfgSnap, mn, DpiScale, GraphicsScaleVal, ViewNamesForMini(cfgSnap, mn));
                        bmp = McRenderer.Render(views, mcl, Style, DpiScale);
                    }
                    else if (rice && lay != null)
                    {
                        if (expanded) bmp = DetailRenderer.Render(cfgSnap, views, lay, Style, DpiScale);
                        else bmp = BowlRenderer.Render(cfgSnap, views, lay, Style, DpiScale);
                    }
                    else
                    {
                        int cw, ch, step;
                        CapsuleMetrics(cfgSnap, DpiScale, out cw, out ch, out step);
                        bmp = Renderer.Render(views, pl.Width, pl.Height, DpiScale, cw, ch, step);
                    }
                }
                catch (Exception ex)
                {
                    Log.Write("ERROR render: " + Program.SafeText(ex.Message));
                }
                if (bmp != null)
                {
                    Bitmap old = null;
                    lock (Gate)
                    {
                        old = cachedBitmap;
                        cachedBitmap = bmp;
                        cachedW = pl.Width;
                        cachedH = pl.Height;
                        contentKey = key;
                    }
                    if (old != null) old.Dispose();
                }
            }
            EnsureAnimation();
            PaintCurrent();
            ApplyZOrder(pl);
            if (logPlacement) LogPlacement(pl);
        }

        private string ContentKeyOf(ProviderView[] views)
        {
            StringBuilder sb = new StringBuilder(320);
            for (int i = 0; i < views.Length; i++)
            {
                ProviderView v = views[i];
                sb.Append(v.Id).Append('>')
                  .Append(v.Name).Append('|')
                  .Append(v.HasResult ? 1 : 0).Append(v.Ok ? 1 : 0).Append('|')
                  // 0.0.7：指纹也按取整后的值，否则小数位变化会触发无谓重绘、而显示上是同一个数字
                  .Append(UnitFormat.Money(v.Amount).ToString(CultureInfo.InvariantCulture)).Append('|')
                  // v22：失败时「上次成功金额」是否在显示也要参与内容指纹，否则 10 分钟窗口到期不会重绘成「连接失败」
                  .Append(v.ShowLastGood ? 1 : 0).Append('|')
                  .Append(UnitFormat.Money(v.LastGoodAmount).ToString(CultureInfo.InvariantCulture)).Append('|')
                  .Append(v.Low ? 1 : 0).Append('|')
                  .Append(v.Rice ? 1 : 0).Append('|')
                  .Append(v.Ratio.ToString("0.###", CultureInfo.InvariantCulture)).Append('|')
                  .Append(v.FullAmount.ToString("0.##", CultureInfo.InvariantCulture)).Append(';');
            }
            Config cfg = Cfg;
            if (cfg != null)
            {
                sb.Append("|d=").Append(cfg.Display.Style).Append('/').Append(cfg.Display.BowlStyle)
                  .Append('/').Append(cfg.Display.NineLayout).Append('/').Append(cfg.Display.CompactAfter)
                  .Append('/').Append(cfg.Display.Wheels ? 1 : 0)
                  .Append('/').Append(cfg.Display.LabelStyle)
                  .Append("/w=").Append(cfg.Display.Wear)
                  .Append("/s=").Append(GraphicsScaleVal.ToString("0.####", CultureInfo.InvariantCulture));
                sb.Append("|t=").Append(Style == null ? "" : Style.Key);
                sb.Append("|x=").Append(Expanded ? 1 : 0);
                sb.Append("|demo=").Append(DemoCount);
            }
            return sb.ToString();
        }

        /// <summary>
        /// 小面板定卡宽用的家名清单。按配置里的 provider 顺序取名（还没查到结果时也有稳定宽度，
        /// 避免「首帧窄、来数据后变宽」的抖动）。家数不足时用占位空串补齐。
        /// </summary>
        private string[] ViewNamesForMini(Config cfg, int n)
        {
            if (n < 0) n = 0;
            string[] names = new string[n];
            int got = 0;
            if (cfg != null && cfg.Providers != null)
            {
                for (int i = 0; i < cfg.Providers.Count && got < n; i++)
                {
                    ProviderConfig pc = cfg.Providers[i];
                    string nm = (pc == null || pc.Name == null) ? "" : pc.Name.Trim();
                    names[got++] = nm;
                }
            }
            while (got < n) names[got++] = "";
            return names;
        }

        private Placement ComputePlacementLocked(Config cfg, int n, bool expanded)
        {
            Placement pl = new Placement();
            pl.Valid = true;
            pl.Mode = cfg.Position.Mode;
            pl.ZOrder = cfg.Position.ZOrder;
            int w, h;
            bool headWear = cfg.Display != null && string.Equals(cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase);
            if (cfg.Display != null && string.Equals(cfg.Display.Style, "minicard", StringComparison.OrdinalIgnoreCase))
            {
                // 0.0.7 第三种形态：小面板。卡片尺寸即窗口尺寸（PaintLayered 整幅 Blit，必须同源）。
                McLayout mcl = McLayout.Compute(cfg, n, DpiScale, GraphicsScaleVal, ViewNamesForMini(cfg, n));
                w = (int)Math.Round(mcl.CardW);
                h = (int)Math.Round(mcl.CardH);
            }
            else if (cfg.Display != null && string.Equals(cfg.Display.Style, "ricebowl", StringComparison.OrdinalIgnoreCase))
            {
                BowlLayout lay = BowlLayout.Compute(cfg, n, DpiScale, GraphicsScaleVal, headWear);
                if (expanded) DetailRenderer.Measure(cfg, n, DpiScale, lay, out w, out h);
                else { w = lay.GroupW; h = lay.GroupH; }
            }
            else
            {
                int cw, ch, step;
                CapsuleMetrics(cfg, DpiScale, out cw, out ch, out step);
                w = cw;
                h = ch + (n - 1) * step;
            }
            pl.Width = w;
            pl.Height = h;
            double petCenter;
            bool useDetect = DetectOk && (NowMs - DetectLastOkMs) <= DetectStaleMs;
            if (useDetect)
            {
                // 实时检测优先：/api/state 的 startX 是保存值，拖动桌宠后不跟
                petCenter = DetectCenterX;
                pl.Source = "detect";
            }
            else if (!double.IsNaN(DetectCenterX))
            {
                // 检测暂时不可用：保持 last-good 中心，不回跳 /api/state.startX
                petCenter = DetectCenterX;
                pl.Source = "last-good";
            }
            else if (PetValid && PetWidth > 0)
            {
                petCenter = PetLeft + PetWidth / 2.0;
                pl.Source = "fallback-petrect-center";
            }
            else if (PetValid && PetWidth > 0)
            {
                petCenter = PetLeft + PetWidth * DefaultStartX;
                pl.Source = "fallback-petrect";
            }
            else
            {
                petCenter = WorkLeft + (WorkRight - WorkLeft) * DefaultStartX;
                pl.Source = "fallback-workarea";
            }
            if (headWear && !double.IsNaN(PetLocalHeadX) && PetLocalHeadX > 0)
            {
                // v4：head 形态水平锚点 = 本体 bbox 中心（与桌宠边界测量口径 sprite_bbox.center_x 一致）
                petCenter = PetLocalHeadX;
                pl.Source = "detect-head-x";
            }
            pl.PetCenterX = petCenter;
            int raw = (int)Math.Round(petCenter - pl.Width / 2.0 + cfg.Position.OffsetX);
            pl.RawX = raw;
            int margin = cfg.Position.ClampMargin;
            if (margin < 0) margin = 0;
            int minX = MonLeft + margin;
            int maxX = MonRight - pl.Width - margin;
            if (maxX < minX) maxX = minX;
            int x = raw < minX ? minX : (raw > maxX ? maxX : raw);
            pl.ClampOffsetX = x - raw;
            pl.X = x;
            pl.Wear = headWear ? "head" : "feet";
            int y;
            if (headWear)
            {
                // v4 头顶：盆组底 = 角色头顶 + contact(3×dpi)；head 模式 lift=0（桌宠不抬），贴边 clamp 到工作区/屏幕。
                int headScreen;
                bool headFresh = PetLocalHeadY > 0 && (NowMs - PetLocalHeadMs) <= 3000;
                if (headFresh && PetBaseTop != int.MinValue) headScreen = PetBaseTop + PetLocalHeadY;
                else if (LastHeadScreenY > 0) headScreen = LastHeadScreenY;
                else if (PetBaseTop != int.MinValue) headScreen = PetBaseTop + Math.Max(24, PetHeight / 4);
                else headScreen = WorkTop + Math.Max(24, pl.Height);
                int contact = WearMath.ContactPx(DpiScale);
                pl.HeadScreenY = headScreen;
                y = headScreen - pl.Height + contact + cfg.Position.OffsetY;
                int hyMin = WorkTop;
                int hyMax = MonBottom - pl.Height;
                if (hyMax < hyMin) hyMax = hyMin;
                if (y < hyMin) y = hyMin;
                if (y > hyMax) y = hyMax;
            }
            else
            {
                // A3：整组底边 = 工作区底 − bottomGap（默认 8，任务栏上沿上方，绝不压任务栏）
                int bottomGap = cfg.Position.BottomGap;
                if (bottomGap < 0) bottomGap = 0;
                y = WorkBottom - bottomGap - pl.Height + cfg.Position.OffsetY;
                pl.HeadScreenY = -1;
            }
            int minY = WorkTop;
            int maxY = MonBottom - pl.Height;
            if (maxY < minY) maxY = minY;
            if (y > maxY) y = maxY;
            if (y < minY) y = minY;
            pl.Y = y;
            return pl;
        }

        private ProviderView[] BuildViewsLocked(int n)
        {
            if (DemoCount > 0) return DemoData.BuildViews(DemoCount, Cfg);
            List<ProviderView> list = new List<ProviderView>();
            foreach (ProviderRuntime rt in Providers)
            {
                if (!rt.Cfg.Enabled) continue;
                if (list.Count >= n) break;
                ProviderView v = new ProviderView();
                v.Id = rt.Cfg.Id;
                v.Name = string.IsNullOrEmpty(rt.Cfg.Name) ? rt.Cfg.Id : rt.Cfg.Name;
                v.Unit = UnitFormat.Normalize(rt.Cfg.Unit, Net.NormalizePreset(rt.Cfg));
                v.Rice = rt.Cfg.IsRice;
                v.FullAmount = rt.Cfg.FullAmount;
                v.Threshold = rt.Cfg.Threshold.HasValue ? rt.Cfg.Threshold.Value : double.NaN;
                v.IntervalSec = rt.Cfg.IntervalSec;
                v.LastAttemptMs = rt.LastAttemptMs;
                v.LastOkMs = rt.LastOkMs;
                BalanceResult res = rt.Result;
                if (res != null)
                {
                    v.HasResult = true;
                    v.Ok = res.Ok;
                    v.Amount = res.Amount;
                    v.Error = res.Error;
                    v.Currency = string.IsNullOrEmpty(res.Currency) ? "CNY" : res.Currency;
                    v.Low = res.Ok && rt.Cfg.Threshold.HasValue && res.Amount < rt.Cfg.Threshold.Value;
                }
                // v22 网络瞬断韧性：失败不清空金额——10 分钟窗口内保留最后一次成功值（灰字=非实时）
                v.HasLastGood = rt.LastGoodMs > 0;
                v.LastGoodAmount = rt.LastGoodAmount;
                v.LastGoodCurrency = string.IsNullOrEmpty(rt.LastGoodCurrency) ? "CNY" : rt.LastGoodCurrency;
                v.LastGoodMs = rt.LastGoodMs;
                v.ShowLastGood = res != null && !res.Ok && rt.LastGoodMs > 0
                    && (NowMs - rt.LastGoodMs) <= LastGoodWindowMs;
                if (v.Rice)
                {
                    v.HasResult = true;
                    v.Ok = true;
                    v.Low = false;
                    v.Ratio = 1.0;
                }
                else if (v.HasResult && v.Ok)
                {
                    double full = v.FullAmount > 0.01 ? v.FullAmount : 100.0;
                    v.Ratio = Math.Max(0, Math.Min(1, v.Amount / full));
                }
                else if (v.ShowLastGood)
                {
                    // 失败但仍在保留窗口内：米饭量沿用上次成功金额（不因失败清零）
                    double full = v.FullAmount > 0.01 ? v.FullAmount : 100.0;
                    v.Ratio = Math.Max(0, Math.Min(1, v.LastGoodAmount / full));
                }
                else v.Ratio = 0;
                list.Add(v);
            }
            return list.ToArray();
        }

        private void PaintLayered(Bitmap bmp, int x, int y)
        {
            IntPtr screenDc = Native.GetDC(IntPtr.Zero);
            IntPtr memDc = Native.CreateCompatibleDC(screenDc);
            IntPtr hBmp = IntPtr.Zero;
            IntPtr oldBmp = IntPtr.Zero;
            try
            {
                hBmp = bmp.GetHbitmap(Color.FromArgb(0));
                oldBmp = Native.SelectObject(memDc, hBmp);
                Native.POINT dst = new Native.POINT();
                dst.X = x; dst.Y = y;
                Native.SIZE size = new Native.SIZE();
                size.cx = bmp.Width; size.cy = bmp.Height;
                Native.POINT src = new Native.POINT();
                src.X = 0; src.Y = 0;
                Native.BLENDFUNCTION bf = new Native.BLENDFUNCTION();
                bf.BlendOp = Native.AC_SRC_OVER;
                bf.BlendFlags = 0;
                bf.SourceConstantAlpha = 255;
                bf.AlphaFormat = Native.AC_SRC_ALPHA;
                bool ok = Native.UpdateLayeredWindow(Hwnd, screenDc, ref dst, ref size, memDc, ref src, 0, ref bf, Native.ULW_ALPHA);
                if (!ok) Log.Write("WARN UpdateLayeredWindow failed err=" + Marshal.GetLastWin32Error());
            }
            finally
            {
                if (oldBmp != IntPtr.Zero) Native.SelectObject(memDc, oldBmp);
                if (hBmp != IntPtr.Zero) Native.DeleteObject(hBmp);
                Native.DeleteDC(memDc);
                Native.ReleaseDC(IntPtr.Zero, screenDc);
            }
        }

        private void ApplyZOrder(Placement pl)
        {
            IntPtr pet;
            lock (Gate) { pet = PetHwnd; }
            if (pl.ZOrder == "topmost")
            {
                Native.SetWindowPos(Hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0,
                    Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            }
            else if (pet != IntPtr.Zero)
            {
                Native.SetWindowPos(Hwnd, pet, 0, 0, 0, 0,
                    Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_NOOWNERZORDER);
            }
        }

        private void LogPlacement(Placement pl)
        {
            Log.Write(string.Format(CultureInfo.InvariantCulture,
                "place src={0} petCenter={1:0.0} rawX={2} targetX={3} targetY={4} w={5} h={6} clampX={7} lift={8:0.0} detect={9} wear={10} headY={11}",
                pl.Source, pl.PetCenterX, pl.RawX, pl.X, pl.Y, pl.Width, pl.Height, pl.ClampOffsetX,
                currentLift, DetectLastClusterInfo, pl.Wear, pl.HeadScreenY));
        }
    }

    // ------------------------------------------------------------------ 渲染

    internal static class Renderer
    {
        private static readonly object s_gate = new object();
        private static readonly Dictionary<string, Font> s_fonts = new Dictionary<string, Font>();
        private static string s_family;
        private const float DesignW = 218f;
        private const float DesignH = 46f;
        private const float DesignGap = 12f;

        private static readonly Color FillColor = Color.FromArgb(248, 24, 30, 42);
        private static readonly Color BorderColor = Color.FromArgb(255, 70, 84, 106);
        private static readonly Color HighlightColor = Color.FromArgb(255, 96, 112, 138);
        private static readonly Color DotGreen = Color.FromArgb(255, 56, 211, 159);
        private static readonly Color DotRed = Color.FromArgb(255, 255, 92, 92);
        private static readonly Color DotGrey = Color.FromArgb(255, 152, 160, 176);
        private static readonly Color NameColor = Color.FromArgb(255, 146, 156, 176);
        private static readonly Color AmountColor = Color.FromArgb(255, 240, 244, 251);
        private static readonly Color LowColor = Color.FromArgb(255, 255, 92, 92);
        private static readonly Color FailColor = Color.FromArgb(255, 152, 160, 176);

        public static void Dispose()
        {
            lock (s_gate)
            {
                foreach (KeyValuePair<string, Font> kv in s_fonts) { try { kv.Value.Dispose(); } catch { } }
                s_fonts.Clear();
            }
        }

        private static string Family()
        {
            lock (s_gate)
            {
                if (s_family != null) return s_family;
                string[] candidates = new string[] { "Microsoft YaHei UI", "Microsoft YaHei", "微软雅黑", "Segoe UI", "Arial" };
                for (int i = 0; i < candidates.Length; i++)
                {
                    try
                    {
                        using (FontFamily ff = new FontFamily(candidates[i]))
                        {
                            s_family = ff.Name;
                            return s_family;
                        }
                    }
                    catch { }
                }
                s_family = FontFamily.GenericSansSerif.Name;
                return s_family;
            }
        }

        private static Font GetFont(float pixelSize, FontStyle style)
        {
            string key = ((int)Math.Round(pixelSize)) + "|" + (int)style;
            lock (s_gate)
            {
                Font f;
                if (s_fonts.TryGetValue(key, out f)) return f;
                f = new Font(Family(), pixelSize, style, GraphicsUnit.Pixel);
                s_fonts[key] = f;
                return f;
            }
        }

        public static Bitmap Render(ProviderView[] views, int width, int height, float scale, int cw, int ch, int step)
        {
            if (width < 1) width = 1;
            if (height < 1) height = 1;
            if (step < 4) step = 4;
            if (cw < 20) cw = 20;
            if (ch < 10) ch = 10;
            Bitmap bmp = new Bitmap(width, height, PixelFormat.Format32bppPArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                // 竖排堆叠：providers[0] 在最上；绘制从最下开始、最上最后画（上层盖住下层顶部 overlap 像素）
                for (int i = views.Length - 1; i >= 0; i--)
                {
                    DrawCapsule(g, views[i], 0f, i * step, cw, ch, scale);
                }
            }
            return bmp;
        }

        private static GraphicsPath RoundedRect(float x, float y, float w, float h, float r)
        {
            if (r < 0.1f) r = 0.1f;
            float d = r * 2f;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(x, y, d, d, 180f, 90f);
            path.AddArc(x + w - d, y, d, d, 270f, 90f);
            path.AddArc(x + w - d, y + h - d, d, d, 0f, 90f);
            path.AddArc(x, y + h - d, d, d, 90f, 90f);
            path.CloseFigure();
            return path;
        }

        private static void DrawCapsule(Graphics g, ProviderView v, float x0, float y0, float cw, float ch, float scale)
        {
            float rad = ch / 2f; // v2：200×30，圆角 15

            using (GraphicsPath path = RoundedRect(x0 + 0.5f, y0 + 0.5f, cw - 1f, ch - 1f, rad - 0.5f))
            {
                using (SolidBrush brush = new SolidBrush(FillColor)) g.FillPath(brush, path);
                using (Pen pen = new Pen(BorderColor, 1f)) g.DrawPath(pen, path);
            }

            // 顶边 1px 高光（只画上半圈）
            using (GraphicsPath path = RoundedRect(x0 + 1.5f, y0 + 1.5f, cw - 3f, ch - 3f, rad - 1.5f))
            {
                Region oldClip = g.Clip;
                g.SetClip(new RectangleF(x0, y0, cw, ch / 2f));
                using (Pen pen = new Pen(HighlightColor, 1f)) g.DrawPath(pen, path);
                g.Clip = oldClip;
                oldClip.Dispose();
            }

            // 状态点（v2：直径 8px）
            float dotR = 4f * scale;
            float cy = y0 + ch / 2f;
            Color dot;
            if (!v.HasResult) dot = DotGrey;
            else if (!v.Ok) dot = DotGrey;
            else if (v.Low) dot = DotRed;
            else dot = DotGreen;
            float dotCx = x0 + 15f * scale;
            using (SolidBrush brush = new SolidBrush(dot))
            {
                g.FillEllipse(brush, dotCx - dotR, cy - dotR, dotR * 2f, dotR * 2f);
            }

            float rightPad = 12f * scale;
            float nameX = x0 + 27f * scale;
            float nameRight;

            if (!v.HasResult)
            {
                Font font = GetFont(16f * scale, FontStyle.Bold);
                float wText = Measure(g, "—", font);
                nameRight = x0 + cw - rightPad - wText - 4f * scale;
                DrawRight(g, "—", font, DotGrey, x0 + cw - rightPad, y0, ch);
            }
            else if (!v.Ok)
            {
                Font font = GetFont(14f * scale, FontStyle.Regular);
                float wText = Measure(g, "连接失败", font);
                nameRight = x0 + cw - rightPad - wText - 4f * scale;
                DrawRight(g, "连接失败", font, FailColor, x0 + cw - rightPad, y0, ch);
            }
            else
            {
                Color amountColor = v.Low ? LowColor : AmountColor;
                Font numFont = GetFont(16f * scale, FontStyle.Bold);
                Font unitFont = GetFont(13f * scale, FontStyle.Regular);
                // 0.0.7：显示单位分支——CREDITS 不画 ¥/$，金额后接「 Credits」；USD 用 $；其余 ¥（旧口径）
                string unit = UnitFormat.Normalize(v.Currency, "");
                string symbol = UnitFormat.Symbol(unit);
                string suffix = UnitFormat.Suffix(unit);
                // 0.0.7：与 Mac 侧一致，金额取整（老板「把小数点后去掉」）
                string number = UnitFormat.Money(v.Amount).ToString(CultureInfo.InvariantCulture);
                float wSymbol = symbol.Length == 0 ? 0f : Measure(g, symbol, unitFont);
                float wNum = Measure(g, number, numFont);
                float wSuffix = suffix.Length == 0 ? 0f : Measure(g, suffix, unitFont);
                float total = wSymbol + wNum + wSuffix;
                float startX = x0 + cw - rightPad - total;
                float yShift = (MeasureHeight(g, number, numFont) - MeasureHeight(g, "0", unitFont)) * 0.5f;
                if (wSymbol > 0f) DrawAt(g, symbol, unitFont, amountColor, startX, y0 + yShift, ch);
                DrawAt(g, number, numFont, amountColor, startX + wSymbol, y0, ch);
                if (wSuffix > 0f) DrawAt(g, suffix, unitFont, amountColor, startX + wSymbol + wNum, y0 + yShift, ch);
                nameRight = startX - 4f * scale;
            }

            // 名称（v2：12px 灰），过长省略
            float nameWidth = nameRight - nameX;
            if (nameWidth < 8f * scale) nameWidth = 8f * scale;
            Font nameFont = GetFont(12f * scale, FontStyle.Regular);
            using (StringFormat fmt = new StringFormat())
            {
                fmt.Alignment = StringAlignment.Near;
                fmt.LineAlignment = StringAlignment.Center;
                fmt.Trimming = StringTrimming.EllipsisCharacter;
                fmt.FormatFlags = StringFormatFlags.NoWrap;
                using (SolidBrush brush = new SolidBrush(NameColor))
                {
                    g.DrawString(v.Name, nameFont, brush, new RectangleF(nameX, y0, nameWidth, ch), fmt);
                }
            }
        }

        private static float Measure(Graphics g, string text, Font font)
        {
            using (StringFormat fmt = StringFormat.GenericTypographic)
            {
                return g.MeasureString(text, font, 10000, fmt).Width;
            }
        }

        private static float MeasureHeight(Graphics g, string text, Font font)
        {
            using (StringFormat fmt = StringFormat.GenericTypographic)
            {
                return g.MeasureString(text, font, 10000, fmt).Height;
            }
        }

        private static void DrawRight(Graphics g, string text, Font font, Color color, float rightEdgeX, float y0, float ch)
        {
            float w = Measure(g, text, font);
            DrawAt(g, text, font, color, rightEdgeX - w, y0, ch);
        }

        private static void DrawAt(Graphics g, string text, Font font, Color color, float x, float y0, float ch)
        {
            using (StringFormat fmt = new StringFormat())
            {
                fmt.Alignment = StringAlignment.Near;
                fmt.LineAlignment = StringAlignment.Center;
                fmt.FormatFlags = StringFormatFlags.NoWrap;
                using (SolidBrush brush = new SolidBrush(color))
                {
                    g.DrawString(text, font, brush, new RectangleF(x, y0, 10000f, ch), fmt);
                }
            }
        }
    }

    // ------------------------------------------------------------------ 数据

    internal sealed class KeySource
    {
        public string Kind = "";
        public string File = "";
        public string Var = "";
    }

    internal sealed class ProviderConfig
    {
        public string Id = "";
        public string Name = "";
        public string Type = "";
        public string Preset = "";
        public string JsonPath = "";
        public string Currency = "CNY";
        /// <summary>0.0.7：显示单位 CNY / USD / CREDITS（大小写不敏感；缺省 qoder→CREDITS、openrouter→USD、其余 CNY）。</summary>
        public string Unit = "CNY";
        public string Endpoint = "";
        public string StatusEndpoint = "";
        public string A6User = "";
        public KeySource KeySource = new KeySource();
        public double? Threshold;
        public int IntervalSec = 60;
        public bool Enabled = true;
        /// <summary>v3：满盆金额（白饭桶的「一盆」）；饭量 = clamp(余额 / fullAmount, 0, 1)。</summary>
        public double FullAmount = 100;

        /// <summary>v3「大白饭」档：不联网、不查余额、永远满满一盆。</summary>
        public bool IsRice
        {
            get
            {
                string ty = (Type ?? "").Trim().ToLowerInvariant();
                string pr = (Preset ?? "").Trim().ToLowerInvariant();
                return ty == "rice" || pr == "rice";
            }
        }
    }

    internal sealed class PositionConfig
    {
        public string Mode = "under-feet";
        public int BottomGap = 8;
        public int OffsetX = 0;
        public int OffsetY = 0;
        public string ZOrder = "topmost";
        public int PetPort = 7797;
        public int ClampMargin = 8;
        /// <summary>v3：面板跟随桌宠所在显示器（工作区 / DPI）。</summary>
        public bool MonitorFollow = true;
    }

    internal sealed class HotkeyConfig
    {
        public bool Enabled = true;
        public string Combo = "Ctrl+Alt+Shift+R";
    }

    /// <summary>v2：胶囊尺寸与竖排上限（100% 设计值：200×30，step=24，最多 9 家）。</summary>
    internal sealed class CapsuleConfig
    {
        public int Width = 200;
        public int Height = 30;
        public int Overlap = 6;
        public int MaxProviders = 9;
    }

    /// <summary>v2：平滑跟随（检测间隔 ms + 60fps 指数缓动）。</summary>
    internal sealed class LiveFollowConfig
    {
        public int DetectMs = 250;
        public bool Smooth = true;
    }

    /// <summary>v2：把桌宠透明覆盖窗整体上移，给脚下胶囊腾地方。</summary>
    internal sealed class PetLiftConfig
    {
        public bool Enabled = true;
    }

    /// <summary>v3：显示形态（ricebowl 白饭桶 / capsule 旧胶囊回退）与盆外观。</summary>
    internal sealed class DisplayConfig
    {
        public string Style = "ricebowl";       // ricebowl | minicard（0.0.7 小面板）| capsule（回退）
        public string BowlStyle = "porcelain";  // porcelain 白瓷圈足碗（默认）| black 深色宽沿浅盆 | steel 不锈钢 | custom:<名字>（0.0.4：删除 enamel 搪瓷外观，旧值自动回退 porcelain）
        public string LabelStyle = "L3";        // L1 盆沿小字 | L2 饭票小旗 | L3 盆沿木牌（默认）
        public string Wear = "head";            // v4：head 头顶（默认）| feet 脚下（头顶强制无轮子）
        public string NineLayout = "pyramid";   // v4.1：pyramid 金字塔（默认，9 家底 4/中 3/顶 2）| row 一排 | twoRows 两排（前 5 后 4）
        public int CompactAfter = 5;            // 超过该家数进入紧凑模式
        public double RefYuan = 100;            // 全兜底满盆金额（provider 没填时用）
        public bool Wheels = false;             // 轮子彩蛋：盆底两枚小轮、移动时旋转
        public bool Logo = false;                // DeepSeek 家显示小虎鲸 logo（其它家用刻字名）
        public string LogoStyle = "deepseek";
        public double PetScaleRef = 1.05;       // 设计基准的 /api/state scale（本机 100% 时为 1.05）
        public double GraphicsMin = 0.95;       // graphicsScale 下限（保可读：金额≥9px/家名≥8px）
        public double GraphicsMax = 2.0;        // graphicsScale 上限
        public int SizePct = 100;                // 0.0.7：整体缩放百分比（40–200），与 Mac shared/config-core.js 同口径；经 ScaleMath 作用于全部形态
    }

    /// <summary>v3：主题联动（读 Coopanion 本地主题接口）。</summary>
    internal sealed class ThemeConfig
    {
        public bool Follow = true;
        public int Port = 17788;                 // /api/theme
        public int StatePort = 7797;             // /api/state（theme=dark/light）
        public string Force = "";                // "" 跟随 | dark | light（测试覆盖）
        public int PollMs = 3000;
    }

    /// <summary>v3：可选交互（点击展开明细）。</summary>
    internal sealed class InteractionConfig
    {
        public bool ExpandOnClick = true;
    }

    internal sealed class Config
    {
        public int Version = 1;
        public bool Enabled = true;
        public bool ClickThrough = true;
        public long RefreshSeq = 0;
        public HotkeyConfig Hotkey = new HotkeyConfig();
        public PositionConfig Position = new PositionConfig();
        public CapsuleConfig Capsule = new CapsuleConfig();
        public LiveFollowConfig LiveFollow = new LiveFollowConfig();
        public PetLiftConfig PetLift = new PetLiftConfig();
        public DisplayConfig Display = new DisplayConfig();
        public ThemeConfig Theme = new ThemeConfig();
        public InteractionConfig Interaction = new InteractionConfig();
        public List<ProviderConfig> Providers = new List<ProviderConfig>();

        public static Config BuildDefault()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            Config cfg = new Config();
            cfg.Providers.Add(new ProviderConfig
            {
                Id = "deepseek",
                Name = "DeepSeek",
                Type = "official",
                Preset = "deepseek",
                Endpoint = "https://api.deepseek.com/user/balance",
                KeySource = new KeySource
                {
                    Kind = "dotenv",
                    File = Path.Combine(home, ".dsh", ".env"),
                    Var = "DEEPSEEK_OFFICIAL_API_KEY"
                },
                Threshold = 5,
                IntervalSec = 60,
                Enabled = true
            });
            cfg.Providers.Add(new ProviderConfig
            {
                Id = "a6",
                Name = "A6",
                Type = "relay",
                Preset = "newapi",
                Endpoint = "https://a6api.vip/api/user/self",
                StatusEndpoint = "https://a6api.vip/api/status",
                A6User = "",
                KeySource = new KeySource
                {
                    Kind = "file",
                    File = Path.Combine(home, ".dsh", "secrets", "a6-console.txt"),
                    Var = "A6_CONSOLE_TOKEN"
                },
                Threshold = 5,
                IntervalSec = 60,
                Enabled = true
            });
            return cfg;
        }
    }

    internal static class ConfigStore
    {
        public static Config Load(string path)
        {
            string text = File.ReadAllText(path, Encoding.UTF8);
            Dictionary<string, object> root = Json.AsObject(Json.Parse(text));
            if (root == null) throw new FormatException("config root is not an object");
            Config cfg = new Config();
            double? version = Json.GetNumber(root, "version");
            if (version.HasValue) cfg.Version = (int)Math.Round(version.Value);
            cfg.Enabled = Json.GetBool(root, "enabled", true);
            cfg.ClickThrough = Json.GetBool(root, "clickThrough", true);
            double? seq = Json.GetNumber(root, "refreshSeq");
            if (seq.HasValue) cfg.RefreshSeq = (long)Math.Round(seq.Value);

            Dictionary<string, object> hk = Json.AsObject(Json.GetValue(root, "hotkey"));
            if (hk != null)
            {
                cfg.Hotkey.Enabled = Json.GetBool(hk, "enabled", true);
                cfg.Hotkey.Combo = Json.GetString(hk, "combo", "Ctrl+Alt+Shift+R");
            }

            Dictionary<string, object> pos = Json.AsObject(Json.GetValue(root, "position"));
            if (pos != null)
            {
                string mode = Json.GetString(pos, "mode", "under-feet");
                cfg.Position.Mode = mode == "under-feet" ? "under-feet" : "hug-taskbar";
                double? bottomGap = Json.GetNumber(pos, "bottomGap");
                if (bottomGap.HasValue) cfg.Position.BottomGap = Clamp((int)Math.Round(bottomGap.Value), 0, 64);
                double? ox = Json.GetNumber(pos, "offsetX");
                if (ox.HasValue) cfg.Position.OffsetX = Clamp((int)Math.Round(ox.Value), -3000, 3000);
                double? oy = Json.GetNumber(pos, "offsetY");
                if (oy.HasValue) cfg.Position.OffsetY = Clamp((int)Math.Round(oy.Value), -3000, 3000);
                string z = Json.GetString(pos, "zOrder", "topmost");
                cfg.Position.ZOrder = z == "topmost" ? "topmost" : "below-pet";
                double? port = Json.GetNumber(pos, "petPort");
                if (port.HasValue && port.Value >= 1 && port.Value <= 65535) cfg.Position.PetPort = (int)Math.Round(port.Value);
                double? margin = Json.GetNumber(pos, "clampMargin");
                if (margin.HasValue) cfg.Position.ClampMargin = Clamp((int)Math.Round(margin.Value), 0, 200);
                cfg.Position.MonitorFollow = Json.GetBool(pos, "monitorFollow", true);
            }

            // v2 新字段（向后兼容：老 config 没有这些段就用默认值）
            Dictionary<string, object> cap = Json.AsObject(Json.GetValue(root, "capsule"));
            if (cap != null)
            {
                double? w = Json.GetNumber(cap, "width");
                if (w.HasValue) cfg.Capsule.Width = Clamp((int)Math.Round(w.Value), 80, 400);
                double? h = Json.GetNumber(cap, "height");
                if (h.HasValue) cfg.Capsule.Height = Clamp((int)Math.Round(h.Value), 16, 80);
                double? ov = Json.GetNumber(cap, "overlap");
                if (ov.HasValue) cfg.Capsule.Overlap = Clamp((int)Math.Round(ov.Value), 0, Math.Max(0, cfg.Capsule.Height - 10));
                double? mp = Json.GetNumber(cap, "maxProviders");
                if (mp.HasValue) cfg.Capsule.MaxProviders = Clamp((int)Math.Round(mp.Value), 1, 12);
            }
            Dictionary<string, object> lf = Json.AsObject(Json.GetValue(root, "liveFollow"));
            if (lf != null)
            {
                double? dm = Json.GetNumber(lf, "detectMs");
                if (dm.HasValue) cfg.LiveFollow.DetectMs = Clamp((int)Math.Round(dm.Value), 100, 5000);
                cfg.LiveFollow.Smooth = Json.GetBool(lf, "smooth", true);
            }
            Dictionary<string, object> lift = Json.AsObject(Json.GetValue(root, "petLift"));
            if (lift != null) cfg.PetLift.Enabled = Json.GetBool(lift, "enabled", true);

            // v3 新字段（老 config 没有就用默认值）
            Dictionary<string, object> disp = Json.AsObject(Json.GetValue(root, "display"));
            if (disp != null)
            {
                string st = Json.GetString(disp, "style", "ricebowl");
                // 0.0.7：新增 minicard（小面板，一行一家）。三态白名单，非法值回退 ricebowl。
                string stLow = (st ?? "").Trim().ToLowerInvariant();
                if (stLow == "minicard") cfg.Display.Style = "minicard";
                else if (stLow == "capsule") cfg.Display.Style = "capsule";
                else cfg.Display.Style = "ricebowl";
                string bs = Json.GetString(disp, "bowlStyle", "porcelain");
                bs = (bs ?? "").Trim();
                string bsLow = bs.ToLowerInvariant();
                if (bsLow == "black" || bsLow == "porcelain" || bsLow == "steel") cfg.Display.BowlStyle = bsLow;
                else if (bsLow == "enamel") cfg.Display.BowlStyle = "porcelain";   // 0.0.4：搪瓷外观已删除，旧配置显式回退白瓷（不回退 black）
                else if (bsLow.StartsWith("custom:")) cfg.Display.BowlStyle = bs;
                else cfg.Display.BowlStyle = "porcelain";
                string ls = Json.GetString(disp, "labelStyle", "L1");
                ls = (ls ?? "").Trim().ToUpperInvariant();
                cfg.Display.LabelStyle = (ls == "L1" || ls == "L2") ? ls : "L3";
                // v4：饭桶位置（缺省/空/未知/大小写混写 → head；旧配置缺字段即头顶；显式 feet 保留）
                string wear = Json.GetString(disp, "wear", "head");
                wear = (wear ?? "").Trim().ToLowerInvariant();
                cfg.Display.Wear = wear == "feet" ? "feet" : "head";
                object logoRaw = Json.GetValue(disp, "logo");
                if (logoRaw is bool) cfg.Display.Logo = (bool)logoRaw;
                string logoStyleRaw = Json.GetString(disp, "logoStyle", "deepseek");
                cfg.Display.LogoStyle = (logoStyleRaw ?? "deepseek").Trim().ToLowerInvariant();
                double? psr = Json.GetNumber(disp, "petScaleRef");
                if (psr.HasValue) cfg.Display.PetScaleRef = ClampDouble(psr.Value, 0.4, 4.0);
                double? gmin = Json.GetNumber(disp, "graphicsMin");
                if (gmin.HasValue) cfg.Display.GraphicsMin = ClampDouble(gmin.Value, 0.3, 3.0);
                if (cfg.Display.GraphicsMin < 0.95) cfg.Display.GraphicsMin = 0.95;   // 可读下限
                // 0.0.7：整体缩放（饭桶 + 面板两种形态都生效，经 ScaleMath.GraphicsScale 乘 K）。clamp 40..200 + 四舍五入取整，与 Mac
                // shared/config-core.js 的 clampNum(...,40,200) + int() 逐条对齐；缺省 100。
                double? szp = Json.GetNumber(disp, "sizePct");
                if (szp.HasValue) cfg.Display.SizePct = (int)Math.Round(ClampDouble(szp.Value, 40, 200));
                double? gmax = Json.GetNumber(disp, "graphicsMax");
                if (gmax.HasValue) cfg.Display.GraphicsMax = ClampDouble(gmax.Value, 0.3, 4.0);
                // v4.1：排法（缺省/空/未知 → pyramid；旧默认 row9 → pyramid 迁移；显式 row / twoRows 保留）
                string nl = Json.GetString(disp, "nineLayout", "pyramid");
                nl = (nl ?? "").Trim().ToLowerInvariant();
                if (nl == "row") cfg.Display.NineLayout = "row";
                else if (nl == "tworows") cfg.Display.NineLayout = "twoRows";
                else cfg.Display.NineLayout = "pyramid";
                double? ca = Json.GetNumber(disp, "compactAfter");
                if (ca.HasValue) cfg.Display.CompactAfter = Clamp((int)Math.Round(ca.Value), 2, 9);
                double? ry = Json.GetNumber(disp, "refYuan");
                if (ry.HasValue) cfg.Display.RefYuan = ClampDouble(ry.Value, 0.01, 1000000);
                cfg.Display.Wheels = Json.GetBool(disp, "wheels", false);
            }
            Dictionary<string, object> thm = Json.AsObject(Json.GetValue(root, "theme"));
            if (thm != null)
            {
                cfg.Theme.Follow = Json.GetBool(thm, "follow", true);
                double? tp = Json.GetNumber(thm, "port");
                if (tp.HasValue && tp.Value >= 1 && tp.Value <= 65535) cfg.Theme.Port = (int)Math.Round(tp.Value);
                double? sp = Json.GetNumber(thm, "statePort");
                if (sp.HasValue && sp.Value >= 1 && sp.Value <= 65535) cfg.Theme.StatePort = (int)Math.Round(sp.Value);
                string force = (Json.GetString(thm, "force", "") ?? "").Trim().ToLowerInvariant();
                cfg.Theme.Force = (force == "dark" || force == "light") ? force : "";
                double? pm = Json.GetNumber(thm, "pollMs");
                if (pm.HasValue) cfg.Theme.PollMs = Clamp((int)Math.Round(pm.Value), 1000, 30000);
            }
            Dictionary<string, object> act = Json.AsObject(Json.GetValue(root, "interaction"));
            if (act != null) cfg.Interaction.ExpandOnClick = Json.GetBool(act, "expandOnClick", true);

            List<object> provs = Json.AsArray(Json.GetValue(root, "providers"));
            if (provs != null && provs.Count > 0)
            {
                cfg.Providers.Clear();
                for (int i = 0; i < provs.Count && cfg.Providers.Count < cfg.Capsule.MaxProviders; i++)
                {
                    Dictionary<string, object> p = Json.AsObject(provs[i]);
                    if (p == null) continue;
                    ProviderConfig pc = new ProviderConfig();
                    pc.Id = Json.GetString(p, "id", "p" + (i + 1));
                    pc.Name = Json.GetString(p, "name", pc.Id);
                    pc.Type = Json.GetString(p, "type", "deepseek");
                    pc.Preset = Json.GetString(p, "preset", "");
                    // 0.0.7：unit（大小写不敏感；旧配置没有该字段时按 preset 推导，原有 CNY/USD 行为不变）
                    string presetNorm = Net.NormalizePreset(pc);
                    pc.Unit = UnitFormat.Normalize(Json.GetString(p, "unit", ""), presetNorm);
                    // 0.0.7 Qoder 默认名与 Mac 端一致（仅用户没填 name 时）
                    if (presetNorm == "qoder" && string.IsNullOrEmpty(Json.GetString(p, "name", ""))) pc.Name = "Qoder";
                    pc.JsonPath = Json.GetString(p, "jsonPath", "");
                    pc.Currency = Json.GetString(p, "currency", "CNY");
                    pc.Endpoint = Json.GetString(p, "endpoint", "");
                    // 0.0.7 Qoder 的 endpoint 是 base（不是完整余额地址）：没填才落国内默认，用户填国际版就照用
                    if (presetNorm == "qoder" && pc.Endpoint.Trim().Length == 0) pc.Endpoint = Net.QoderDefaultEndpoint;
                    string statusEndpoint = Json.GetString(p, "statusEndpoint", "");
                    pc.StatusEndpoint = statusEndpoint;
                    string a6User = Json.GetString(p, "a6User", "");
                    pc.A6User = a6User;
                    Dictionary<string, object> ks = Json.AsObject(Json.GetValue(p, "keySource"));
                    if (ks != null)
                    {
                        pc.KeySource.Kind = Json.GetString(ks, "kind", "file");
                        pc.KeySource.File = Json.GetString(ks, "file", "");
                        pc.KeySource.Var = Json.GetString(ks, "var", "");
                    }
                    // 0.0.7 Qoder：没显式给 file/var 时补 Windows 预设（规格 §3；其余预设保持旧行为不变）
                    if (presetNorm == "qoder" && pc.KeySource.File.Trim().Length == 0 && pc.KeySource.Var.Trim().Length == 0)
                    {
                        pc.KeySource.Kind = "file";
                        pc.KeySource.File = "%USERPROFILE%\\.dsh\\secrets\\qoder-pat.txt";
                        pc.KeySource.Var = "QODER_PAT";
                    }
                    object threshold = Json.GetValue(p, "threshold");
                    pc.Threshold = Json.ToDoubleOrNull(threshold);
                    double? interval = Json.GetNumber(p, "intervalSec");
                    if (interval.HasValue) pc.IntervalSec = Clamp((int)Math.Round(interval.Value), 10, 3600);
                    pc.Enabled = Json.GetBool(p, "enabled", true);
                    double? fullAmt = Json.GetNumber(p, "fullAmount");
                    // 0.0.7 Qoder 的余额单位是 Credits（Pro 套餐每月 2000），沿用 refYuan=100 会让米饭永远满盆
                    if (fullAmt.HasValue) pc.FullAmount = ClampDouble(fullAmt.Value, 0.01, 1000000);
                    else pc.FullAmount = presetNorm == "qoder" ? 2000 : cfg.Display.RefYuan;
                    if (string.IsNullOrEmpty(pc.Id)) pc.Id = "p" + (i + 1);
                    cfg.Providers.Add(pc);
                }
            }
            if (cfg.Providers.Count == 0) cfg.Providers = Config.BuildDefault().Providers;
            return cfg;
        }

        private static int Clamp(int v, int min, int max)
        {
            if (v < min) return min;
            if (v > max) return max;
            return v;
        }

        private static double ClampDouble(double v, double min, double max)
        {
            if (double.IsNaN(v)) return min;
            if (v < min) return min;
            if (v > max) return max;
            return v;
        }

        public static void WriteDefault(string path)
        {
            Config cfg = Config.BuildDefault();
            StringBuilder sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"version\": ").Append(cfg.Version).Append(",\n");
            sb.Append("  \"enabled\": true,\n");
            sb.Append("  \"clickThrough\": true,\n");
            sb.Append("  \"refreshSeq\": 1,\n");
            sb.Append("  \"hotkey\": { \"enabled\": true, \"combo\": \"Ctrl+Alt+Shift+R\" },\n");
            sb.Append("  \"position\": {\n");
            sb.Append("    \"mode\": \"under-feet\",\n");
            sb.Append("    \"bottomGap\": 8,\n");
            sb.Append("    \"offsetX\": 0,\n");
            sb.Append("    \"offsetY\": 0,\n");
            sb.Append("    \"zOrder\": \"topmost\",\n");
            sb.Append("    \"petPort\": 7797,\n");
            sb.Append("    \"clampMargin\": 8,\n");
            sb.Append("    \"monitorFollow\": true\n");
            sb.Append("  },\n");
            sb.Append("  \"display\": { \"style\": \"ricebowl\", \"bowlStyle\": \"porcelain\", \"labelStyle\": \"L3\", \"wear\": \"head\", \"nineLayout\": \"pyramid\", \"compactAfter\": 5, \"refYuan\": 100, \"wheels\": false, \"petScaleRef\": 1.05, \"graphicsMin\": 0.95, \"graphicsMax\": 2.0 },\n");
            sb.Append("  \"theme\": { \"follow\": true, \"port\": 17788, \"statePort\": 7797, \"force\": \"\", \"pollMs\": 3000 },\n");
            sb.Append("  \"interaction\": { \"expandOnClick\": true },\n");
            sb.Append("  \"capsule\": { \"width\": 200, \"height\": 30, \"overlap\": 6, \"maxProviders\": 9 },\n");
            sb.Append("  \"liveFollow\": { \"detectMs\": 250, \"smooth\": true },\n");
            sb.Append("  \"petLift\": { \"enabled\": true },\n");
            sb.Append("  \"providers\": [\n");
            for (int i = 0; i < cfg.Providers.Count; i++)
            {
                ProviderConfig p = cfg.Providers[i];
                sb.Append("    {\n");
                sb.Append("      \"id\": ").Append(Json.Quote(p.Id)).Append(",\n");
                sb.Append("      \"name\": ").Append(Json.Quote(p.Name)).Append(",\n");
                sb.Append("      \"type\": ").Append(Json.Quote(p.Type)).Append(",\n");
                if (!string.IsNullOrEmpty(p.Preset)) sb.Append("      \"preset\": ").Append(Json.Quote(p.Preset)).Append(",\n");
                if (!string.IsNullOrEmpty(p.JsonPath)) sb.Append("      \"jsonPath\": ").Append(Json.Quote(p.JsonPath)).Append(",\n");
                if (!string.IsNullOrEmpty(p.Currency) && p.Currency != "CNY") sb.Append("      \"currency\": ").Append(Json.Quote(p.Currency)).Append(",\n");
                // 0.0.7：unit 只写非默认值（旧键顺序保持：currency 之后、endpoint 之前）
                if (!string.IsNullOrEmpty(p.Unit) && !string.Equals(p.Unit, "CNY", StringComparison.OrdinalIgnoreCase))
                    sb.Append("      \"unit\": ").Append(Json.Quote(p.Unit)).Append(",\n");
                sb.Append("      \"endpoint\": ").Append(Json.Quote(p.Endpoint)).Append(",\n");
                if (!string.IsNullOrEmpty(p.StatusEndpoint))
                {
                    sb.Append("      \"statusEndpoint\": ").Append(Json.Quote(p.StatusEndpoint)).Append(",\n");
                }
                if (!string.IsNullOrEmpty(p.A6User))
                {
                    sb.Append("      \"a6User\": ").Append(Json.Quote(p.A6User)).Append(",\n");
                }
                sb.Append("      \"keySource\": { \"kind\": ").Append(Json.Quote(p.KeySource.Kind));
                sb.Append(", \"file\": ").Append(Json.Quote(p.KeySource.File));
                if (!string.IsNullOrEmpty(p.KeySource.Var)) sb.Append(", \"var\": ").Append(Json.Quote(p.KeySource.Var));
                sb.Append(" },\n");
                sb.Append("      \"threshold\": ");
                sb.Append(p.Threshold.HasValue ? p.Threshold.Value.ToString("0.##", CultureInfo.InvariantCulture) : "null");
                sb.Append(",\n");
                sb.Append("      \"fullAmount\": ").Append(p.FullAmount.ToString("0.##", CultureInfo.InvariantCulture)).Append(",\n");
                sb.Append("      \"intervalSec\": ").Append(p.IntervalSec).Append(",\n");
                sb.Append("      \"enabled\": true\n");
                sb.Append("    }");
                sb.Append(i + 1 < cfg.Providers.Count ? ",\n" : "\n");
            }
            sb.Append("  ]\n");
            sb.Append("}\n");
            WriteAtomic(path, sb.ToString());
        }

        public static void WriteAtomic(string path, string text)
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
            string tmp = path + ".tmp-" + Process.GetCurrentProcess().Id + "-" + Environment.TickCount;
            File.WriteAllText(tmp, text, new UTF8Encoding(false));
            if (File.Exists(path))
            {
                try { File.Replace(tmp, path, null); }
                catch
                {
                    File.Delete(path);
                    File.Move(tmp, path);
                }
            }
            else
            {
                File.Move(tmp, path);
            }
        }
    }

    internal static class KeyLoader
    {
        private static readonly string[] CommonKeys = new string[]
        {
            "A6_CONSOLE_TOKEN", "A6_CONSOLE_API_KEY", "A6API_KEY", "A6_PROXY_KEY", "A6_KEY", "TOKEN", "API_KEY"
        };

        public static string Load(KeySource ks)
        {
            if (ks == null) return "";
            string raw = "";
            if (!string.IsNullOrEmpty(ks.File))
            {
                string path = Environment.ExpandEnvironmentVariables(ks.File);
                try { raw = File.ReadAllText(path, Encoding.UTF8); }
                catch { return ""; }
            }
            else if (!string.IsNullOrEmpty(ks.Var))
            {
                raw = Environment.GetEnvironmentVariable(ks.Var) ?? "";
                return Clean(raw);
            }
            if (string.IsNullOrEmpty(raw)) return "";
            Dictionary<string, string> vars = ParseEnv(raw);
            string value;
            if (!string.IsNullOrEmpty(ks.Var) && vars.TryGetValue(ks.Var, out value)) return Clean(value);
            for (int i = 0; i < CommonKeys.Length; i++)
            {
                if (vars.TryGetValue(CommonKeys[i], out value)) return Clean(value);
            }
            // 单行文件：整份内容就是 token
            string[] lines = raw.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> meaningful = new List<string>();
            for (int i = 0; i < lines.Length; i++)
            {
                string t = lines[i].Trim();
                if (t.Length == 0 || t.StartsWith("#")) continue;
                meaningful.Add(t);
            }
            if (meaningful.Count == 1 && meaningful[0].IndexOf('=') < 0) return Clean(meaningful[0]);
            return "";
        }

        /// <summary>从凭据文件里按变量名取值（只做解析，不打印）。</summary>
        public static string LoadNamed(KeySource ks, string name)
        {
            if (ks == null || string.IsNullOrEmpty(name)) return "";
            string raw = "";
            if (!string.IsNullOrEmpty(ks.File))
            {
                string path = Environment.ExpandEnvironmentVariables(ks.File);
                try { raw = File.ReadAllText(path, Encoding.UTF8); }
                catch { return ""; }
            }
            if (string.IsNullOrEmpty(raw)) return "";
            Dictionary<string, string> vars = ParseEnv(raw);
            string value;
            if (vars.TryGetValue(name, out value)) return Clean(value);
            return "";
        }

        private static Dictionary<string, string> ParseEnv(string text)
        {
            Dictionary<string, string> d = new Dictionary<string, string>();
            string[] lines = text.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < lines.Length; i++)
            {
                string t = lines[i].Trim();
                if (t.Length == 0 || t.StartsWith("#")) continue;
                int eq = t.IndexOf('=');
                if (eq <= 0) continue;
                string key = t.Substring(0, eq).Trim();
                string value = t.Substring(eq + 1).Trim();
                d[key] = value;
            }
            return d;
        }

        private static string Clean(string s)
        {
            if (s == null) return "";
            s = s.Trim();
            if (s.Length >= 2 && ((s[0] == '"' && s[s.Length - 1] == '"') || (s[0] == '\'' && s[s.Length - 1] == '\'')))
            {
                s = s.Substring(1, s.Length - 2).Trim();
            }
            return s;
        }
    }

    internal sealed class PetState
    {
        public bool Ok;
        public double? StartX;
        public double? StartY;
        public double Scale = 1;
        public string Error = "";
        /// <summary>v3：/api/state 的 theme（dark / light）。</summary>
        public string Theme = "";
        public string SkinPalette = "";
    }

    internal sealed class BalanceResult
    {
        public bool Ok;
        public double Amount;
        public string Currency = "CNY";
        public string Error = "";
        public int LatencyMs;

        public static BalanceResult Fail(string message)
        {
            BalanceResult r = new BalanceResult();
            r.Ok = false;
            r.Error = string.IsNullOrEmpty(message) ? "unknown" : message;
            return r;
        }
    }

    /// <summary>
    /// 0.0.7 显示单位（规格 output/qoder-provider-spec.md §3）：CNY / USD / CREDITS。
    /// CREDITS 不带 ¥/$，金额后接「 Credits」（如 2177.00 Credits）；USD 用 $；其余一律 ¥（保持旧口径）。
    /// </summary>
    internal static class UnitFormat
    {
        public const string Cny = "CNY";
        public const string Usd = "USD";
        public const string Credits = "CREDITS";

        /// <summary>单位归一化：大小写不敏感；缺省按 preset 推导（qoder→CREDITS，openrouter→USD，其余 CNY）。</summary>
        public static string Normalize(string raw, string preset)
        {
            string s = (raw ?? "").Trim().ToUpperInvariant();
            if (s == Cny || s == Usd || s == Credits) return s;
            string p = (preset ?? "").Trim().ToLowerInvariant();
            if (p == "qoder") return Credits;
            if (p == "openrouter") return Usd;
            return Cny;
        }

        /// <summary>
        /// 金额前缀符号：CNY→¥、USD→$、CREDITS→"C "（大写 C + 一个空格）。
        /// 0.0.7 老板令：Credits 和 ¥/$ 一样把符号放金额前面，不写 "Credits" 字样、不带小数；
        /// 与 Mac renderer.js 的 CREDITS_SYMBOL 逐字一致（双端口径必须相同）。
        /// </summary>
        public static string Symbol(string unit)
        {
            string u = (unit ?? "").Trim().ToUpperInvariant();
            if (u == Usd) return "$";
            if (u == Credits) return "C ";
            return "¥";
        }

        /// <summary>金额后缀：仅 CREDITS 有（「 Credits」）。</summary>
        /// <summary>
        /// 金额后缀：0.0.7 起一律为空 —— CREDITS 的单位已由前缀 "C " 表达，
        /// 不再输出 " Credits"（与 Mac 侧只画符号、不写英文单位的口径一致）。
        /// </summary>
        public static string Suffix(string unit)
        {
            return "";
        }

        /// <summary>
        /// 0.0.7：金额取整（老板 2026-11-13「把小数点后去掉」）。
        /// 口径与 Mac 侧 renderer.js 的 moneyText() 逐条对齐：四舍五入、负数远离零、-0 归一为 0。
        /// </summary>
        public static long Money(double amount)
        {
            if (double.IsNaN(amount) || double.IsInfinity(amount)) return 0L;
            double r = amount < 0 ? -Math.Round(-amount, MidpointRounding.AwayFromZero)
                                  : Math.Round(amount, MidpointRounding.AwayFromZero);
            if (r == 0) r = 0;   // 归一 -0
            if (r > long.MaxValue) return long.MaxValue;
            if (r < long.MinValue) return long.MinValue;
            return (long)r;
        }

        /// <summary>单行金额文案：¥12 / $12 / C 2177（0.0.7：带符号前缀、去小数、CREDITS 不写英文单位）。</summary>
        public static string Format(string unit, double amount)
        {
            return Symbol(unit) + Money(amount).ToString(CultureInfo.InvariantCulture) + Suffix(unit);
        }

        /// <summary>明细卡阈值文案：¥5 / $5 / 5 Credits（CREDITS 不写 ¥；保留旧口径的 0.##）。</summary>
        public static string ThresholdText(string unit, double value)
        {
            string text = value.ToString("0.##", CultureInfo.InvariantCulture);
            string u = (unit ?? "").Trim().ToUpperInvariant();
            if (u == Credits) return text + " Credits";
            return (u == Usd ? "$" : "¥") + text;
        }
    }

    internal sealed class ApiException : Exception
    {
        public readonly string SafeMessage;
        /// <summary>0.0.7：HTTP 状态码（0 = 没有拿到 HTTP 响应，如网络/超时）。</summary>
        public readonly int Status;
        /// <summary>0.0.7：WebException.Status（网络/超时/TLS 分类用；HTTP 错误一般是 ProtocolError）。</summary>
        public readonly WebExceptionStatus WebStatus;

        public ApiException(string message) : this(message, 0, WebExceptionStatus.Success)
        {
        }

        public ApiException(string message, int status) : this(message, status, WebExceptionStatus.Success)
        {
        }

        public ApiException(string message, int status, WebExceptionStatus webStatus) : base(message)
        {
            SafeMessage = message;
            Status = status;
            WebStatus = webStatus;
        }
    }

    internal static class Net
    {
        private static readonly object s_gate = new object();
        private static readonly Stopwatch s_clock = Stopwatch.StartNew();
        private static double s_quotaPerUnit;
        private static double s_fx;
        private static long s_statusAtMs = -1000000000;

        // ---- 0.0.7 Qoder（规格 output/qoder-provider-spec.md）：PAT → jt- → usage 两段式 ----
        // endpoint 是 base（默认国内，可改国际版 openapi.qoder.sh）；密钥/令牌只进内存，缓存键是 base+PAT 的 SHA-256。
        internal const string QoderDefaultEndpoint = "https://openapi.qoder.com.cn";
        private const string QoderExchangePath = "/api/v1/jobToken/exchange";
        private const string QoderUsagePath = "/sash/api/v2/me/usage";
        private const int QoderTokenTtlMs = 20 * 60 * 1000; // jt- 进程内缓存 20 分钟（上游约 24h 有效）
        private static readonly object s_qoderGate = new object();
        private static readonly Dictionary<string, QoderToken> s_qoderTokens = new Dictionary<string, QoderToken>();

        /// <summary>jt- 缓存条目：只存令牌与时间戳，不存 PAT。</summary>
        private sealed class QoderToken
        {
            public string Token = "";
            public long AtMs;
        }

        public static PetState QueryPetState(int port)
        {
            PetState st = new PetState();
            try
            {
                string url = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/api/state";
                string body = HttpGet(url, null, 1500, null);
                Dictionary<string, object> d = Json.AsObject(Json.Parse(body));
                if (d == null) { st.Error = "state: not an object"; return st; }
                st.StartX = Json.ToDoubleOrNull(Json.GetValue(d, "startX"));
                st.StartY = Json.ToDoubleOrNull(Json.GetValue(d, "startY"));
                double? scale = Json.ToDoubleOrNull(Json.GetValue(d, "scale"));
                if (scale.HasValue && scale.Value > 0) st.Scale = scale.Value;
                string theme = Json.GetString(d, "theme", "");
                if (!string.IsNullOrEmpty(theme)) st.Theme = theme.Trim().ToLowerInvariant();
                Dictionary<string, object> skin = Json.AsObject(Json.GetValue(d, "skin"));
                if (skin != null) st.SkinPalette = Json.GetString(skin, "palette", "");
                st.Ok = true;
                return st;
            }
            catch (Exception ex)
            {
                st.Error = Program.SafeText(ex.Message);
                return st;
            }
        }

        public static BalanceResult Query(ProviderConfig pc)
        {
            if (pc == null) return BalanceResult.Fail("provider missing");
            switch (NormalizePreset(pc))
            {
                case "deepseek": return QueryDeepSeek(pc);
                case "kimi":
                case "siliconflow":
                case "stepfun":
                case "openrouter": return QueryOfficialPreset(pc, NormalizePreset(pc));
                case "qoder": return QueryQoder(pc);
                case "newapi": return QueryA6(pc);
                case "custom": return QueryCustom(pc);
                default: return BalanceResult.Fail("unsupported preset: " + (pc.Preset ?? "") + "/" + (pc.Type ?? ""));
            }
        }

        /// <summary>preset 归一化：config 兼容旧 type=deepseek / a6_newapi；official/relay/custom 映射到具体解析器。</summary>
        public static string NormalizePreset(ProviderConfig pc)
        {
            string preset = (pc.Preset ?? "").Trim().ToLowerInvariant();
            if (preset.Length > 0)
            {
                if (preset == "a6" || preset == "a6_newapi" || preset == "new-api") return "newapi";
                if (preset == "qoder") return "qoder";
                return preset;
            }
            string type = (pc.Type ?? "").Trim().ToLowerInvariant();
            if (type == "deepseek") return "deepseek";
            if (type == "a6_newapi" || type == "newapi" || type == "new-api" || type == "a6") return "newapi";
            if (type == "official") return "deepseek";
            if (type == "relay") return "newapi";
            return "custom";
        }

        /// <summary>没填 endpoint 时按 preset 用官方接口默认地址。</summary>
        private static string PresetEndpoint(ProviderConfig pc)
        {
            string endpoint = (pc.Endpoint ?? "").Trim();
            if (endpoint.Length > 0) return endpoint;
            switch (NormalizePreset(pc))
            {
                case "deepseek": return "https://api.deepseek.com/user/balance";
                case "kimi": return "https://api.moonshot.cn/v1/users/me/balance";
                case "siliconflow": return "https://api.siliconflow.cn/v1/user/info";
                case "stepfun": return "https://api.stepfun.com/v1/accounts";
                case "openrouter": return "https://openrouter.ai/api/v1/credits";
                case "qoder": return QoderDefaultEndpoint;
                case "newapi": return "https://a6api.vip/api/user/self";
                default: return endpoint;
            }
        }

        /// <summary>new-api 系：余额接口地址 → 状态接口（{base}/api/status）。</summary>
        private static string DeriveStatusUrl(string balanceUrl)
        {
            try
            {
                Uri u = new Uri(balanceUrl);
                return u.Scheme + "://" + u.Authority + "/api/status";
            }
            catch { return ""; }
        }

        /// <summary>官方厂商预设（Bearer + 固定 JSON 字段）：kimi / siliconflow / stepfun / openrouter。</summary>
        private static BalanceResult QueryOfficialPreset(ProviderConfig pc, string preset)
        {
            string key = KeyLoader.Load(pc.KeySource);
            if (string.IsNullOrEmpty(key)) return BalanceResult.Fail(preset + ": key not found");
            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers["Authorization"] = "Bearer " + key;
            headers["Accept"] = "application/json";
            string body;
            try { body = HttpGet(PresetEndpoint(pc), headers, 12000, key); }
            catch (ApiException ex) { return BalanceResult.Fail(ex.SafeMessage); }
            Dictionary<string, object> root = Json.AsObject(Json.Parse(body));
            if (root == null) return BalanceResult.Fail(preset + ": bad response");
            double? amount = null;
            string currency = "CNY";
            switch (preset)
            {
                case "kimi":
                    amount = Json.ToDoubleOrNull(Json.GetValue(Json.AsObject(Json.GetValue(root, "data")), "available_balance"));
                    break;
                case "siliconflow":
                    amount = Json.ToDoubleOrNull(Json.GetValue(Json.AsObject(Json.GetValue(root, "data")), "totalBalance"));
                    break;
                case "stepfun":
                    amount = Json.ToDoubleOrNull(Json.GetValue(root, "balance"));
                    break;
                case "openrouter":
                {
                    Dictionary<string, object> data = Json.AsObject(Json.GetValue(root, "data"));
                    double? credits = Json.ToDoubleOrNull(Json.GetValue(data, "total_credits"));
                    double? usage = Json.ToDoubleOrNull(Json.GetValue(data, "total_usage"));
                    if (credits.HasValue && usage.HasValue) amount = credits.Value - usage.Value;
                    currency = "USD";
                    break;
                }
            }
            if (!amount.HasValue) return BalanceResult.Fail(preset + ": balance field missing");
            BalanceResult r = new BalanceResult();
            r.Ok = true;
            r.Amount = Math.Round(amount.Value, 2);
            r.Currency = currency;
            return r;
        }

        /// <summary>custom：接口地址 + Bearer + JSON 取值路径（如 data.totalBalance）+ 币种。</summary>
        private static BalanceResult QueryCustom(ProviderConfig pc)
        {
            string key = KeyLoader.Load(pc.KeySource);
            if (string.IsNullOrEmpty(key)) return BalanceResult.Fail("custom: key not found");
            string path = (pc.JsonPath ?? "").Trim();
            if (path.Length == 0) return BalanceResult.Fail("custom: jsonPath not configured");
            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers["Authorization"] = "Bearer " + key;
            headers["Accept"] = "application/json";
            string body;
            try { body = HttpGet(PresetEndpoint(pc), headers, 12000, key); }
            catch (ApiException ex) { return BalanceResult.Fail(ex.SafeMessage); }
            object value = GetJsonPath(Json.Parse(body), path);
            double? amount = Json.ToDoubleOrNull(value);
            if (!amount.HasValue) return BalanceResult.Fail("custom: " + path + " not a number");
            BalanceResult r = new BalanceResult();
            r.Ok = true;
            r.Amount = Math.Round(amount.Value, 2);
            r.Currency = string.Equals((pc.Currency ?? "CNY").Trim(), "USD", StringComparison.OrdinalIgnoreCase) ? "USD" : "CNY";
            return r;
        }

        private static object GetJsonPath(object root, string path)
        {
            object cur = root;
            string[] parts = path.Split('.');
            for (int i = 0; i < parts.Length; i++)
            {
                Dictionary<string, object> d = Json.AsObject(cur);
                if (d == null) return null;
                cur = Json.GetValue(d, parts[i].Trim());
                if (cur == null) return null;
            }
            return cur;
        }

        private static BalanceResult QueryDeepSeek(ProviderConfig pc)
        {
            string key = KeyLoader.Load(pc.KeySource);
            if (string.IsNullOrEmpty(key)) return BalanceResult.Fail("key not found");
            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers["Authorization"] = "Bearer " + key;
            headers["Accept"] = "application/json";
            string body;
            try { body = HttpGet(PresetEndpoint(pc), headers, 12000, key); }
            catch (ApiException ex) { return BalanceResult.Fail(ex.SafeMessage); }
            Dictionary<string, object> root = Json.AsObject(Json.Parse(body));
            if (root == null) return BalanceResult.Fail("deepseek: bad response");
            List<object> infos = Json.AsArray(Json.GetValue(root, "balance_infos"));
            if (infos == null || infos.Count == 0) return BalanceResult.Fail("deepseek: no balance_infos");
            Dictionary<string, object> cny = null;
            for (int i = 0; i < infos.Count; i++)
            {
                Dictionary<string, object> item = Json.AsObject(infos[i]);
                if (item == null) continue;
                if (Json.GetString(item, "currency", "") == "CNY") { cny = item; break; }
            }
            if (cny == null) cny = Json.AsObject(infos[0]);
            if (cny == null) return BalanceResult.Fail("deepseek: no CNY entry");
            double? total = Json.ToDoubleOrNull(Json.GetValue(cny, "total_balance"));
            if (!total.HasValue) return BalanceResult.Fail("deepseek: total_balance missing");
            BalanceResult r = new BalanceResult();
            r.Ok = true;
            r.Amount = Math.Round(total.Value, 2);
            r.Currency = "CNY";
            return r;
        }

        private static BalanceResult QueryA6(ProviderConfig pc)
        {
            string token = KeyLoader.Load(pc.KeySource);
            if (string.IsNullOrEmpty(token)) return BalanceResult.Fail("newapi: token not found");
            string balanceUrl = PresetEndpoint(pc);
            string statusUrl = (pc.StatusEndpoint ?? "").Trim();
            if (statusUrl.Length == 0) statusUrl = DeriveStatusUrl(balanceUrl);
            if (statusUrl.Length == 0) return BalanceResult.Fail("newapi: status endpoint unknown");
            double qpu, fx;
            if (!GetA6Rates(statusUrl, out qpu, out fx)) return BalanceResult.Fail("newapi: status rates unavailable");
            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers["Authorization"] = "Bearer " + token;
            string a6User = ResolveA6User(pc);
            if (string.IsNullOrEmpty(a6User)) return BalanceResult.Fail("newapi: a6User not configured");
            headers["New-Api-User"] = a6User;
            headers["Accept"] = "application/json";
            string body;
            try { body = HttpGet(balanceUrl, headers, 12000, token); }
            catch (ApiException ex) { return BalanceResult.Fail(ex.SafeMessage); }
            Dictionary<string, object> root = Json.AsObject(Json.Parse(body));
            Dictionary<string, object> data = Json.AsObject(Json.GetValue(root, "data"));
            double? quota = Json.ToDoubleOrNull(Json.GetValue(data, "quota"));
            if (!quota.HasValue) return BalanceResult.Fail("newapi: quota missing");
            BalanceResult r = new BalanceResult();
            r.Ok = true;
            r.Amount = Math.Round(quota.Value / qpu * fx, 2);
            r.Currency = "CNY";
            return r;
        }

        /// <summary>解析 new-api 的 New-Api-User：优先配置；未填时从同一凭据文件的 A6_ACCOUNT_ID 读取（不写死账号）。</summary>
        private static string ResolveA6User(ProviderConfig pc)
        {
            if (!string.IsNullOrEmpty(pc.A6User)) return pc.A6User.Trim();
            string fromFile = KeyLoader.LoadNamed(pc.KeySource, "A6_ACCOUNT_ID");
            if (!string.IsNullOrEmpty(fromFile)) return fromFile;
            string fromEnv = Environment.GetEnvironmentVariable("A6_ACCOUNT_ID");
            if (!string.IsNullOrEmpty(fromEnv)) return fromEnv.Trim();
            return "";
        }

        private static bool GetA6Rates(string statusUrl, out double qpu, out double fx)
        {
            long now = s_clock.ElapsedMilliseconds;
            lock (s_gate)
            {
                if (s_quotaPerUnit > 0 && s_fx > 0 && now - s_statusAtMs < 600000)
                {
                    qpu = s_quotaPerUnit;
                    fx = s_fx;
                    return true;
                }
            }
            try
            {
                string body = HttpGet(statusUrl, null, 8000, null);
                Dictionary<string, object> root = Json.AsObject(Json.Parse(body));
                Dictionary<string, object> data = Json.AsObject(Json.GetValue(root, "data"));
                double? q = Json.ToDoubleOrNull(Json.GetValue(data, "quota_per_unit"));
                double? f = Json.ToDoubleOrNull(Json.GetValue(data, "payment_fx_rate_cny_per_usd"));
                if (q.HasValue && f.HasValue && q.Value > 0 && f.Value > 0)
                {
                    lock (s_gate)
                    {
                        s_quotaPerUnit = q.Value;
                        s_fx = f.Value;
                        s_statusAtMs = s_clock.ElapsedMilliseconds;
                    }
                    qpu = q.Value;
                    fx = f.Value;
                    return true;
                }
            }
            catch { }
            lock (s_gate)
            {
                if (s_quotaPerUnit > 0 && s_fx > 0)
                {
                    qpu = s_quotaPerUnit;
                    fx = s_fx;
                    return true;
                }
            }
            qpu = 0;
            fx = 0;
            return false;
        }

        // ---------------------------------------------------------- 0.0.7 Qoder 两段式查询（PAT → jt- → usage）
        /// <summary>Qoder base 地址：config.endpoint 是 base（可填国际版），空则国内默认；去掉尾部斜杠。</summary>
        private static string QoderBase(ProviderConfig pc)
        {
            string raw = pc == null ? "" : (pc.Endpoint ?? "").Trim();
            if (raw.Length == 0) raw = QoderDefaultEndpoint;
            return raw.TrimEnd('/');
        }

        /// <summary>缓存键 = SHA-256(base + "\n" + PAT)：字典里只留哈希，不存明文 PAT。</summary>
        private static string QoderCacheKey(string baseUrl, string pat)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(baseUrl + "\n" + pat));
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++) sb.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        private static string QoderCachedToken(string key)
        {
            lock (s_qoderGate)
            {
                QoderToken hit;
                if (!s_qoderTokens.TryGetValue(key, out hit) || hit == null || string.IsNullOrEmpty(hit.Token)) return "";
                if (s_clock.ElapsedMilliseconds - hit.AtMs >= QoderTokenTtlMs)
                {
                    s_qoderTokens.Remove(key);
                    return "";
                }
                return hit.Token;
            }
        }

        private static void QoderRememberToken(string key, string token)
        {
            long now = s_clock.ElapsedMilliseconds;
            lock (s_qoderGate)
            {
                // 条目很少（每家 provider 一条），顺手清掉过期项，避免长期运行堆积
                if (s_qoderTokens.Count > 8)
                {
                    List<string> dead = new List<string>();
                    foreach (KeyValuePair<string, QoderToken> kv in s_qoderTokens)
                    {
                        if (now - kv.Value.AtMs >= QoderTokenTtlMs) dead.Add(kv.Key);
                    }
                    for (int i = 0; i < dead.Count; i++) s_qoderTokens.Remove(dead[i]);
                }
                QoderToken entry = new QoderToken();
                entry.Token = token;
                entry.AtMs = now;
                s_qoderTokens[key] = entry;
            }
        }

        private static void QoderForgetToken(string key)
        {
            lock (s_qoderGate) { s_qoderTokens.Remove(key); }
        }

        /// <summary>失败文案：分类码 + 阶段（+ HTTP 状态）；绝不含响应体 / PAT / jt-。</summary>
        private static string QoderError(string code, string stage, int status)
        {
            string detail = stage ?? "qoder";
            if (status > 0) detail += " HTTP " + status.ToString(CultureInfo.InvariantCulture);
            return code + " (" + detail + ")";
        }

        /// <summary>HTTP 状态 / 网络异常 → 分类码（沿用 Mac 侧 ERROR_CODES 口径，只用于日志与错误文案）。</summary>
        private static string QoderCodeForStatus(int status, WebExceptionStatus webStatus)
        {
            if (status == 401 || status == 403) return "KEY_INVALID";
            if (status == 404) return "ENDPOINT_NOT_FOUND";
            if (status == 429) return "RATE_LIMITED";
            if (status >= 500) return "SERVER_ERROR";
            if (status > 0) return "UNKNOWN";
            if (webStatus == WebExceptionStatus.Timeout) return "TIMEOUT";
            if (webStatus == WebExceptionStatus.TrustFailure) return "TLS_ERROR";
            return "NETWORK";
        }

        /// <summary>
        /// PAT → jt-：POST {base}/api/v1/jobToken/exchange，body {"personal_token":"pt-…"}；
        /// 响应取 token / job_token / jobToken 任一。交换 400/401/403 一律归 KEY_INVALID（规格 §4）。
        /// </summary>
        private static string ExchangeQoderJobToken(string baseUrl, string pat)
        {
            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers["Content-Type"] = "application/json";
            headers["Accept"] = "application/json";
            string body = "{\"personal_token\":" + Json.Quote(pat) + "}";
            string resp;
            try
            {
                resp = HttpPost(baseUrl + QoderExchangePath, headers, body, 12000, pat);
            }
            catch (ApiException ex)
            {
                int status = ex.Status;
                if (status == 400 || status == 401 || status == 403)
                {
                    throw new ApiException(QoderError("KEY_INVALID", "qoder.exchange", status), status, ex.WebStatus);
                }
                throw new ApiException(
                    QoderError(QoderCodeForStatus(status, ex.WebStatus), "qoder.exchange", status),
                    status, ex.WebStatus);
            }
            Dictionary<string, object> root;
            try { root = Json.AsObject(Json.Parse(resp)); }
            catch (FormatException) { throw new ApiException(QoderError("PARSE_FAILED", "qoder.jobToken", 0)); }
            if (root == null) throw new ApiException(QoderError("PARSE_FAILED", "qoder.jobToken", 0));
            string token = QoderFirstString(root, "token", "job_token", "jobToken");
            if (string.IsNullOrEmpty(token)) throw new ApiException(QoderError("PARSE_FAILED", "qoder.jobToken", 0));
            return token;
        }

        private static string QoderFirstString(Dictionary<string, object> d, params string[] keys)
        {
            for (int i = 0; i < keys.Length; i++)
            {
                // 只认字符串值（对象/数字都不算令牌，避免把 JSON 结构转成字符串误用）
                string v = Json.GetValue(d, keys[i]) as string;
                if (!string.IsNullOrEmpty(v)) return v.Trim();
            }
            return "";
        }

        /// <summary>GET {base}/sash/api/v2/me/usage（Bearer jt-）；401 由调用方决定是否重换。</summary>
        private static string QoderUsageGet(string baseUrl, string token)
        {
            Dictionary<string, string> headers = new Dictionary<string, string>();
            headers["Authorization"] = "Bearer " + token;
            headers["Accept"] = "application/json";
            try
            {
                return HttpGet(baseUrl + QoderUsagePath, headers, 12000, token);
            }
            catch (ApiException ex)
            {
                throw new ApiException(
                    QoderError(QoderCodeForStatus(ex.Status, ex.WebStatus), "qoder.usage", ex.Status),
                    ex.Status, ex.WebStatus);
            }
        }

        /// <summary>单池余额：remaining 优先；否则 total-used；读不懂按 0（规格 §2，单池异常不能让整次查询失败）。</summary>
        private static double QoderPoolRemaining(Dictionary<string, object> pool)
        {
            if (pool == null) return 0;
            double? remaining = Json.ToDoubleOrNull(Json.GetValue(pool, "remaining"));
            if (remaining.HasValue && !double.IsNaN(remaining.Value) && !double.IsInfinity(remaining.Value))
            {
                return remaining.Value;
            }
            double? total = Json.ToDoubleOrNull(Json.GetValue(pool, "total"));
            double? used = Json.ToDoubleOrNull(Json.GetValue(pool, "used"));
            if (total.HasValue && used.HasValue
                && !double.IsNaN(total.Value) && !double.IsNaN(used.Value)
                && !double.IsInfinity(total.Value) && !double.IsInfinity(used.Value))
            {
                return total.Value - used.Value;
            }
            return 0;
        }

        /// <summary>汇总 userQuota + addOnQuota + orgResourcePackage；三池全缺 → NaN（调用方归 PARSE_FAILED qoder.quota）。</summary>
        private static double QoderQuotaAmount(object parsed)
        {
            Dictionary<string, object> root = Json.AsObject(parsed);
            if (root == null) return double.NaN;
            Dictionary<string, object> usage = Json.AsObject(Json.GetValue(root, "qoderUsage"));
            if (usage == null) usage = root; // 没有 qoderUsage 外层时 body 本身就是该对象
            string[] pools = new string[] { "userQuota", "addOnQuota", "orgResourcePackage" };
            int present = 0;
            double sum = 0;
            for (int i = 0; i < pools.Length; i++)
            {
                Dictionary<string, object> pool = Json.AsObject(Json.GetValue(usage, pools[i]));
                if (pool == null) continue;
                present++;
                sum += QoderPoolRemaining(pool);
            }
            if (present == 0) return double.NaN;
            // 四舍五入 2 位：先用 decimal 收掉二进制浮点尾差（82.345 → 82.35），再按远离零舍入（规格 §2）
            decimal exact = (decimal)sum;
            return (double)Math.Round(exact, 2, MidpointRounding.AwayFromZero);
        }

        /// <summary>
        /// Qoder 余额：PAT（KeyLoader）→ jt-（20 分钟缓存）→ GET usage 汇总三池。
        /// usage 401 强制重换一次再试；仍 401 归 KEY_INVALID。错误文案只带分类码，不带响应体/密钥。
        /// </summary>
        private static BalanceResult QueryQoder(ProviderConfig pc)
        {
            string pat = KeyLoader.Load(pc.KeySource);
            if (string.IsNullOrEmpty(pat)) return BalanceResult.Fail("qoder: pat not found");
            string baseUrl = QoderBase(pc);
            string cacheKey = QoderCacheKey(baseUrl, pat);
            try
            {
                string token = QoderCachedToken(cacheKey);
                if (token.Length == 0)
                {
                    token = ExchangeQoderJobToken(baseUrl, pat);
                    QoderRememberToken(cacheKey, token);
                }
                string body = null;
                try
                {
                    body = QoderUsageGet(baseUrl, token);
                }
                catch (ApiException ex)
                {
                    if (ex.Status != 401) throw;
                    // jt- 可能已失效：强制重换一次再试（重换后仍 401 → KEY_INVALID）
                    QoderForgetToken(cacheKey);
                    token = ExchangeQoderJobToken(baseUrl, pat);
                    QoderRememberToken(cacheKey, token);
                    try
                    {
                        body = QoderUsageGet(baseUrl, token);
                    }
                    catch (ApiException ex2)
                    {
                        if (ex2.Status == 401)
                        {
                            throw new ApiException(QoderError("KEY_INVALID", "qoder.usage", 401), 401, ex2.WebStatus);
                        }
                        throw;
                    }
                }
                object parsed;
                try { parsed = Json.Parse(body); }
                catch (FormatException) { return BalanceResult.Fail(QoderError("PARSE_FAILED", "qoder.quota", 0)); }
                double amount = QoderQuotaAmount(parsed);
                if (double.IsNaN(amount)) return BalanceResult.Fail(QoderError("PARSE_FAILED", "qoder.quota", 0));
                BalanceResult r = new BalanceResult();
                r.Ok = true;
                r.Amount = amount;
                r.Currency = "CREDITS";
                return r;
            }
            catch (ApiException ex)
            {
                return BalanceResult.Fail(ex.SafeMessage);
            }
            catch (UriFormatException)
            {
                return BalanceResult.Fail(QoderError("BAD_ENDPOINT", "qoder.endpoint", 0));
            }
        }

        internal static string HttpGet(string url, Dictionary<string, string> headers, int timeoutMs, string secretToRedact)
        {
            return HttpRequest("GET", url, headers, null, timeoutMs, secretToRedact);
        }

        /// <summary>0.0.7：Qoder exchange 需要 POST；与 GET 共用同一套超时 / TLS / 错误分类 / 脱敏。</summary>
        internal static string HttpPost(string url, Dictionary<string, string> headers, string body, int timeoutMs, string secretToRedact)
        {
            return HttpRequest("POST", url, headers, body, timeoutMs, secretToRedact);
        }

        private static string HttpRequest(string method, string url, Dictionary<string, string> headers, string bodyText, int timeoutMs, string secretToRedact)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = method;
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.KeepAlive = false;
            req.UserAgent = "GluttonBalance/1.0";
            req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            if (headers != null)
            {
                foreach (KeyValuePair<string, string> kv in headers)
                {
                    if (string.Equals(kv.Key, "Accept", StringComparison.OrdinalIgnoreCase)) req.Accept = kv.Value;
                    else if (string.Equals(kv.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)) req.ContentType = kv.Value;
                    else req.Headers[kv.Key] = kv.Value;
                }
            }
            try
            {
                if (!string.IsNullOrEmpty(bodyText))
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(bodyText);
                    req.ContentLength = bytes.Length;
                    using (Stream ws = req.GetRequestStream()) ws.Write(bytes, 0, bytes.Length);
                }
                using (WebResponse resp = req.GetResponse())
                using (Stream stream = resp.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
            catch (WebException we)
            {
                int status = 0;
                string snippet = "";
                try
                {
                    if (we.Response != null)
                    {
                        HttpWebResponse hr = (HttpWebResponse)we.Response;
                        status = (int)hr.StatusCode;
                        using (Stream es = hr.GetResponseStream())
                        using (StreamReader er = new StreamReader(es, Encoding.UTF8))
                        {
                            snippet = er.ReadToEnd();
                        }
                    }
                }
                catch { }
                string msg = status > 0
                    ? "HTTP " + status.ToString(CultureInfo.InvariantCulture)
                    : "network: " + we.Status.ToString();
                if (!string.IsNullOrEmpty(snippet))
                {
                    snippet = snippet.Replace("\r", " ").Replace("\n", " ");
                    if (snippet.Length > 160) snippet = snippet.Substring(0, 160);
                    msg += " " + Redact(snippet, secretToRedact);
                }
                throw new ApiException(msg, status, we.Status);
            }
        }

        /// <summary>v3：读 Coopanion 主题（/api/state 的 theme + /api/theme 的 palettes）。</summary>
        public static ThemeInfo QueryTheme(int themePort, int statePort)
        {
            ThemeInfo ti = new ThemeInfo();
            try
            {
                string stateUrl = "http://127.0.0.1:" + statePort.ToString(CultureInfo.InvariantCulture) + "/api/state";
                string stateBody = HttpGet(stateUrl, null, 1500, null);
                Dictionary<string, object> st = Json.AsObject(Json.Parse(stateBody));
                if (st != null)
                {
                    string th = Json.GetString(st, "theme", "");
                    if (!string.IsNullOrEmpty(th)) ti.Theme = th.Trim().ToLowerInvariant();
                }
            }
            catch (Exception ex)
            {
                ti.StateError = Program.SafeText(ex.Message);
            }
            try
            {
                string themeUrl = "http://127.0.0.1:" + themePort.ToString(CultureInfo.InvariantCulture) + "/api/theme";
                string body = HttpGet(themeUrl, null, 2500, null);
                Dictionary<string, object> root = Json.AsObject(Json.Parse(body));
                Dictionary<string, object> th = Json.AsObject(Json.GetValue(root, "theme"));
                if (th != null)
                {
                    ti.SelectedId = Json.GetString(th, "selectedId", "");
                    List<object> custom = Json.AsArray(Json.GetValue(th, "custom"));
                    if (custom != null)
                    {
                        for (int i = 0; i < custom.Count; i++)
                        {
                            Dictionary<string, object> item = Json.AsObject(custom[i]);
                            if (item == null) continue;
                            string id = Json.GetString(item, "id", "");
                            if (ti.SelectedId.Length > 0 && !string.Equals(id, ti.SelectedId, StringComparison.Ordinal)) continue;
                            Dictionary<string, object> pal = Json.AsObject(Json.GetValue(item, "palettes"));
                            if (pal == null) continue;
                            ti.Dark = ParsePalette(Json.AsObject(Json.GetValue(pal, "dark")));
                            ti.Light = ParsePalette(Json.AsObject(Json.GetValue(pal, "light")));
                            ti.PaletteOk = ti.Dark.Count > 0 || ti.Light.Count > 0;
                            break;
                        }
                    }
                }
                ti.PaletteSource = "api";
                ti.Ok = true;
            }
            catch (Exception ex)
            {
                ti.Error = Program.SafeText(ex.Message);
                ti.Ok = ti.Theme.Length > 0;
            }
            return ti;
        }

        private static Dictionary<string, Color> ParsePalette(Dictionary<string, object> raw)
        {
            Dictionary<string, Color> d = new Dictionary<string, Color>();
            if (raw == null) return d;
            foreach (KeyValuePair<string, object> kv in raw)
            {
                string s = kv.Value as string;
                if (string.IsNullOrEmpty(s)) continue;
                Color c;
                if (TryParseHex(s, out c)) d[kv.Key] = c;
            }
            return d;
        }

        internal static bool TryParseHex(string s, out Color c)
        {
            c = Color.Empty;
            if (string.IsNullOrEmpty(s)) return false;
            s = s.Trim();
            if (s.StartsWith("#")) s = s.Substring(1);
            if (s.Length == 3)
            {
                s = new string(new char[] { s[0], s[0], s[1], s[1], s[2], s[2] });
            }
            if (s.Length != 6 && s.Length != 8) return false;
            int v;
            if (!int.TryParse(s, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out v)) return false;
            if (s.Length == 6) { c = Color.FromArgb(255, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }
            else { c = Color.FromArgb((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }
            return true;
        }

        public static string Redact(string text, string secret)
        {
            if (string.IsNullOrEmpty(text)) return text;
            if (!string.IsNullOrEmpty(secret) && secret.Length >= 8) text = text.Replace(secret, "***");
            return text;
        }
    }

    // ------------------------------------------------------------------ JSON

    internal static class Json
    {
        public static object Parse(string text)
        {
            if (text == null) throw new FormatException("JSON: null text");
            int i = 0;
            object value = ParseValue(text, ref i);
            SkipWs(text, ref i);
            if (i < text.Length) throw new FormatException("JSON: trailing characters at index " + i);
            return value;
        }

        private static void SkipWs(string s, ref int i)
        {
            while (i < s.Length)
            {
                char c = s[i];
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') { i++; continue; }
                break;
            }
        }

        private static object ParseValue(string s, ref int i)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON: unexpected end of text");
            char c = s[i];
            if (c == '{') return ParseObject(s, ref i);
            if (c == '[') return ParseArray(s, ref i);
            if (c == '"') return ParseString(s, ref i);
            if (c == 't') { Expect(s, ref i, "true"); return true; }
            if (c == 'f') { Expect(s, ref i, "false"); return false; }
            if (c == 'n') { Expect(s, ref i, "null"); return null; }
            if (c == '-' || (c >= '0' && c <= '9')) return ParseNumber(s, ref i);
            throw new FormatException("JSON: unexpected character '" + c + "' at index " + i);
        }

        private static void Expect(string s, ref int i, string word)
        {
            if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0)
            {
                throw new FormatException("JSON: expected " + word + " at index " + i);
            }
            i += word.Length;
        }

        private static Dictionary<string, object> ParseObject(string s, ref int i)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            i++;
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return d; }
            while (true)
            {
                SkipWs(s, ref i);
                if (i >= s.Length || s[i] != '"') throw new FormatException("JSON: expected object key at index " + i);
                string key = ParseString(s, ref i);
                SkipWs(s, ref i);
                if (i >= s.Length || s[i] != ':') throw new FormatException("JSON: expected ':' at index " + i);
                i++;
                d[key] = ParseValue(s, ref i);
                SkipWs(s, ref i);
                if (i >= s.Length) throw new FormatException("JSON: unterminated object");
                char c = s[i];
                if (c == ',') { i++; continue; }
                if (c == '}') { i++; return d; }
                throw new FormatException("JSON: expected ',' or '}' at index " + i);
            }
        }

        private static List<object> ParseArray(string s, ref int i)
        {
            List<object> list = new List<object>();
            i++;
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return list; }
            while (true)
            {
                list.Add(ParseValue(s, ref i));
                SkipWs(s, ref i);
                if (i >= s.Length) throw new FormatException("JSON: unterminated array");
                char c = s[i];
                if (c == ',') { i++; continue; }
                if (c == ']') { i++; return list; }
                throw new FormatException("JSON: expected ',' or ']' at index " + i);
            }
        }

        private static string ParseString(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("JSON: expected string at index " + i);
            i++;
            StringBuilder sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) throw new FormatException("JSON: bad escape");
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > s.Length) throw new FormatException("JSON: bad unicode escape");
                        int code = 0;
                        for (int k = 0; k < 4; k++) code = code * 16 + HexVal(s[i + k]);
                        sb.Append((char)code);
                        i += 4;
                        break;
                    default:
                        throw new FormatException("JSON: bad escape '\\" + e + "'");
                }
            }
            throw new FormatException("JSON: unterminated string");
        }

        private static int HexVal(char c)
        {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            throw new FormatException("JSON: bad hex digit '" + c + "'");
        }

        private static object ParseNumber(string s, ref int i)
        {
            int start = i;
            if (s[i] == '-') i++;
            while (i < s.Length)
            {
                char c = s[i];
                if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') i++;
                else break;
            }
            string num = s.Substring(start, i - start);
            double d;
            if (!double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out d))
            {
                throw new FormatException("JSON: bad number " + num);
            }
            return d;
        }

        public static Dictionary<string, object> AsObject(object v)
        {
            return v as Dictionary<string, object>;
        }

        public static List<object> AsArray(object v)
        {
            return v as List<object>;
        }

        public static object GetValue(Dictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v)) return v;
            return null;
        }

        public static string ToStr(object v)
        {
            if (v == null) return null;
            string s = v as string;
            if (s != null) return s;
            if (v is bool) return ((bool)v) ? "true" : "false";
            if (v is double) return ((double)v).ToString("R", CultureInfo.InvariantCulture);
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static string GetString(Dictionary<string, object> d, string key, string def)
        {
            string s = ToStr(GetValue(d, key));
            if (string.IsNullOrEmpty(s)) return def;
            return s;
        }

        public static double? ToDoubleOrNull(object v)
        {
            if (v == null) return null;
            if (v is double) return (double)v;
            string s = v as string;
            if (s != null)
            {
                double d;
                if (double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            }
            return null;
        }

        public static double? GetNumber(Dictionary<string, object> d, string key)
        {
            return ToDoubleOrNull(GetValue(d, key));
        }

        public static bool GetBool(Dictionary<string, object> d, string key, bool def)
        {
            object v = GetValue(d, key);
            if (v is bool) return (bool)v;
            return def;
        }

        public static string Quote(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
    }

    // ------------------------------------------------------------------ 日志

    internal static class Log
    {
        private static readonly object s_gate = new object();
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);
        private static string s_path = "";
        private static bool s_initialized;

        public static void Init(string path)
        {
            lock (s_gate)
            {
                s_path = path;
                s_initialized = true;
            }
        }

        public static void Write(string message)
        {
            lock (s_gate)
            {
                if (!s_initialized || string.IsNullOrEmpty(s_path)) return;
                try
                {
                    try
                    {
                        FileInfo fi = new FileInfo(s_path);
                        if (fi.Exists && fi.Length > 262144) File.Delete(s_path);
                    }
                    catch { }
                    string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture)
                        + " " + message + "\r\n";
                    File.AppendAllText(s_path, line, Utf8NoBom);
                }
                catch { }
            }
        }
    }

    // ------------------------------------------------------------------ 热键解析

    internal static class HotkeyParser
    {
        public static bool TryParse(string combo, out uint mods, out uint vk)
        {
            mods = 0;
            vk = 0;
            if (string.IsNullOrEmpty(combo)) return false;
            string[] parts = combo.Split('+');
            for (int i = 0; i < parts.Length; i++)
            {
                string p = parts[i].Trim().ToLowerInvariant();
                if (p.Length == 0) continue;
                if (p == "ctrl" || p == "control") { mods |= Native.MOD_CONTROL; continue; }
                if (p == "alt") { mods |= Native.MOD_ALT; continue; }
                if (p == "shift") { mods |= Native.MOD_SHIFT; continue; }
                if (p == "win" || p == "windows") { mods |= Native.MOD_WIN; continue; }
                if (p.Length == 1)
                {
                    char c = char.ToUpperInvariant(p[0]);
                    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) { vk = (uint)c; continue; }
                    return false;
                }
                if (p.Length >= 2 && p[0] == 'f')
                {
                    int n;
                    if (int.TryParse(p.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out n) && n >= 1 && n <= 24)
                    {
                        vk = (uint)(0x70 + n - 1);
                        continue;
                    }
                    return false;
                }
                return false;
            }
            if (vk == 0 || mods == 0) return false;
            mods |= Native.MOD_NOREPEAT;
            return true;
        }
    }

    // ------------------------------------------------------------------ Win32

    internal static class Native
    {
        public const int WS_POPUP = unchecked((int)0x80000000);
        public const long WS_EX_LAYERED = 0x00080000L;
        public const long WS_EX_TRANSPARENT = 0x00000020L;
        public const long WS_EX_TOOLWINDOW = 0x00000080L;
        public const long WS_EX_NOACTIVATE = 0x08000000L;
        public const int GWL_EXSTYLE = -20;
        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_NOOWNERZORDER = 0x0200;
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public const int SW_SHOWNOACTIVATE = 4;
        public const int SW_HIDE = 0;
        public const uint WM_CLOSE = 0x0010;
        public const uint WM_DESTROY = 0x0002;
        public const uint WM_HOTKEY = 0x0312;
        public const int SPI_GETWORKAREA = 0x0030;
        public const int SM_CXSCREEN = 0;
        public const int SM_CYSCREEN = 1;
        public const int LOGPIXELSX = 88;
        public const int ULW_ALPHA = 2;
        public const byte AC_SRC_OVER = 0;
        public const byte AC_SRC_ALPHA = 1;
        public const uint MOD_ALT = 0x0001;
        public const uint MOD_CONTROL = 0x0002;
        public const uint MOD_SHIFT = 0x0004;
        public const uint MOD_WIN = 0x0008;
        public const uint MOD_NOREPEAT = 0x4000;
        public const uint WM_TIMER = 0x0113;
        public const uint WM_NCHITTEST = 0x0084;
        public const int HTTRANSPARENT = -1;
        public const int HTCLIENT = 1;
        /// <summary>PrintWindow 的 PW_RENDERFULLCONTENT（Electron/透明窗需要它才渲染出内容）。</summary>
        public const uint PW_RENDERFULLCONTENT = 2;
        public const uint MONITOR_DEFAULTTONEAREST = 2;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SIZE
        {
            public int cx;
            public int cy;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        public delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WNDCLASSEX
        {
            public int cbSize;
            public int style;
            public WndProcDelegate lpfnWndProc;
            public int cbClsExtra;
            public int cbWndExtra;
            public IntPtr hInstance;
            public IntPtr hIcon;
            public IntPtr hCursor;
            public IntPtr hbrBackground;
            public string lpszMenuName;
            public string lpszClassName;
            public IntPtr hIconSm;
        }

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern ushort RegisterClassEx(ref WNDCLASSEX lpwcx);

        [DllImport("user32.dll", EntryPoint = "CreateWindowExW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
        public static extern IntPtr CreateWindowEx(int dwExStyle, string lpClassName, string lpWindowName,
            int dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyWindow(IntPtr hWnd);

        [DllImport("user32.dll", EntryPoint = "DefWindowProcW", CharSet = CharSet.Unicode, ExactSpelling = true)]
        public static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        public static extern bool TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        public static extern IntPtr DispatchMessage(ref MSG lpMsg);

        [DllImport("user32.dll")]
        public static extern void PostQuitMessage(int nExitCode);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetTimer(IntPtr hWnd, int nIDEvent, uint uElapse, IntPtr lpTimerFunc);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool KillTimer(IntPtr hWnd, int uIDEvent);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll", EntryPoint = "SetWindowTextW", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
        public static extern bool SetWindowText(IntPtr hWnd, string lpString);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

        [DllImport("user32.dll")]
        public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SystemParametersInfo(int uiAction, int uiParam, out RECT pvParam, int fWinIni);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("gdi32.dll")]
        public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize,
            IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);

        [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
        private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
        private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
        private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        public static long GetWindowExStyle(IntPtr hwnd)
        {
            if (IntPtr.Size == 8) return GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
            return (long)GetWindowLong32(hwnd, GWL_EXSTYLE);
        }

        public static void SetWindowExStyle(IntPtr hwnd, long style)
        {
            if (IntPtr.Size == 8) SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(style));
            else SetWindowLong32(hwnd, GWL_EXSTYLE, (int)style);
        }
    }
}
