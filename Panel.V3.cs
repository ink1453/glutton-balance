// -*- coding: utf-8 -*-
// 桌宠白饭桶 v3-A：主题联动 / 白饭桶渲染 / 布局 / 可选交互明细 / --selftest / --shot / DPI 与多屏
// 与 Panel.cs 同一程序集（build.ps1 一起编译），只新增类型，不改旧胶囊回退路径。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace PetBalancePanel
{
    // ================================================================== 主题
    internal sealed class ThemeInfo
    {
        public bool Ok;
        public bool PaletteOk;
        public string Theme = "dark";
        public string SelectedId = "";
        public string PaletteSource = "fallback";
        public string StateError = "";
        public string Error = "";
        public Dictionary<string, Color> Dark = new Dictionary<string, Color>();
        public Dictionary<string, Color> Light = new Dictionary<string, Color>();
    }

    internal sealed class VisualStyle
    {
        public string Key = "dark/fallback";
        public string Theme = "dark";
        public string SelectedId = "";
        public bool Light;
        public string BowlStyleName = "steel";
        public Color PlaqueFill;
        public Color PlaqueBorder;
        public Color PlaqueTop;
        public Color NameColor;
        public Color AmountColor;
        public Color LowColor;
        public Color FailColor;
        public Color WarnColor;
        public Color HintColor;
        public Color DotGreen;
        public Color DotRed;
        public Color DotGrey;
        public Color DotRice;
        public Color CardFill;
        public Color CardTop;
        public Color CardBorder;
        public Color CardDivider;

        public static VisualStyle Fallback(string theme)
        {
            VisualStyle s = new VisualStyle();
            bool light = string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase);
            s.Theme = light ? "light" : "dark";
            s.Light = light;
            if (light)
            {
                s.PlaqueFill = Color.FromArgb(246, 248, 249, 250);
                s.PlaqueBorder = Color.FromArgb(255, 174, 174, 179);
                s.PlaqueTop = Color.FromArgb(40, 255, 255, 255);
                s.NameColor = Color.FromArgb(255, 139, 139, 145);
                s.AmountColor = Color.FromArgb(255, 27, 27, 31);
                s.LowColor = Color.FromArgb(255, 180, 89, 80);
                s.FailColor = Color.FromArgb(255, 139, 139, 145);
                s.WarnColor = Color.FromArgb(255, 150, 116, 59);
                s.HintColor = Color.FromArgb(255, 92, 92, 98);
                s.DotGreen = Color.FromArgb(255, 25, 129, 94);
                s.DotRed = Color.FromArgb(255, 180, 89, 80);
                s.DotGrey = Color.FromArgb(255, 139, 139, 145);
                s.DotRice = Color.FromArgb(255, 190, 150, 80);
                s.CardFill = Color.FromArgb(246, 251, 251, 252);
                s.CardTop = Color.FromArgb(38, 255, 255, 255);
                s.CardBorder = Color.FromArgb(255, 174, 174, 179);
                s.CardDivider = Color.FromArgb(70, 174, 174, 179);
            }
            else
            {
                s.PlaqueFill = Color.FromArgb(238, 18, 18, 20);
                s.PlaqueBorder = Color.FromArgb(255, 85, 85, 91);
                s.PlaqueTop = Color.FromArgb(30, 255, 255, 255);
                s.NameColor = Color.FromArgb(255, 131, 131, 137);
                s.AmountColor = Color.FromArgb(255, 234, 234, 236);
                s.LowColor = Color.FromArgb(255, 226, 126, 112);
                s.FailColor = Color.FromArgb(255, 131, 131, 137);
                s.WarnColor = Color.FromArgb(255, 196, 163, 114);
                s.HintColor = Color.FromArgb(255, 177, 177, 182);
                s.DotGreen = Color.FromArgb(255, 118, 202, 159);
                s.DotRed = Color.FromArgb(255, 226, 126, 112);
                s.DotGrey = Color.FromArgb(255, 131, 131, 137);
                s.DotRice = Color.FromArgb(255, 238, 198, 120);
                s.CardFill = Color.FromArgb(244, 18, 18, 20);
                s.CardTop = Color.FromArgb(30, 255, 255, 255);
                s.CardBorder = Color.FromArgb(255, 85, 85, 91);
                s.CardDivider = Color.FromArgb(70, 85, 85, 91);
            }
            return s;
        }
    }

    internal static class VisualStyleBuilder
    {
        public static VisualStyle Build(ThemeInfo ti, string force, string bowlStyle, bool follow)
        {
            string theme = ResolveTheme(ti, force);
            Dictionary<string, Color> pal = null;
            if (ti != null) pal = string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase) ? ti.Light : ti.Dark;
            bool fromApi = ti != null && ti.PaletteOk && pal != null && pal.Count > 0;
            VisualStyle st = fromApi ? FromPalette(pal, theme) : VisualStyle.Fallback(theme);
            st.Theme = theme;
            st.Light = string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase);
            st.SelectedId = ti == null ? "" : (ti.SelectedId ?? "");
            st.BowlStyleName = bowlStyle == "ceramic" ? "ceramic" : "steel";                        // 0.0.4：删除 enamel 搪瓷外观
            st.Key = theme + "/" + (fromApi ? "api:" + st.SelectedId : "fallback") + "/" + st.BowlStyleName;
            return st;
        }

        private static string ResolveTheme(ThemeInfo ti, string force)
        {
            if (force == "dark" || force == "light") return force;
            if (ti != null && (ti.Theme == "dark" || ti.Theme == "light")) return ti.Theme;
            return "dark";
        }

        private static VisualStyle FromPalette(Dictionary<string, Color> pal, string theme)
        {
            VisualStyle s = new VisualStyle();
            bool light = string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase);
            s.Light = light;
            Color paper = Get(pal, "paper", light ? Color.FromArgb(255, 245, 245, 246) : Color.FromArgb(255, 18, 18, 20));
            Color paper2 = Get(pal, "paper-2", paper);
            Color sheet = Get(pal, "sheet", paper);
            Color ink = Get(pal, "ink", light ? Color.FromArgb(255, 27, 27, 31) : Color.FromArgb(255, 234, 234, 236));
            Color inkSoft = Get(pal, "ink-soft", ink);
            Color inkDim = Get(pal, "ink-dim", inkSoft);
            Color line = Get(pal, "line", paper2);
            Color lineStrong = Get(pal, "line-strong", line);
            Color ok = Get(pal, "ok", light ? Color.FromArgb(255, 25, 129, 94) : Color.FromArgb(255, 118, 202, 159));
            Color danger = Get(pal, "danger", light ? Color.FromArgb(255, 180, 89, 80) : Color.FromArgb(255, 226, 126, 112));
            Color accent = Get(pal, "accent", ok);
            Color warn = Get(pal, "warn", light ? Color.FromArgb(255, 150, 116, 59) : Color.FromArgb(255, 196, 163, 114));
            // 铭牌：深色主题用纸底色半透明，浅色主题用浅纸底
            s.PlaqueFill = Color.FromArgb(light ? 246 : 238, paper);
            s.PlaqueBorder = Color.FromArgb(255, lineStrong);
            s.PlaqueTop = Color.FromArgb(30, light ? 255 : 255, 255, 255);
            s.NameColor = Color.FromArgb(255, inkDim);
            s.AmountColor = Color.FromArgb(255, ink);
            s.LowColor = Color.FromArgb(255, danger);
            s.FailColor = Color.FromArgb(255, inkDim);
            s.WarnColor = Color.FromArgb(255, warn);
            s.HintColor = Color.FromArgb(255, inkSoft);
            s.DotGreen = Color.FromArgb(255, ok);
            s.DotRed = Color.FromArgb(255, danger);
            s.DotGrey = Color.FromArgb(255, inkDim);
            s.DotRice = Color.FromArgb(255, light ? Color.FromArgb(255, 176, 132, 56) : Color.FromArgb(255, 238, 198, 120));
            s.CardFill = Color.FromArgb(light ? 246 : 244, sheet);
            s.CardTop = Color.FromArgb(34, 255, 255, 255);
            s.CardBorder = Color.FromArgb(255, lineStrong);
            s.CardDivider = Color.FromArgb(70, lineStrong);
            return s;
        }

        private static Color Get(Dictionary<string, Color> pal, string key, Color def)
        {
            Color c;
            if (pal != null && pal.TryGetValue(key, out c)) return c;
            return def;
        }
    }

    // ================================================================== 盆材质（不跟主题变）
    internal sealed class BowlMaterial
    {
        public string Name = "steel";
        public Color[] BodyColors;
        public float[] BodyPositions;
        public Color Rim;
        public Color RimLight;
        public Color InnerTop;
        public Color InnerBottom;
        public Color Rice;
        public Color RiceShadow;
        public Color Gloss;
        public Color Outline;
        public Color Deco;
    }

    internal static class BowlMaterials
    {
        private static BowlMaterial s_steel;
        private static BowlMaterial s_ceramic;

        public static BowlMaterial Get(string name)
        {
            if (name == "ceramic") return Ceramic();
            return Steel();
        }

        public static BowlMaterial Steel()
        {
            if (s_steel != null) return s_steel;
            BowlMaterial m = new BowlMaterial();
            m.Name = "steel";
            m.BodyPositions = new float[] { 0f, 0.08f, 0.20f, 0.30f, 0.42f, 0.55f, 0.68f, 0.82f, 1f };
            m.BodyColors = new Color[] {
                C(250,253,255), C(214,223,232), C(150,162,175), C(96,108,120), C(176,188,200),
                C(226,233,240), C(120,132,145), C(84,94,105), C(52,60,68) };
            m.Rim = C(150, 162, 174);
            m.RimLight = C(252, 254, 255);
            m.InnerTop = C(42, 47, 53);
            m.InnerBottom = C(182, 192, 202);
            m.Rice = C(250, 249, 245);
            m.RiceShadow = C(208, 205, 194);
            m.Gloss = C(255, 255, 255);
            m.Outline = C(38, 44, 52);
            m.Deco = C(255, 255, 255);
            s_steel = m;
            return m;
        }

        public static BowlMaterial Ceramic()
        {
            if (s_ceramic != null) return s_ceramic;
            BowlMaterial m = new BowlMaterial();
            m.Name = "ceramic";
            m.BodyPositions = new float[] { 0f, 0.28f, 0.60f, 0.84f, 1f };
            m.BodyColors = new Color[] { C(251,247,240), C(244,238,227), C(233,225,210), C(207,198,182), C(172,163,148) };
            m.Rim = C(228, 216, 196);
            m.RimLight = C(255, 253, 247);
            m.InnerTop = C(52, 46, 40);
            m.InnerBottom = C(228, 218, 202);
            m.Rice = C(252, 250, 244);
            m.RiceShadow = C(212, 206, 192);
            m.Gloss = C(255, 253, 246);
            m.Outline = C(96, 80, 62);
            m.Deco = C(168, 148, 120);
            s_ceramic = m;
            return m;
        }

        private static Color C(int r, int g, int b)
        {
            return Color.FromArgb(255, r, g, b);
        }
    }

    // ================================================================== 缩放 / 资源 / 布局
    internal static class ScaleMath
    {
        public static double GraphicsScale(Config cfg, double petScale)
        {
            double refScale = 1.05;
            double lo = 0.55, hi = 2.0;
            if (cfg != null && cfg.Display != null)
            {
                refScale = cfg.Display.PetScaleRef;
                lo = cfg.Display.GraphicsMin;
                hi = cfg.Display.GraphicsMax;
            }
            if (refScale < 0.2) refScale = 1.05;
            if (lo < 0.2) lo = 0.55;
            if (hi < lo) hi = 2.0;
            double gs = petScale / refScale;
            if (gs < lo) gs = lo;
            if (gs > hi) gs = hi;
            return gs;
        }
    }

    /// <summary>一只饭桶资源：透明 PNG + 同名 JSON（rice 米饭窗口 / rimY / anchor / scaleHint）。</summary>
    internal sealed class BowlAsset
    {
        public string Id = "black";
        public string Name = "深色宽沿浅盆";
        public string Source = "builtin";
        public Bitmap Bitmap;
        public Bitmap BackBitmap;   // 内壁层（先画它 → 米饭 → 再画正面壳/前沿）
        public string PngPath = "";
        public string JsonPath = "";
        public DateTime PngMtime = DateTime.MinValue;
        public DateTime JsonMtime = DateTime.MinValue;
        public bool Ok;
        public string Error = "";
        public int PixelW, PixelH;
        public float RiceX, RiceY, RiceW, RiceH;   // 图片坐标（PNG 原始像素）
        public float RimY;
        public float RimBottom;    // 碗前沿线最低点（sprite 坐标）
        public bool LightBody;                     // 浅色盆身 → 文字用深色
    }

    internal static class BowlAssets
    {
        private const string DefaultId = "black";
        private static readonly object s_gate = new object();
        private static readonly Dictionary<string, BowlAsset> s_cache = new Dictionary<string, BowlAsset>();
        private static readonly string[] BuiltinIds = new string[] { "black", "porcelain", "steel" };   // 0.0.4：删除 enamel 搪瓷外观

        public static string NormalizeId(string style)
        {
            string raw = (style ?? "").Trim();
            if (raw.Length == 0) return DefaultId;
            if (raw.StartsWith("custom:", StringComparison.OrdinalIgnoreCase)) return raw;
            string low = raw.ToLowerInvariant();
            if (low == "enamel") return "porcelain";   // 0.0.4：搪瓷外观已删除，历史 id 显式回退白瓷（不回退 black）
            for (int i = 0; i < BuiltinIds.Length; i++) if (BuiltinIds[i] == low) return low;
            return "custom:" + raw;
        }

        public static BowlAsset Get(string style)
        {
            string key = NormalizeId(style);
            lock (s_gate)
            {
                BowlAsset cached;
                if (s_cache.TryGetValue(key, out cached)) return cached;
                BowlAsset asset = Load(key);
                s_cache[key] = asset;
                if (asset.Ok)
                {
                    Log.Write("bowl load ok id=" + key + " name=" + asset.Name + " source=" + asset.Source);
                }
                else
                {
                    Log.Write("WARN bowl load failed id=" + key + " err=" + Program.SafeText(asset.Error) + " fallback=black");
                }
                return asset;
            }
        }

        public static List<BowlAsset> ListAll()
        {
            List<BowlAsset> list = new List<BowlAsset>();
            for (int i = 0; i < BuiltinIds.Length; i++) list.Add(Get(BuiltinIds[i]));
            List<string> custom = new List<string>();
            string userDir = UserBowlDir();
            if (!string.Equals(Path.GetFullPath(userDir).TrimEnd(Path.DirectorySeparatorChar),
                Path.GetFullPath(BuiltinDir()).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)
                && Directory.Exists(userDir))
            {
                try
                {
                    string[] files = Directory.GetFiles(userDir, "*.png");
                    for (int i = 0; i < files.Length; i++)
                    {
                        string id = Path.GetFileNameWithoutExtension(files[i]);
                        if (id.Length > 0) custom.Add(id);
                    }
                }
                catch { }
            }
            for (int i = 0; i < custom.Count; i++) list.Add(Get("custom:" + custom[i]));
            return list;
        }

        /// <summary>定时热重载：已缓存的饭桶 PNG/JSON 被替换或删除 → 丢弃缓存，下一次渲染自动重载。</summary>
        public static void Sweep()
        {
            lock (s_gate)
            {
                List<string> changed = new List<string>();
                foreach (KeyValuePair<string, BowlAsset> kv in s_cache)
                {
                    BowlAsset a = kv.Value;
                    if (a == null || a.PngPath.Length == 0) continue;
                    bool dirty = false;
                    try
                    {
                        if (!File.Exists(a.PngPath)) dirty = true;
                        else if (File.GetLastWriteTimeUtc(a.PngPath) != a.PngMtime) dirty = true;
                        else if (a.JsonPath.Length > 0 && File.Exists(a.JsonPath)
                                 && File.GetLastWriteTimeUtc(a.JsonPath) != a.JsonMtime) dirty = true;
                    }
                    catch { dirty = true; }
                    if (dirty) changed.Add(kv.Key);
                }
                foreach (string key in changed)
                {
                    BowlAsset a = s_cache[key];
                    s_cache.Remove(key);
                    try { if (a.Bitmap != null) a.Bitmap.Dispose(); } catch { }
                    try { if (a.BackBitmap != null) a.BackBitmap.Dispose(); } catch { }
                    Log.Write("bowl reload id=" + key + " reason=mtime");
                }
                if (changed.Count > 0) RiceCache.ClearForAssets(changed);
            }
        }

        public static string UserBowlDir()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(Path.Combine(Path.Combine(home, ".dsh"), "pet-balance-panel"), "bowls");
        }

        private static string BuiltinDir()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            return Path.Combine(baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), "bowls");
        }

        private static BowlAsset Load(string key)
        {
            bool custom = key.StartsWith("custom:", StringComparison.OrdinalIgnoreCase);
            string id = custom ? key.Substring(7) : key;
            string pngName = id + ".png";
            string jsonName = id + ".json";
            List<string> dirs = new List<string>();
            dirs.Add(UserBowlDir());
            dirs.Add(BuiltinDir());
            for (int i = 0; i < dirs.Count; i++)
            {
                string png = Path.Combine(dirs[i], pngName);
                string json = Path.Combine(dirs[i], jsonName);
                if (!File.Exists(png)) continue;
                try
                {
                    BowlAsset a = LoadOne(png, json);
                    a.Id = key;
                    string builtin = BuiltinDir();
                    bool isBuiltinDir = string.Equals(Path.GetFullPath(dirs[i]).TrimEnd(Path.DirectorySeparatorChar),
                        Path.GetFullPath(builtin).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
                    a.Source = isBuiltinDir ? "builtin" : "custom";
                    return a;
                }
                catch (Exception ex)
                {
                    return Fail(key, Program.SafeText(ex.Message));
                }
            }
            return Fail(key, "resource not found (" + pngName + ")");
        }

        private static BowlAsset LoadOne(string pngPath, string jsonPath)
        {
            BowlAsset a = new BowlAsset();
            Dictionary<string, object> root = null;
            if (File.Exists(jsonPath))
            {
                string txt = File.ReadAllText(jsonPath, Encoding.UTF8);
                root = Json.AsObject(Json.Parse(txt));
            }
            if (root == null) throw new FormatException("json missing or not an object");
            a.Name = Json.GetString(root, "name", "");
            if (a.Name.Length == 0) a.Name = Path.GetFileNameWithoutExtension(pngPath);
            Dictionary<string, object> rice = Json.AsObject(Json.GetValue(root, "rice"));
            if (rice == null) rice = new Dictionary<string, object>();
            a.RiceX = (float)Json.GetNumber(rice, "x").GetValueOrDefault(0);
            a.RiceY = (float)Json.GetNumber(rice, "y").GetValueOrDefault(0);
            a.RiceW = (float)Json.GetNumber(rice, "w").GetValueOrDefault(0);
            a.RiceH = (float)Json.GetNumber(rice, "h").GetValueOrDefault(0);
            a.RimY = (float)Json.GetNumber(root, "rimY").GetValueOrDefault(0);
            a.RimBottom = (float)Json.GetNumber(root, "rimBottom").GetValueOrDefault(0);
            string backName = Json.GetString(root, "back", "");
            if (backName.Length > 0)
            {
                try
                {
                    string backPath = Path.Combine(Path.GetDirectoryName(pngPath), backName);
                    if (File.Exists(backPath))
                    {
                        a.BackBitmap = LoadBitmapNoLock(backPath);
                    }
                }
                catch { a.BackBitmap = null; }
            }
            Bitmap bmp = LoadBitmapNoLock(pngPath);
            if (bmp.PixelFormat != PixelFormat.Format32bppArgb)
            {
                Bitmap conv = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(conv)) g.DrawImageUnscaled(bmp, 0, 0);
                bmp.Dispose();
                bmp = conv;
            }
            a.Bitmap = bmp;
            a.PngPath = pngPath;
            a.JsonPath = jsonPath;
            try { a.PngMtime = File.GetLastWriteTimeUtc(pngPath); } catch { }
            try { a.JsonMtime = File.Exists(jsonPath) ? File.GetLastWriteTimeUtc(jsonPath) : DateTime.MinValue; } catch { }
            a.PixelW = bmp.Width;
            a.PixelH = bmp.Height;
            if (a.RiceW <= 1 || a.RiceH <= 1)
            {
                // 缺 rice 字段 → 用默认（居中、留边）
                a.RiceX = a.PixelW * 0.225f;
                a.RiceY = a.PixelH * 0.215f;
                a.RiceW = a.PixelW * 0.55f;
                a.RiceH = a.PixelH * 0.58f;
            }
            if (a.RimY <= 0 || a.RimY >= a.PixelH) a.RimY = a.PixelH * 0.42f;
            if (a.RimBottom <= a.RimY || a.RimBottom > a.PixelH) a.RimBottom = a.RimY + (a.PixelH - a.RimY) * 0.33f;
            // 判断盆身深浅（取下半部平均亮度）
            a.LightBody = IsLight(a.Bitmap);
            a.Ok = true;
            return a;
        }

        /// <summary>读字节到内存再解码，避免 Bitmap 长期占用文件句柄（用户可随时替换/删除饭桶）。</summary>
        private static Bitmap LoadBitmapNoLock(string path)
        {
            byte[] bytes = File.ReadAllBytes(path);
            MemoryStream ms = new MemoryStream(bytes);
            return new Bitmap(ms);
        }

        private static bool IsLight(Bitmap bmp)
        {
            try
            {
                long sum = 0, n = 0;
                for (int y = bmp.Height / 2; y < bmp.Height; y += 4)
                {
                    for (int x = 2; x < bmp.Width; x += 4)
                    {
                        Color c = bmp.GetPixel(x, y);
                        if (c.A < 20) continue;
                        sum += (c.R + c.G + c.B) / 3;
                        n++;
                    }
                }
                return n > 0 && (sum / n) > 140;
            }
            catch { return false; }
        }

        private static BowlAsset Fail(string key, string error)
        {
            BowlAsset a = Load(DefaultId);
            a.Id = key;
            a.Ok = false;
            a.Error = error;
            a.Source = "fallback";
            return a;
        }
    }

    /// <summary>米饭 11 档（fill 0..1 十等分）预渲染位图缓存，60fps 只 blit。</summary>
    internal static class RiceCache
    {
        private static readonly object s_gate = new object();
        private static readonly Dictionary<string, Bitmap> s_cache = new Dictionary<string, Bitmap>();

        /// <summary>饭桶资源被替换时清掉对应米饭位图缓存。</summary>
        public static void ClearForAssets(List<string> assetIds)
        {
            if (assetIds == null || assetIds.Count == 0) return;
            lock (s_gate)
            {
                List<string> dead = new List<string>();
                foreach (KeyValuePair<string, Bitmap> kv in s_cache)
                {
                    foreach (string id in assetIds)
                    {
                        if (kv.Key.StartsWith(id + "|", StringComparison.Ordinal)) { dead.Add(kv.Key); break; }
                    }
                }
                foreach (string k in dead)
                {
                    Bitmap b = s_cache[k];
                    s_cache.Remove(k);
                    try { b.Dispose(); } catch { }
                }
            }
        }

        public static Bitmap Get(string assetId, int level, int w, int h)
        {
            return Get(assetId, level, w, h, false);
        }

        private static readonly object s_masterGate = new object();
        private static readonly Dictionary<int, Bitmap> s_master = new Dictionary<int, Bitmap>();

        private static string RiceSpriteDir()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string builtin = Path.Combine(baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), "rice");
            if (File.Exists(Path.Combine(builtin, "rice-10.png"))) return builtin;
            string user = Path.Combine(Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh"), "pet-balance-panel"), "rice");
            if (File.Exists(Path.Combine(user, "rice-10.png"))) return user;
            return "";
        }

        private static readonly object s_moundGate = new object();
        private static Bitmap s_mound;

        private static Bitmap MasterMound()
        {
            lock (s_moundGate)
            {
                if (s_mound != null) return s_mound;
                string dir = RiceSpriteDir();
                if (dir.Length == 0) return null;
                string p = Path.Combine(dir, "rice-master.png");
                if (!File.Exists(p)) return null;
                s_mound = new Bitmap(new MemoryStream(File.ReadAllBytes(p)));
                return s_mound;
            }
        }

        private static Bitmap MasterSprite(int level)
        {
            lock (s_masterGate)
            {
                Bitmap b;
                if (s_master.TryGetValue(level, out b)) return b;
                string dir = RiceSpriteDir();
                if (dir.Length == 0) return null;
                string p = Path.Combine(dir, string.Format(CultureInfo.InvariantCulture, "rice-{0:00}.png", level));
                if (!File.Exists(p)) return null;
                byte[] bytes = File.ReadAllBytes(p);
                b = new Bitmap(new MemoryStream(bytes));
                s_master[level] = b;
                return b;
            }
        }

        /// <summary>master 米堆贴图按目标宽度缩放（保持自然比例），用于按 fill 平移实现溢出。</summary>
        public static Bitmap GetMound(string assetId, int level, int w)
        {
            if (w < 8) w = 8;
            string key = "mound|" + assetId + "|" + level + "|" + w;
            lock (s_gate)
            {
                Bitmap bmp;
                if (s_cache.TryGetValue(key, out bmp)) return bmp;
                Bitmap master = MasterMound() ?? MasterSprite(level);
                if (master == null) return null;
                int hh = Math.Max(4, (int)Math.Round((double)master.Height * w / master.Width));
                bmp = new Bitmap(w, hh, PixelFormat.Format32bppPArgb);
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.DrawImage(master, new Rectangle(0, 0, w, hh), 0, 0, master.Width, master.Height, GraphicsUnit.Pixel);
                }
                if (s_cache.Count > 400)
                {
                    foreach (KeyValuePair<string, Bitmap> kv in s_cache) { try { kv.Value.Dispose(); } catch { } }
                    s_cache.Clear();
                }
                s_cache[key] = bmp;
                return bmp;
            }
        }

        public static Bitmap Get(string assetId, int level, int w, int h, bool lightBowl)
        {
            if (w < 6) w = 6;
            if (h < 6) h = 6;
            string key = assetId + "|" + level + "|" + w + "x" + h + (lightBowl ? "|L" : "|D");
            lock (s_gate)
            {
                Bitmap bmp;
                if (s_cache.TryGetValue(key, out bmp)) return bmp;
                Bitmap master = MasterSprite(level);
                if (master != null)
                {
                    bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.DrawImage(master, new Rectangle(0, 0, w, h), 0, 0, master.Width, master.Height, GraphicsUnit.Pixel);
                    }
                    s_cache[key] = bmp;
                    return bmp;
                }
                int ss = (w >= 48 || h >= 48) ? 2 : 1;
                Bitmap hi = Render(level, w * ss, h * ss, lightBowl);
                if (ss == 1) bmp = hi;
                else
                {
                    bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawImage(hi, new Rectangle(0, 0, w, h), 0, 0, hi.Width, hi.Height, GraphicsUnit.Pixel);
                    }
                    hi.Dispose();
                }
                if (s_cache.Count > 400)
                {
                    foreach (KeyValuePair<string, Bitmap> kv in s_cache) { try { kv.Value.Dispose(); } catch { } }
                    s_cache.Clear();
                }
                s_cache[key] = bmp;
                return bmp;
            }
        }

        private static Bitmap Render(int level, int w, int h, bool lightBowl)
        {
            Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            double fill = level / 10.0;
            if (fill <= 0.01) return bmp;
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                Random rnd = new Random(level * 997 + w * 7 + h);
                float cx = w / 2f;
                double surface = fill <= 0.6
                    ? h - (fill / 0.6) * h * 0.44
                    : h - h * 0.44 - ((fill - 0.6) / 0.4) * h * 0.32;
                float top = (float)surface;
                float halfW = w * 0.485f;
                Color riceBase = lightBowl ? Color.FromArgb(242, 239, 228) : Color.FromArgb(247, 245, 236);
                // 蓬松轮廓：大椭圆 + 多个错落小椭圆拼出起伏堆顶
                using (Region body = new Region())
                {
                    body.MakeEmpty();
                    using (GraphicsPath p = new GraphicsPath())
                    {
                        p.AddEllipse(cx - halfW, top, halfW * 2f, h - top + 2f);
                        body.Union(p);
                    }
                    int bumps = 9;
                    for (int i = 0; i < bumps; i++)
                    {
                        double t01 = rnd.NextDouble() * 2 - 1;
                        float bx = cx + (float)t01 * halfW * 0.74f;
                        float edge = (float)(1.0 - Math.Abs(t01));
                        float by = top + (1f - edge) * (h - top) * 0.22f + (float)(rnd.NextDouble() * 0.10 - 0.05) * (h - top);
                        float brx = halfW * (0.18f + (float)rnd.NextDouble() * 0.16f);
                        float bry = Math.Max(2f, (h - top) * (0.10f + (float)rnd.NextDouble() * 0.10f));
                        using (GraphicsPath p = new GraphicsPath())
                        {
                            p.AddEllipse(bx - brx, by - bry * 0.4f, brx * 2f, bry * 2f);
                            body.Union(p);
                        }
                    }
                    using (SolidBrush rb = new SolidBrush(riceBase)) g.FillRegion(rb, body);
                    // 浅灰缝隙（浅色碗更明显，避免白碗白饭糊在一起）
                    int gaps = Math.Max(80, (int)(w * h * 0.05));
                    int gapAlpha = lightBowl ? 120 : 85;
                    for (int i = 0; i < gaps; i++)
                    {
                        float gx = cx + (float)(rnd.NextDouble() * 2 - 1) * halfW;
                        float gy = top + (float)rnd.NextDouble() * (h - top);
                        if (!body.IsVisible(gx, gy)) continue;
                        float gr = Math.Max(0.6f, w * 0.010f);
                        using (SolidBrush gb = new SolidBrush(Color.FromArgb(gapAlpha, 150, 144, 128)))
                        {
                            g.FillEllipse(gb, gx - gr, gy - gr * 0.7f, gr * 2f, gr * 1.4f);
                        }
                    }
                    // 粒粒米：柔和明暗（无硬描边），缝隙靠底色露出来
                    int grains = Math.Max(120, (int)(w * (h - top) * 0.28));
                    for (int i = 0; i < grains; i++)
                    {
                        float gx = cx + (float)(rnd.NextDouble() * 2 - 1) * halfW * 0.98f;
                        float gy = top + (float)rnd.NextDouble() * (h - top);
                        if (!body.IsVisible(gx, gy)) continue;
                        float len = Math.Max(1.6f, w * 0.034f);
                        double a = rnd.NextDouble() * Math.PI;
                        float dx = (float)Math.Cos(a) * len / 2f;
                        float dy = (float)Math.Sin(a) * len / 2f;
                        using (SolidBrush sh = new SolidBrush(Color.FromArgb(lightBowl ? 90 : 70, 150, 144, 128)))
                        {
                            g.FillEllipse(sh, gx - dx - len * 0.30f, gy - dy + len * 0.30f, len * 0.75f, len * 0.42f);
                        }
                        using (SolidBrush bd = new SolidBrush(lightBowl ? Color.FromArgb(255, 250, 248, 240) : Color.FromArgb(255, 252, 251, 244)))
                        {
                            g.FillEllipse(bd, gx - dx, gy - dy, len * 0.78f, len * 0.46f);
                        }
                        using (SolidBrush hl = new SolidBrush(Color.FromArgb(150, 255, 255, 252)))
                        {
                            g.FillEllipse(hl, gx - dx * 0.4f - len * 0.10f, gy - dy * 0.4f - len * 0.10f, len * 0.34f, len * 0.20f);
                        }
                    }
                    // 要求：米堆上方不得有任何脱离米堆的悬浮点 → 不再画「冒粒」，
                    // 蓬松感只靠米堆轮廓自身的起伏 + 米粒缝隙表现。
                }
            }
            return bmp;
        }
    }

    internal sealed class BowlSlot
    {
        public int Index;
        public int X, Top, Bottom, BowlW, BowlH, Row;
        public int RiceX, RiceY, RiceW, RiceH, RimY;
    }

    internal sealed class BowlLayout
    {
        public string Style = "ricebowl";
        public BowlAsset Asset;
        public int Count;
        public float DpiScale = 1f;
        public double GraphicsScale = 1.0;
        public bool Compact, TwoRows, Pyramid;
        public int BowlW, BowlH, Gap, GroupW, GroupH, WheelH;
        public int FrontCount, RowShift, RowTotalH;
        public List<int> RowCounts = new List<int>(4);
        // 木牌几何（渲染与 --selftest 共用同一份计算，保证测试数字与实际一致）
        public float PlaqueScale = 1f;
        public float PlaqueH = 15f;
        public float PlaqueW = 40f;
        public float PlaqueGapBottom = 6f;
        public float PlaqueTopGap = 1f;
        public float PlaqueY = 0f;
        public float PlaqueRimBottom = 0f;
        public float PlaqueAmountPx = 9f;
        public float DotDiameter = 7.5f;
        public float DotCenterY = 0f;
        public float PlaqueNamePx = 8f;
        public float PlaqueNameY = 0f;
        public float PlaqueNameH = 0f;
        public float PlaqueNameBottomGap = 0f;
        public int PlaqueRimY = 0;
        public float PlaqueFrontFace = 0f;
        // v4 三款统一视觉：数值带（= L3 木牌带）几何；L1/L2 复用同一「名称/绿点/数值」三条带
        public float ValueBandY = 0f;
        public float ValueBandH = 0f;
        public int CapsuleW, CapsuleH, Step;
        public List<BowlSlot> Slots = new List<BowlSlot>(12);

        /// <summary>金字塔每排行数（底→顶）：k=最小整数使 k(k+1)/2>=n；依次取 min(剩余,k)、k-1…；9→4/3/2、8→4/3/1、7→4/3、6→3/2/1。</summary>
        public static int[] PyramidCounts(int n)
        {
            if (n < 1) n = 1;
            int k = 1;
            while (k * (k + 1) / 2 < n) k++;
            List<int> rows = new List<int>(k);
            int rem = n;
            int w = k;
            while (rem > 0 && w > 0)
            {
                int take = rem > w ? w : rem;
                rows.Add(take);
                rem -= take;
                w--;
            }
            return rows.ToArray();
        }

        public static BowlLayout Compute(Config cfg, int n, float dpiScale)
        {
            return Compute(cfg, n, dpiScale, 1.0, false);
        }

        public static BowlLayout Compute(Config cfg, int n, float dpiScale, double graphicsScale)
        {
            return Compute(cfg, n, dpiScale, graphicsScale, false);
        }

        public static BowlLayout Compute(Config cfg, int n, float dpiScale, double graphicsScale, bool forceNoWheels)
        {
            if (n < 1) n = 1;
            if (dpiScale <= 0f) dpiScale = 1f;
            BowlLayout lay = new BowlLayout();
            lay.Count = n;
            lay.DpiScale = dpiScale;
            if (graphicsScale < 0.2) graphicsScale = 1.0;
            lay.GraphicsScale = graphicsScale;
            int cw = 200, ch = 30, ov = 6;
            if (cfg != null && cfg.Capsule != null) { cw = cfg.Capsule.Width; ch = cfg.Capsule.Height; ov = cfg.Capsule.Overlap; }
            lay.CapsuleW = (int)Math.Round(cw * dpiScale);
            lay.CapsuleH = (int)Math.Round(ch * dpiScale);
            lay.Step = Math.Max(4, lay.CapsuleH - (int)Math.Round(ov * dpiScale));
            bool rice = cfg == null || cfg.Display == null || !string.Equals(cfg.Display.Style, "capsule", StringComparison.OrdinalIgnoreCase);
            if (!rice)
            {
                lay.Style = "capsule";
                lay.GroupW = lay.CapsuleW;
                lay.GroupH = lay.CapsuleH + (n - 1) * lay.Step;
                lay.RowCounts.Add(n);
                return lay;
            }
            lay.Style = "ricebowl";
            lay.Asset = BowlAssets.Get(cfg != null && cfg.Display != null ? cfg.Display.BowlStyle : "black");
            double px = graphicsScale * dpiScale;
            int compactAfter = cfg != null && cfg.Display != null ? cfg.Display.CompactAfter : 5;
            lay.Compact = n > Math.Max(2, compactAfter);
            bool wantTwoRows = cfg != null && cfg.Display != null
                && string.Equals(cfg.Display.NineLayout, "twoRows", StringComparison.OrdinalIgnoreCase);
            bool wantPyramid = cfg != null && cfg.Display != null
                && string.Equals(cfg.Display.NineLayout, "pyramid", StringComparison.OrdinalIgnoreCase);
            lay.Pyramid = lay.Compact && wantPyramid && n >= 6;
            lay.TwoRows = lay.Compact && wantTwoRows && n >= 6 && !lay.Pyramid;
            // 严格等比：盆宽 = 角色像素宽 × 0.80（设计基准 100%：77px → 62px；两档比例一致，测试 ±10%）
            int baseW = (int)Math.Round(77.0 * 0.80 * px);
            if (baseW < 46) baseW = 46;
            if (baseW > 190) baseW = 190;
            if (lay.Compact)
            {
                // 两排/金字塔每排最多 5/4 只 → 桶宽 0.92（比一排 0.80 大 15%，信息可读）；一排仍 0.80
                baseW = (int)Math.Round(baseW * ((lay.TwoRows || lay.Pyramid) ? 0.92 : 0.80));
                if (baseW < 40) baseW = 40;
            }
            lay.BowlW = baseW;
            lay.BowlH = lay.Asset != null && lay.Asset.PixelW > 0
                ? Math.Max(8, (int)Math.Round(baseW * lay.Asset.PixelH / (double)lay.Asset.PixelW))
                : Math.Max(8, (int)Math.Round(baseW * 0.65));
            lay.Gap = Math.Max(4, (int)Math.Round(6.0 * px));
            // v4：head（头顶）形态强制无轮子（与轮子彩蛋互斥；display.wheels 值保留，切回 feet 恢复）
            bool headWear = cfg != null && cfg.Display != null && string.Equals(cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase);
            lay.WheelH = (cfg != null && cfg.Display != null && cfg.Display.Wheels && !forceNoWheels && !headWear)
                ? Math.Max(3, (int)Math.Round(6.0 * px)) : 0;
            int riceTop = 0;
            if (lay.Asset != null && lay.Asset.PixelH > 0) riceTop = (int)Math.Round(lay.Asset.RiceY / lay.Asset.PixelH * lay.BowlH);
            lay.GroupH = lay.BowlH - riceTop + lay.WheelH;
            int overflowRoom = (int)Math.Round(lay.BowlH * 0.18);   // 给米堆溢出桶沿预留空间（避免顶部被裁平）
            lay.GroupH += overflowRoom;
            if (lay.GroupH < 12) lay.GroupH = lay.BowlH + lay.WheelH;
            int rowH = lay.BowlH + (lay.GroupH - lay.BowlH);
            if (lay.TwoRows)
            {
                lay.FrontCount = (n + 1) / 2;
                int back = n - lay.FrontCount;
                lay.RowCounts.Add(lay.FrontCount);
                lay.RowCounts.Add(back);
                int frontW = lay.FrontCount * lay.BowlW + (lay.FrontCount - 1) * lay.Gap;
                int backW = back > 0 ? back * lay.BowlW + (back - 1) * lay.Gap : 0;
                lay.GroupW = Math.Max(frontW, backW);
                lay.RowShift = (int)Math.Round(12.0 * px);
                lay.GroupH = lay.GroupH + lay.RowShift;
                for (int i = 0; i < back; i++)
                {
                    BowlSlot s = NewSlot(lay, lay.FrontCount + i, 0);
                    s.X = (lay.GroupW - backW) / 2 + i * (lay.BowlW + lay.Gap);
                    s.Bottom = lay.GroupH - lay.WheelH - lay.RowShift;
                    FillSlot(lay, s);
                    lay.Slots.Add(s);
                }
                for (int i = 0; i < lay.FrontCount; i++)
                {
                    BowlSlot s = NewSlot(lay, i, 1);
                    s.X = (lay.GroupW - frontW) / 2 + i * (lay.BowlW + lay.Gap);
                    s.Bottom = lay.GroupH - lay.WheelH;
                    FillSlot(lay, s);
                    lay.Slots.Add(s);
                }
            }
            else if (lay.Pyramid)
            {
                // v4.1 金字塔：底宽顶窄（9 家 4/3/2），每排水平居中、排间 12×px 错位（同两排口径），桶宽 0.92 不缩小。
                int[] counts = PyramidCounts(n);
                for (int ci = 0; ci < counts.Length; ci++) lay.RowCounts.Add(counts[ci]);
                int rows = counts.Length;
                lay.FrontCount = counts[0];
                // 3 排完整可读：排间纵向错位 = 桶高 + 米堆上方余量，保证前排队列不遮挡后排名牌/数值
                int overflowAbove = lay.GroupH - lay.BowlH - lay.WheelH;
                if (overflowAbove < 0) overflowAbove = 0;
                lay.RowShift = lay.BowlH + overflowAbove;
                int bottomW = counts[0] * lay.BowlW + (counts[0] - 1) * lay.Gap;
                lay.GroupW = bottomW;
                lay.GroupH = lay.GroupH + (rows - 1) * lay.RowShift;
                int pi = 0;
                for (int r = 0; r < rows; r++)          // r=0 最底排
                {
                    int cnt = counts[r];
                    int rowNo = rows - 1 - r;           // Row 0=最顶（先画/在后）
                    int rowW = cnt * lay.BowlW + (cnt - 1) * lay.Gap;
                    int x0 = (lay.GroupW - rowW) / 2;
                    for (int i = 0; i < cnt; i++)
                    {
                        BowlSlot s = NewSlot(lay, pi++, rowNo);
                        s.X = x0 + i * (lay.BowlW + lay.Gap);
                        s.Bottom = lay.GroupH - lay.WheelH - r * lay.RowShift;
                        FillSlot(lay, s);
                        lay.Slots.Add(s);
                    }
                }
            }
            else
            {
                lay.FrontCount = n;
                lay.RowCounts.Add(n);
                lay.GroupW = n * lay.BowlW + (n - 1) * lay.Gap;
                for (int i = 0; i < n; i++)
                {
                    BowlSlot s = NewSlot(lay, i, 1);
                    s.X = i * (lay.BowlW + lay.Gap);
                    s.Bottom = lay.GroupH - lay.WheelH;
                    FillSlot(lay, s);
                    lay.Slots.Add(s);
                }
            }
            lay.Slots.Sort(delegate(BowlSlot a, BowlSlot b)
            {
                if (a.Row != b.Row) return a.Row.CompareTo(b.Row);
                return a.X.CompareTo(b.X);
            });
            ComputePlaque(cfg, lay, px);
            return lay;
        }

        /// <summary>木牌几何：高/宽/底距随 graphicsScale 放大；紧凑档再缩 0.8，且木牌高 ≤ 盆前脸 65%。</summary>
        /// <summary>木牌几何（要求不遮碗沿）：宽 ≤ 盆宽 80%，上沿在前沿线最低点下方 +1px，
        /// 1:1 高 13~15px，下缘距盆底 ≥6×scale；渲染与 --selftest 共用。</summary>
        /// <summary>WCAG 相对对比度（用于名称刻字可读性 evidence）。</summary>
        internal static float ContrastRatio(Color a, Color b)
        {
            double la = RelLum(a), lb = RelLum(b);
            double hi = Math.Max(la, lb), lo = Math.Min(la, lb);
            return (float)((hi + 0.05) / (lo + 0.05));
        }

        internal static double RelLum(Color c)
        {
            double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0;
            r = r <= 0.03928 ? r / 12.92 : Math.Pow((r + 0.055) / 1.055, 2.4);
            g = g <= 0.03928 ? g / 12.92 : Math.Pow((g + 0.055) / 1.055, 2.4);
            b = b <= 0.03928 ? b / 12.92 : Math.Pow((b + 0.055) / 1.055, 2.4);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }

        private static void ComputePlaque(Config cfg, BowlLayout lay, double px)
        {
            float plaqueScale = (float)px;
            if (plaqueScale < 0.5f) plaqueScale = 0.5f;
            lay.PlaqueScale = plaqueScale;
            float namePx = (float)Math.Max(8.0, 8.0 * Math.Max(0.85, lay.GraphicsScale) * lay.DpiScale);
            float valPx = (float)Math.Max(9.0, 9.0 * Math.Max(0.85, lay.GraphicsScale) * lay.DpiScale);
            // v4.1：参考槽 = 最前排（Bottom 最大）；多排（twoRows/pyramid）时三款数值样式按「本桶自身」几何绘制，
            // 渲染时用 dy = slot.Bottom - 参考底边 平移（单排 dy=0，数值与旧版逐字段一致）。
            BowlSlot refSlot = null;
            for (int ri = 0; ri < lay.Slots.Count; ri++)
            {
                BowlSlot cand = lay.Slots[ri];
                if (refSlot == null || cand.Bottom > refSlot.Bottom) refSlot = cand;
            }
            int rimY = refSlot != null ? refSlot.RimY : 0;
            float rimBottom = rimY;
            if (refSlot != null && lay.Asset != null && lay.Asset.PixelH > 0)
            {
                rimBottom = refSlot.Top + lay.Asset.RimBottom / lay.Asset.PixelH * lay.BowlH;
            }
            float bottom = refSlot != null ? refSlot.Bottom : (lay.GroupH - lay.WheelH);
            float gapBottom = 6f * plaqueScale;
            float namePxF = (float)Math.Max(8.0, 8.0 * plaqueScale);
            float nameHGap = namePxF * 1.10f;                          // 名称有效字高
            float gapNamePlaque = 1.5f * plaqueScale;
            float gapBottomMin = 2f * plaqueScale;
            float th = (lay.Compact ? 12f : 13f) * plaqueScale;       // 1:1 高 13~15px
            float rimBottomG = rimBottom;
            float frontFace = Math.Max(4f, bottom - rimBottomG);
            // 名称(上)/绿点钮(中)/木牌(下) 三块各自居中；wrap 模式给鲸鱼留出上方空间
            float dotD = 4.0f * plaqueScale;                       // 绿点钮直径（1:1 ≈4px）
            bool wrapLogo = cfg != null && cfg.Display != null && cfg.Display.Logo
                && string.Equals(cfg.Display.LogoStyle, "wrap", StringComparison.OrdinalIgnoreCase);
            float nameCenter = rimBottomG + (bottom - rimBottomG) * (wrapLogo ? 0.50f : 0.30f);
            float plaqueCenter = rimBottomG + (bottom - rimBottomG) * (wrapLogo ? 0.80f : 0.64f);
            float nameY = nameCenter - nameHGap / 2f;
            float plaqueTop = plaqueCenter - th / 2f;
            float needGap = dotD + 3.0f * plaqueScale;
            if (plaqueTop - (nameY + nameHGap) < needGap)
            {
                float mid = (nameY + nameHGap + plaqueTop) / 2f;
                nameY = mid - needGap / 2f - nameHGap;
                plaqueTop = mid + needGap / 2f;
            }
            if (nameY < rimBottomG + gapBottomMin) nameY = rimBottomG + gapBottomMin;
            if (plaqueTop + th > bottom - gapBottomMin) plaqueTop = bottom - gapBottomMin - th;
            float plaqueBottom = plaqueTop + th;
            lay.PlaqueH = th;
            // 木牌宽度随桶宽/字号等比（原来固定 40 不随缩放变，200% 时金额溢出、主题亮度占比也过低）：
            // 宽 ≈ 桶宽 62%，且不小于 36×plaqueScale，不超桶宽 − 2×plaqueScale（与测试木牌矩形口径同源）
            float plqW = Math.Max(lay.BowlW * 0.78f, valPx * 3.4f);
            float plqWMin = 36f * plaqueScale;
            if (plqW < plqWMin) plqW = plqWMin;
            float plqWMax = lay.BowlW - 2f * plaqueScale;
            if (plqW > plqWMax) plqW = plqWMax;
            lay.PlaqueW = plqW;
            lay.PlaqueGapBottom = Math.Max(0f, bottom - plaqueBottom);
            lay.PlaqueRimY = (int)Math.Round(rimBottomG);
            lay.PlaqueFrontFace = frontFace;
            lay.PlaqueNamePx = namePxF;
            lay.PlaqueNameH = nameHGap;
            lay.PlaqueNameY = nameY;
            lay.PlaqueNameBottomGap = bottom - plaqueBottom;
            lay.PlaqueTopGap = 1f;
            lay.PlaqueY = plaqueTop;
            lay.ValueBandY = plaqueTop;
            lay.ValueBandH = th;
            lay.PlaqueRimBottom = rimBottomG;
            lay.PlaqueAmountPx = (float)Math.Max(9.0, 9.0 * plaqueScale);
            lay.DotDiameter = dotD;
            lay.DotCenterY = (nameY + nameHGap + plaqueTop) / 2f;
            string ls = cfg != null && cfg.Display != null ? cfg.Display.LabelStyle : "L3";
            if (ls != "L3") { lay.PlaqueH = 0f; }
        }

        private static BowlSlot NewSlot(BowlLayout lay, int index, int row)
        {
            BowlSlot s = new BowlSlot();
            s.Index = index;
            s.Row = row;
            s.BowlW = lay.BowlW;
            s.BowlH = lay.BowlH;
            return s;
        }

        private static void FillSlot(BowlLayout lay, BowlSlot s)
        {
            s.Top = s.Bottom - s.BowlH;
            BowlAsset a = lay.Asset;
            if (a != null && a.PixelW > 0 && a.PixelH > 0)
            {
                float sx = s.BowlW / (float)a.PixelW;
                float sy = s.BowlH / (float)a.PixelH;
                s.RiceX = s.X + (int)Math.Round(a.RiceX * sx);
                s.RiceY = s.Top + (int)Math.Round((a.RiceY - a.RiceY) * 0 + a.RiceY * sy);
                s.RiceW = Math.Max(4, (int)Math.Round(a.RiceW * sx));
                s.RiceH = Math.Max(4, (int)Math.Round(a.RiceH * sy));
                s.RimY = s.Top + (int)Math.Round(a.RimY * sy);
            }
            else
            {
                s.RiceX = s.X + s.BowlW / 5;
                s.RiceY = s.Top + s.BowlH / 5;
                s.RiceW = s.BowlW * 3 / 5;
                s.RiceH = s.BowlH * 3 / 5;
                s.RimY = s.Top + s.BowlH * 2 / 5;
            }
        }

        /// <summary>行数（底→顶）文本，如 pyramid 4/3/2 输出 "4,3,2"；单排输出 "n"。</summary>
        public string RowCountsText()
        {
            if (RowCounts == null || RowCounts.Count == 0) return Count.ToString(CultureInfo.InvariantCulture);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < RowCounts.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(RowCounts[i].ToString(CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }

        public string Signature(Config cfg, int n, bool expanded)
        {
            return string.Format(CultureInfo.InvariantCulture, "{0}/{1}/{2}#{3}#{4}/{5:0.###}",
                Style, n, GroupW, GroupH, expanded ? 1 : 0, GraphicsScale);
        }

        internal static int ScaleI(int design, float scale)
        {
            int v = (int)Math.Round(design * scale);
            return v < 1 ? 1 : v;
        }
    }

    // ================================================================== 饭桶位置两态（feet/head）几何：渲染、定位与 --selftest 同源
    internal static class WearMath
    {
        public static bool IsHead(Config cfg)
        {
            return cfg != null && cfg.Display != null && string.Equals(cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>头顶模式盆底与头顶的重叠接触像素（默认 3×dpi，与 feet 的 contact 同口径）。</summary>
        public static int ContactPx(float dpiScale)
        {
            int v = (int)Math.Round(3.0 * dpiScale);
            return v < 1 ? 1 : v;
        }

        /// <summary>feet 模式桌宠抬升量 = 6×dpi + 盆组高（现有口径，两态同源保留）。</summary>
        public static int FeetLift(BowlLayout lay, float dpiScale)
        {
            int v = (int)Math.Round(6.0 * dpiScale);
            return v + (lay != null ? lay.GroupH : 0);
        }

        /// <summary>feet 模式面板底边 = 工作区底 − bottomGap。</summary>
        public static int FeetPanelBottom(Config cfg, int workBottom)
        {
            int gap = cfg != null && cfg.Position != null ? cfg.Position.BottomGap : 8;
            if (gap < 0) gap = 0;
            return workBottom - gap;
        }

        /// <summary>head 模式面板顶边 = 头顶屏幕 y − 面板高 + contact，再 clamp 进 [workTop, monBottom−高]（贴边 clamp）。</summary>
        public static int HeadPanelY(int headScreenY, int panelHeight, int contactPx, int workTop, int monBottom)
        {
            int y = headScreenY - panelHeight + contactPx;
            int maxY = monBottom - panelHeight;
            if (maxY < workTop) maxY = workTop;
            if (y < workTop) y = workTop;
            if (y > maxY) y = maxY;
            return y;
        }
    }

    // ================================================================== 字体缓存
    internal static class V3Fonts
    {
        private static readonly object s_gate = new object();
        private static readonly Dictionary<string, Font> s_fonts = new Dictionary<string, Font>();
        private static string s_family;

        public static string Family()
        {
            lock (s_gate)
            {
                if (s_family != null) return s_family;
                string[] candidates = new string[] { "Microsoft YaHei UI", "Microsoft YaHei", "微软雅黑", "Segoe UI", "Arial" };
                for (int i = 0; i < candidates.Length; i++)
                {
                    try
                    {
                        using (FontFamily ff = new FontFamily(candidates[i])) { s_family = ff.Name; return s_family; }
                    }
                    catch { }
                }
                s_family = FontFamily.GenericSansSerif.Name;
                return s_family;
            }
        }

        public static Font Get(float pixelSize, FontStyle style)
        {
            if (pixelSize < 5f) pixelSize = 5f;
            string key = ((int)Math.Round(pixelSize * 10)) + "|" + (int)style;
            lock (s_gate)
            {
                Font f;
                if (s_fonts.TryGetValue(key, out f)) return f;
                f = new Font(Family(), pixelSize, style, GraphicsUnit.Pixel);
                s_fonts[key] = f;
                return f;
            }
        }
    }

    /// <summary>精灵渲染：碗 PNG 拉伸 + 11 档米饭位图 + 三种柔和数值样式 + 轮子彩蛋。</summary>
    internal static class BowlRenderer
    {
        public static Bitmap Render(Config cfg, ProviderView[] views, BowlLayout lay, VisualStyle style, float dpiScale)
        {
            if (lay.GroupW < 1 || lay.GroupH < 1) return new Bitmap(1, 1, PixelFormat.Format32bppPArgb);
            Bitmap bmp = new Bitmap(lay.GroupW, lay.GroupH, PixelFormat.Format32bppPArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                Prepare(g);
                g.Clear(Color.Transparent);
                // 要求：桶底不要明显投影（去掉组底黑影）

                for (int i = 0; i < lay.Slots.Count; i++)
                {
                    BowlSlot slot = lay.Slots[i];
                    ProviderView v = (slot.Index >= 0 && slot.Index < views.Length) ? views[slot.Index] : null;
                    DrawSlot(g, cfg, lay, slot, v, style, dpiScale);
                }
            }
            return bmp;
        }

        private static void Prepare(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        }

        private static void DrawSlot(Graphics g, Config cfg, BowlLayout lay, BowlSlot slot, ProviderView v,
            VisualStyle style, float dpiScale)
        {
            double px = lay.GraphicsScale * dpiScale;
            // 轮子（盆底）：按 slot 相对坐标附着在每只盆下方（单排 / 两排 Row=0/1 各自附着）；
            // 静态首帧固定 angle=0，与 WithWheels 旋转帧共用同一个 DrawWheel，保证首帧外观一致。
            if (lay.WheelH > 0)
            {
                float wr = lay.WheelH * 0.46f;
                float wy = slot.Bottom + lay.WheelH * 0.60f;
                DrawWheel(g, slot.X + slot.BowlW * 0.27f, wy, wr, style, 0f);
                DrawWheel(g, slot.X + slot.BowlW * 0.73f, wy, wr, style, 0f);
            }
            // 碗后层（内壁）：先画，米饭再盖上去，最后画前层壳/前沿 → 米被碗沿自然压住
            BowlAsset a = lay.Asset;
            Rectangle dest = new Rectangle(slot.X, slot.Top, slot.BowlW, slot.BowlH);
            if (a != null && a.BackBitmap != null)
            {
                g.DrawImage(a.BackBitmap, dest, 0, 0, a.BackBitmap.Width, a.BackBitmap.Height, GraphicsUnit.Pixel);
            }
            // 米饭：用 AI 米堆贴图（master）按 fill 平移 → 溢出高度 = fill × maxOverflow（maxOverflow=45% 盆前脸）
            if (v != null && (v.Rice || v.Ratio > 0.015))
            {
                int level = v.Rice ? 10 : (int)Math.Round(Math.Max(0, Math.Min(1, v.Ratio)) * 10);
                if (level > 0)
                {
                    float fill = v.Rice ? 1f : (float)Math.Max(0, Math.Min(1, v.Ratio));
                    float rimBottomG = slot.RimY;
                    if (a != null && a.PixelH > 0) rimBottomG = slot.Top + a.RimBottom / a.PixelH * slot.BowlH;
                    float bowlBottom = slot.Bottom;
                    float frontFace = Math.Max(4f, bowlBottom - rimBottomG);
                    float maxOverflow = 0.45f * frontFace;                  // 前脸 45%
                    float baseY = rimBottomG - 2f;                          // 米饭基准：前沿线最低点上 2px
                    if (baseY > bowlBottom) baseY = bowlBottom;
                    float surface = baseY - fill * maxOverflow;             // fill≥0.8 时溢出 ≥36% 前脸
                    Bitmap rice = RiceCache.GetMound(a != null ? a.Id : "black", level, slot.RiceW);
                    if (rice != null)
                    {
                        int dy = (int)Math.Round(surface);
                        g.DrawImageUnscaled(rice, slot.RiceX, dy);
                    }
                }
            }
            // 碗前层（壳 + 前沿）：盖住米饭下缘，形成「盛在碗里」
            if (a != null && a.Bitmap != null)
            {
                g.DrawImage(a.Bitmap, dest, 0, 0, a.PixelW, a.PixelH, GraphicsUnit.Pixel);
            }
            // 数值样式
            if (v != null) DrawLabel(g, cfg, lay, slot, v, a, style, dpiScale);
        }

        // ---------------- 三种数值样式 ----------------
        private static void DrawLabel(Graphics g, Config cfg, BowlLayout lay, BowlSlot slot, ProviderView v,
            BowlAsset a, VisualStyle style, float dpiScale)
        {
            double px = lay.GraphicsScale * dpiScale;
            string labelStyle = cfg != null && cfg.Display != null ? cfg.Display.LabelStyle : "L1";
            float scale = (float)Math.Max(0.85, lay.GraphicsScale) * dpiScale;
            float namePx = Math.Max(8.0f, 8.0f * scale);   // 可读下限：家名 ≥8px
            float valPx = Math.Max(9.0f, 9.0f * scale);
            string name = v.Name ?? "";
            string val = ValueText(v);
            bool lightBody = a != null && a.LightBody;
            Color nameCol, valCol, shadowCol, dot;
            LabelColors(cfg, v, a, style, out nameCol, out valCol, out shadowCol, out dot);
            float cx = slot.X + slot.BowlW / 2f;
            float rimY = slot.RimY;
            float bottom = slot.Bottom;
            float avail = Math.Max(4f, bottom - rimY);
            Font nameF = V3Fonts.Get(namePx, FontStyle.Regular);
            Font valF = V3Fonts.Get(valPx, FontStyle.Bold);
            using (StringFormat lf = new StringFormat())
            {
                lf.Alignment = StringAlignment.Center;
                lf.LineAlignment = StringAlignment.Center;
                lf.Trimming = StringTrimming.EllipsisCharacter;
                lf.FormatFlags = StringFormatFlags.NoWrap;
                if (labelStyle == "L2")
                {
                    // L2 饭票小旗（v4 统一视觉）：自适应旗宽 + 缩字保完整可读；绿点统一 4·s。
                    // 几何与 --selftest 共用同一份 MeasureFlag（渲染/交付数字同源）。
                    FlagMetrics fm = MeasureFlag(g, lay, slot, v, scale);
                    float fw = fm.Width;
                    float fh = fm.Height;
                    float px0 = fm.Px0;
                    float topY = fm.TopY;
                    using (Pen pole = new Pen(Color.FromArgb(245, 150, 138, 118), Math.Max(1f, scale)))
                    {
                        g.DrawLine(pole, px0 + fw * 0.5f, topY + fh - 1f, px0 + fw * 0.5f, topY + fh + 5f);
                    }
                    using (GraphicsPath flag = RoundedRect(px0 + 0.5f, topY, fw, fh, Math.Max(1.5f, scale * 1.2f)))
                    {
                        using (SolidBrush fb = new SolidBrush(Color.FromArgb(250, 250, 247, 239))) g.FillPath(fb, flag);
                        using (Pen fp = new Pen(Color.FromArgb(245, 182, 172, 154), Math.Max(1f, 0.8f * scale))) g.DrawPath(fp, flag);
                    }
                    using (SolidBrush nb = new SolidBrush(FlagNameInk))
                    {
                        g.DrawString(fm.NameText, fm.NameFont, nb, fm.NameRect, lf);
                    }
                    using (SolidBrush vb = new SolidBrush(lightBody ? Color.FromArgb(255, 56, 50, 40) : Color.FromArgb(255, 60, 54, 44)))
                    {
                        g.DrawString(fm.ValText, fm.ValFont, vb, fm.ValRect, lf);
                    }
                    // 统一绿点：直径 4·s，旗内右上，距边 1.5·s（与 L3 同款暗影+亮边+高光）
                    DrawStatusDot(g, fm.DotCx, fm.DotCy, fm.DotD, dot, scale);
                }
                else if (labelStyle == "L3")
                {
                    // L3 盆沿木牌（定稿）：牌内只含「状态点 + ¥金额」；名称刻在牌下方碗身上
                    float plaqueScale = lay.PlaqueScale;
                    float th = lay.PlaqueH;
                    float gapBottom = lay.PlaqueGapBottom;
                    float tw = lay.PlaqueW;
                    float tx = cx - tw / 2f;
                    float refBottom3 = lay.GroupH - lay.WheelH;
                    float dy3 = bottom - refBottom3;           // 本排在组内的纵向偏移（单排=0）
                    float ty = (lay.PlaqueY > 0f ? lay.PlaqueY : rimY + lay.PlaqueTopGap) + dy3;
                    if (ty + th > bottom - gapBottom) ty = bottom - gapBottom - th;
                    // THEME-12：木牌底色/描边/投影改为读主题 palettes（深色=深胡桃木牌，浅色=浅桦木牌）；
                    // 主题切换时木牌亮度差 ≥0.30，仍是木色（paper/sheet 与 warn 木色混合 + 木纹），不是纯黑/纯白方块。
                    Color tagFill = WoodPlaqueFill(style, a);
                    Color tagBorder = WoodPlaqueBorder(style);
                    Color tagShadow = WoodPlaqueShadow(style);
                    float corner = Math.Max(2f, scale * 1.8f);
                    using (SolidBrush sb = new SolidBrush(tagShadow))
                    {
                        g.FillPath(sb, RoundedRect(tx + scale * 0.7f, ty + scale * 1.6f, tw, th, corner));
                    }
                    using (GraphicsPath path = RoundedRect(tx, ty, tw, th, corner))
                    {
                        using (SolidBrush fb = new SolidBrush(tagFill)) g.FillPath(fb, path);
                        DrawWoodGrain(g, tx, ty, tw, th, scale, style);
                        using (Pen bp = new Pen(tagBorder, Math.Max(1f, 0.7f * scale))) g.DrawPath(bp, path);
                    }
                    // 木牌内只留 ¥金额（点已移出木牌）
                    float valAreaX = tx + 2.0f * scale;
                    float valAreaW = tx + tw - 4.0f * scale - valAreaX;
                    Font valF3 = FitText(g, valF, val, valAreaW - 2f * scale, Math.Max(9f, lay.PlaqueAmountPx * 0.70f));
                    // 金额颜色读主题 palettes：正常=AmountColor / 低额=LowColor / 断线=FailColor / 大白饭=DotRice，
                    // 再按木牌底色补足对比度（金额可读，低额红字/断线灰字/大白饭色语义不变）
                    Color ink;
                    if (v.Low) ink = style.LowColor;
                    else if (v.Rice) ink = style.DotRice;
                    else if (!v.HasResult || !v.Ok) ink = style.FailColor;
                    else ink = style.AmountColor;
                    ink = EnsureContrast(ink, tagFill, 4.5);
                    using (StringFormat vf = new StringFormat())
                    {
                        vf.Alignment = StringAlignment.Center;
                        vf.LineAlignment = StringAlignment.Center;
                        vf.Trimming = StringTrimming.None;
                        vf.FormatFlags = StringFormatFlags.NoWrap;
                        using (SolidBrush vb = new SolidBrush(ink))
                        {
                            // 用 PointF + 居中格式绘制，避免矩形裁剪把金额两端切掉
                            g.DrawString(val, valF3, vb, new PointF(cx, ty + th * 0.5f), vf);
                        }
                    }
                    // 名称：刻在木牌下方碗身上（双偏移刻痕：暗+亮，低透明度，无发光）
                    // NAME-AUTOFIT：长名自动缩字号（下限 7px×scale）；缩到下限仍放不下才中间省略（留头尾）；
                    // 自适应宽度按测试判据可用带（≈BowlW*0.9351）再留左右 ≥1px 与刻痕阴影余量。
                    if (name.Length > 0)
                    {
                        NameFitInfo fit = FitNameForSlot(g, lay, cfg, v, scale);
                        LogNameFitIfChanged(fit, name, style != null ? style.Theme : "dark");
                        bool wrapLogoDraw = fit.WrapLogo;
                        bool brandLogo = fit.BrandLogo;
                        float nameCenterX = brandLogo ? cx + lay.BowlW * 0.16f : cx;
                        float nameW = fit.MaxW;
                        float nameY = lay.PlaqueNameY > 0 ? (lay.PlaqueNameY + dy3) : (ty + th + 1.2f * plaqueScale);
                        float nh = lay.PlaqueNameH > 0 ? lay.PlaqueNameH : fit.FitPx * 0.9f;
                        float ny = nameY;
                        if (ny + nh > ty - 0.5f * plaqueScale) ny = Math.Max(rimY + 0.5f * plaqueScale, ty - 0.5f * plaqueScale - nh);
                        float maxNy = bottom - 0.5f * plaqueScale - nh;
                        if (ny > maxNy) ny = maxNy;
                        // 绘制矩形比自适应宽度再宽 4px：文字已按宽度缩/省略，矩形不会裁掉文字
                        RectangleF nameRect = new RectangleF(nameCenterX - (nameW + 4f) / 2f, ny, nameW + 4f, nh);
                        // 刻字色仍按桶身明暗自适应（浅瓷=深暖灰、深桶=浅灰），再按主题微调，和木牌/主题协调
                        Color engrave;
                        Color dark;
                        Color light;
                        if (lightBody)
                        {
                            engrave = Color.FromArgb(232, 150, 140, 124);
                            dark = Color.FromArgb(150, 92, 84, 70);
                            light = Color.FromArgb(130, 255, 252, 244);
                        }
                        else
                        {
                            engrave = Color.FromArgb(235, 168, 174, 184);
                            dark = Color.FromArgb(160, 12, 14, 18);
                            light = Color.FromArgb(120, 235, 240, 246);
                        }
                        if (style != null && style.Light)
                        {
                            engrave = Mix(engrave, style.AmountColor, 0.10f);
                            dark = Mix(dark, style.AmountColor, 0.06f);
                        }
                        else if (style != null)
                        {
                            engrave = Mix(engrave, style.PlaqueBorder, 0.08f);
                        }
                        if (wrapLogoDraw)
                        {
                            float rimBot = slot.RimY;
                            if (a != null && a.PixelH > 0) rimBot = slot.Top + a.RimBottom / a.PixelH * slot.BowlH;
                            float bandTop = rimBot + (bottom - rimBot) * 0.06f;
                            float bandH = (bottom - rimBot) * 0.34f;
                            Color wcol = (cfg.Display.BowlStyle ?? "porcelain").ToLowerInvariant() == "black"
                                ? Color.FromArgb(240, 214, 158, 62)
                                : (string.Equals(cfg.Display.BowlStyle, "steel", StringComparison.OrdinalIgnoreCase)
                                    ? Color.FromArgb(245, 236, 242, 248) : Color.FromArgb(238, 43, 92, 158));
                            DrawWhaleWrap(g, cx, bandTop, lay.BowlW, bandH, scale, wcol);
                        }
                        if (brandLogo)
                        {
                            float logoW = lay.BowlW * 0.24f;
                            Color whaleCol;
                            string bs = (cfg.Display.BowlStyle ?? "porcelain").ToLowerInvariant();
                            if (bs == "black") whaleCol = Color.FromArgb(240, 214, 158, 62);        // 暖金
                            else if (bs == "steel") whaleCol = Color.FromArgb(245, 236, 242, 248);  // 白/亮银
                            else whaleCol = Color.FromArgb(238, 43, 92, 158);                      // 青花蓝（porcelain）
                            DrawWhaleLogo(g, cx - lay.BowlW * 0.19f, ny + nh * 0.52f, logoW, scale, whaleCol);
                        }
                        using (StringFormat nf = new StringFormat())
                        {
                            nf.Alignment = StringAlignment.Center;
                            nf.LineAlignment = StringAlignment.Center;
                            nf.Trimming = StringTrimming.None;
                            nf.FormatFlags = StringFormatFlags.NoWrap;
                            float off = Math.Max(0.6f, 0.7f * scale);
                            using (SolidBrush b1 = new SolidBrush(dark))
                            {
                                g.DrawString(fit.DrawText, fit.Font, b1, new RectangleF(nameRect.X + off, nameRect.Y + off, nameRect.Width, nameRect.Height), nf);
                            }
                            using (SolidBrush b2 = new SolidBrush(light))
                            {
                                g.DrawString(fit.DrawText, fit.Font, b2, new RectangleF(nameRect.X - off, nameRect.Y - off, nameRect.Width, nameRect.Height), nf);
                            }
                            using (SolidBrush b3 = new SolidBrush(engrave))
                            {
                                g.DrawString(fit.DrawText, fit.Font, b3, nameRect, nf);
                            }
                        }
                    }
                    // 保温按钮式绿点钮：名称与木牌之间，垂直/水平居中，1px 亮边+轻高光
                    {
                        float dotD2 = lay.DotDiameter > 0 ? lay.DotDiameter : 7.5f * plaqueScale;
                        float dr = dotD2 / 2f;
                        float dcx = cx;
                        float dcy = lay.DotCenterY > 0 ? (lay.DotCenterY + dy3) : (ty - dotD2 - 1.5f * plaqueScale);
                        using (SolidBrush sh = new SolidBrush(Color.FromArgb(70, 0, 0, 0)))
                        {
                            g.FillEllipse(sh, dcx - dr, dcy - dr + scale * 0.9f, dr * 2f, dr * 2f);
                        }
                        using (SolidBrush db2 = new SolidBrush(dot))
                        {
                            g.FillEllipse(db2, dcx - dr, dcy - dr, dr * 2f, dr * 2f);
                        }
                        using (Pen ed = new Pen(Color.FromArgb(205, 255, 255, 255), Math.Max(1f, 0.9f * scale)))
                        {
                            g.DrawEllipse(ed, dcx - dr, dcy - dr, dr * 2f, dr * 2f);
                        }
                        using (SolidBrush hl2 = new SolidBrush(Color.FromArgb(120, 255, 255, 255)))
                        {
                            g.FillEllipse(hl2, dcx - dr * 0.5f, dcy - dr * 0.6f, dr * 0.75f, dr * 0.6f);
                        }
                    }
                }
                else
                {
                    // L1 盆沿小字（v4 统一视觉）：名称/绿点/数值三条带与 L3 完全同高、均水平居中；无底板。
                    // 名称 = L3 刻字名同带；绿点 = L3 同名/同直径且居名称与数值之间；数值 = L3 木牌带中心。
                    float refBottom1 = lay.GroupH - lay.WheelH;
                    float dy1 = bottom - refBottom1;             // 本排纵向偏移（单排=0）
                    float ny = lay.PlaqueNameY > 0f ? (lay.PlaqueNameY + dy1) : rimY + avail * 0.18f;
                    float nh = lay.PlaqueNameH > 0f ? lay.PlaqueNameH : namePx * 1.10f;
                    NameFitInfo fit = FitNameForSlot(g, lay, cfg, v, scale);
                    float nw = fit.InkW > 0f ? fit.InkW : slot.BowlW - 4f * scale;
                    // 默认 StringFormat 绘制含边距 → 用保守测量（默认 MeasureString）兜住，防 CJK 被误省略
                    float nwSafe = Math.Max(nw, MeasureInk(g, fit.DrawText, fit.Font));
                    float nhSafe = Math.Max(nh, fit.Font != null ? fit.Font.GetHeight(g) : nh);
                    float nOff = Math.Max(0.6f, 0.7f * scale);
                    using (SolidBrush shb = new SolidBrush(shadowCol))
                    {
                        g.DrawString(fit.DrawText, fit.Font, shb, new RectangleF(cx - nwSafe / 2f + nOff, ny - (nhSafe - nh) / 2f + nOff, nwSafe + 4f, nhSafe), lf);
                    }
                    using (SolidBrush nb = new SolidBrush(nameCol))
                    {
                        g.DrawString(fit.DrawText, fit.Font, nb, new RectangleF(cx - nwSafe / 2f, ny - (nhSafe - nh) / 2f, nwSafe + 4f, nhSafe), lf);
                    }
                    // 绿点：与 L3 同位置/同直径（名称与数值之间，水平居中；不再偏在数值左侧）
                    float dotD1 = lay.DotDiameter > 0f ? lay.DotDiameter : 4f * scale;
                    float dcy1 = lay.DotCenterY > 0f ? (lay.DotCenterY + dy1) : (ny + nh + bottom) / 2f;
                    DrawStatusDot(g, cx, dcy1, dotD1, dot, scale);
                    // 数值：与 L3 木牌带同中心，水平居中；缩字保证完整显示
                    float areaW = Math.Max(8f, slot.BowlW - 4f * scale);
                    bool vShrunk, vEll;
                    Font valF1 = FitTextEx(g, valF, val, areaW, Math.Max(7f, valPx * 0.75f), out vShrunk, out vEll);
                    float vh = lay.ValueBandH > 0f ? Math.Max(lay.ValueBandH, valPx * 1.05f) : valPx * 1.15f;
                    float vcy = lay.ValueBandH > 0f ? (lay.ValueBandY + lay.ValueBandH / 2f + dy1) : (rimY + avail * 0.62f);
                    float vy = vcy - vh / 2f;
                    float maxVy = bottom - vh;
                    if (vy > maxVy) vy = maxVy;
                    if (vy < rimY) vy = rimY;
                    float vOff = Math.Max(0.6f, 0.7f * scale);
                    using (SolidBrush shb = new SolidBrush(shadowCol))
                    {
                        g.DrawString(val, valF1, shb, new RectangleF(cx - areaW / 2f + vOff, vy + vOff, areaW, vh), lf);
                    }
                    using (SolidBrush vb = new SolidBrush(valCol))
                    {
                        g.DrawString(val, valF1, vb, new RectangleF(cx - areaW / 2f, vy, areaW, vh), lf);
                    }
                }
            }
        }

        /// <summary>按可用宽度自动微缩字号（不低于 floorPx），保证文字不被省略号截断。</summary>
        private static Font FitText(Graphics g, Font baseFont, string text, float maxW, float floorPx)
        {
            if (string.IsNullOrEmpty(text) || maxW <= 2f) return baseFont;
            Font f = baseFont;
            float size = baseFont.Size;
            try
            {
                while (size > floorPx)
                {
                    float w = g.MeasureString(text, f).Width;   // 用默认测量（含边距，保守防裁切）
                    if (w <= maxW) return f;
                    size -= 0.5f;
                    if (size < floorPx) size = floorPx;
                    f = V3Fonts.Get(size, baseFont.Style);
                }
            }
            catch { }
            return f;
        }

        // ============================ v4 三款统一视觉：共用配色/测量/旗面几何/离线度量 ============================

        /// <summary>L2 旗面名称墨色（白纸旗上的深暖灰，对比度 ≥4.5）。</summary>
        internal static readonly Color FlagNameInk = Color.FromArgb(255, 118, 108, 90);

        /// <summary>三款共用：名称/数值/阴影/绿点配色（语义不变；浅瓷转深字）。</summary>
        internal static void LabelColors(Config cfg, ProviderView v, BowlAsset a, VisualStyle style,
            out Color nameCol, out Color valCol, out Color shadowCol, out Color dot)
        {
            bool lightBody = a != null && a.LightBody;
            if (v.Rice)
            {
                nameCol = lightBody ? Color.FromArgb(255, 120, 96, 52) : Color.FromArgb(255, 238, 205, 140);
                valCol = nameCol;
                shadowCol = lightBody ? Color.FromArgb(150, 255, 255, 255) : Color.FromArgb(190, 0, 0, 0);
            }
            else if (!v.HasResult || !v.Ok)
            {
                nameCol = lightBody ? Color.FromArgb(255, 104, 110, 122) : Color.FromArgb(255, 196, 202, 214);
                valCol = nameCol;
                shadowCol = lightBody ? Color.FromArgb(150, 255, 255, 255) : Color.FromArgb(190, 0, 0, 0);
            }
            else if (v.Low)
            {
                nameCol = lightBody ? Color.FromArgb(255, 168, 46, 40) : Color.FromArgb(255, 255, 158, 148);
                valCol = nameCol;
                shadowCol = lightBody ? Color.FromArgb(140, 255, 255, 255) : Color.FromArgb(190, 0, 0, 0);
            }
            else
            {
                nameCol = lightBody ? Color.FromArgb(255, 72, 64, 52) : Color.FromArgb(255, 246, 242, 232);
                valCol = lightBody ? Color.FromArgb(255, 48, 42, 34) : Color.FromArgb(255, 252, 249, 242);
                shadowCol = lightBody ? Color.FromArgb(160, 255, 255, 255) : Color.FromArgb(200, 0, 0, 0);
            }
            dot = v.Rice ? style.DotRice
                : (!v.HasResult || !v.Ok ? style.DotGrey : (v.Low ? style.DotRed : style.DotGreen));
        }

        /// <summary>保守墨宽：用默认 StringFormat 测量（含绘制边距，防 CJK 因 typographic 口径差异被误省略/不渲染）。</summary>
        private static float MeasureInk(Graphics g, string text, Font f)
        {
            if (g == null || string.IsNullOrEmpty(text) || f == null) return 0f;
            try
            {
                return g.MeasureString(text, f).Width;
            }
            catch { return 0f; }
        }

        /// <summary>缩字号到下限保完整（不省略）；缩到下限仍超宽才标记 ellipsized（绘制层会用省略号）。</summary>
        private static Font FitTextEx(Graphics g, Font baseFont, string text, float maxW, float floorPx, out bool shrunk, out bool ellipsized)
        {
            shrunk = false;
            ellipsized = false;
            if (g == null || string.IsNullOrEmpty(text) || maxW <= 2f) return baseFont;
            Font f = baseFont;
            float size = baseFont.Size;
            try
            {
                float w = MeasureInk(g, text, f);
                int guard = 0;
                while (w > maxW && size > floorPx && guard++ < 160)
                {
                    size -= 0.25f;
                    if (size < floorPx) size = floorPx;
                    f = V3Fonts.Get(size, baseFont.Style);
                    w = MeasureInk(g, text, f);
                }
                shrunk = f.Size < baseFont.Size - 0.01f;
                ellipsized = w > maxW + 0.5f;
            }
            catch { }
            return f;
        }

        /// <summary>三款统一绿点（暗影+实心+1px 亮边+高光；直径由调用方给，L3 木牌点同款）。</summary>
        internal static void DrawStatusDot(Graphics g, float dcx, float dcy, float dotD, Color dot, float scale)
        {
            float dr = Math.Max(1.5f, dotD / 2f);
            using (SolidBrush sh = new SolidBrush(Color.FromArgb(70, 0, 0, 0)))
            {
                g.FillEllipse(sh, dcx - dr, dcy - dr + scale * 0.9f, dr * 2f, dr * 2f);
            }
            using (SolidBrush db = new SolidBrush(dot))
            {
                g.FillEllipse(db, dcx - dr, dcy - dr, dr * 2f, dr * 2f);
            }
            using (Pen ed = new Pen(Color.FromArgb(205, 255, 255, 255), Math.Max(1f, 0.9f * scale)))
            {
                g.DrawEllipse(ed, dcx - dr, dcy - dr, dr * 2f, dr * 2f);
            }
            using (SolidBrush hl = new SolidBrush(Color.FromArgb(120, 255, 255, 255)))
            {
                g.FillEllipse(hl, dcx - dr * 0.5f, dcy - dr * 0.6f, dr * 0.75f, dr * 0.6f);
            }
        }

        /// <summary>L2 饭票旗几何（渲染与 --selftest 共用；宽度/字号自适应保证完整可读）。</summary>
        internal sealed class FlagMetrics
        {
            public float Width, Height, TopY, Px0;
            public float InnerW, TextW, NameAreaW;
            public RectangleF NameRect, ValRect;
            public Font NameFont, ValFont;
            public float BaseNamePx, BaseValPx;
            public string NameText = "", ValText = "";
            public bool NameShrunk, ValShrunk, NameEllipsized, ValEllipsized;
            public float DotD, DotCx, DotCy;
        }

        internal static FlagMetrics MeasureFlag(Graphics g, BowlLayout lay, BowlSlot slot, ProviderView v, float scale)
        {
            FlagMetrics f = new FlagMetrics();
            f.NameText = v != null ? (v.Name ?? "") : "";
            f.ValText = v != null ? ValueText(v) : "";
            f.BaseNamePx = Math.Max(8f, 8f * scale);
            f.BaseValPx = Math.Max(9f, 9f * scale);
            float cx = slot.X + slot.BowlW / 2f;
            float padX = 3.2f * scale;
            f.DotD = lay.DotDiameter > 0f ? lay.DotDiameter : 4f * scale;
            if (f.DotD < 3.2f) f.DotD = 3.2f;
            f.Height = Math.Max(17f, (f.BaseNamePx + f.BaseValPx) + 4f);
            float minW = Math.Max(slot.BowlW * 0.62f, f.BaseValPx * 4.2f);
            float maxW = Math.Max(minW, slot.BowlW * 0.98f);
            Font baseNameF = V3Fonts.Get(f.BaseNamePx, FontStyle.Regular);
            Font baseValF = V3Fonts.Get(f.BaseValPx, FontStyle.Bold);
            float nameW0 = MeasureInk(g, f.NameText, baseNameF);
            float valW0 = MeasureInk(g, f.ValText, baseValF);
            float dotReserve = f.DotD + 1.5f * scale;
            float needW = Math.Max(nameW0 + dotReserve, valW0) + 2f * padX + 1.5f * scale;
            f.Width = Math.Min(maxW, Math.Max(minW, needW));
            f.InnerW = Math.Max(8f, f.Width - 2f * padX);
            f.TextW = f.InnerW;
            f.NameAreaW = Math.Max(8f, f.InnerW - dotReserve);
            float nameFloor = Math.Max(7f, f.BaseNamePx * 0.80f);
            float valFloor = Math.Max(7f, f.BaseValPx * 0.75f);
            bool ns, ne, vs, ve;
            f.NameFont = FitTextEx(g, baseNameF, f.NameText, f.NameAreaW, nameFloor, out ns, out ne);
            f.ValFont = FitTextEx(g, baseValF, f.ValText, f.TextW, valFloor, out vs, out ve);
            f.NameShrunk = ns; f.NameEllipsized = ne; f.ValShrunk = vs; f.ValEllipsized = ve;
            f.TopY = Math.Max(1f, slot.RimY - f.Height - 1f * scale);
            f.Px0 = cx - f.Width / 2f;
            f.NameRect = new RectangleF(f.Px0 + padX, f.TopY + f.Height * 0.02f, f.NameAreaW, f.Height * 0.46f);
            f.ValRect = new RectangleF(f.Px0 + padX, f.TopY + f.Height * 0.46f, f.TextW, f.Height * 0.52f);
            f.DotCx = f.Px0 + f.Width - 1.5f * scale - f.DotD / 2f;
            f.DotCy = f.TopY + 1.2f * scale + f.DotD / 2f;
            return f;
        }

        /// <summary>三款统一视觉离线度量（渲染与 --selftest 同源；测试 LABEL-11/12/13 用）。</summary>
        internal sealed class LabelMetrics
        {
            public string LabelStyle = "L3";
            public float RimBottom, BowlBottom, FrontFace, FrontCenterY;
            public float NamePx, NameH, NameY, NameCenterY;
            public float DotD, DotCx, DotCy;
            public float ValPx, ValH, ValY, ValCenterY;
            public float BlockTop, BlockBottom, BlockCenterY;
            public float NameInkW, NameAreaW, ValInkW, ValAreaW;
            public float NameContrast, ValContrast;
            public float FlagW, FlagInnerW, FlagH, FlagTopY, FlagBottomGap;
            public bool NameFits, ValFits, NameShrunk, NameEllipsized, ValShrunk, ValEllipsized;
            public bool DotCentered, InFrontFace, NoRimOverlap, InBitmap, FlagInBitmap;
            public string NameText = "", ValText = "";
        }

        internal static LabelMetrics MeasureLabel(Config cfg, BowlLayout lay, BowlSlot slot, ProviderView v,
            BowlAsset a, VisualStyle style, float dpiScale, string labelStyle)
        {
            LabelMetrics m = new LabelMetrics();
            if (lay == null || slot == null || v == null) return m;
            m.LabelStyle = string.IsNullOrEmpty(labelStyle) ? "L3" : labelStyle;
            float scale = (float)Math.Max(0.85, lay.GraphicsScale) * dpiScale;
            float rimBottom = slot.RimY;
            if (a != null && a.PixelH > 0) rimBottom = slot.Top + a.RimBottom / a.PixelH * slot.BowlH;
            float bowlBottom = slot.Bottom;
            float frontFace = Math.Max(4f, bowlBottom - rimBottom);
            float cx = slot.X + slot.BowlW / 2f;
            m.RimBottom = rimBottom; m.BowlBottom = bowlBottom; m.FrontFace = frontFace;
            m.FrontCenterY = rimBottom + frontFace / 2f;
            bool lightBody = a != null && a.LightBody;
            Color nameCol, valCol, shadowCol, dotCol;
            LabelColors(cfg, v, a, style, out nameCol, out valCol, out shadowCol, out dotCol);
            m.NameText = v.Name ?? "";
            m.ValText = ValueText(v);
            using (Bitmap mb = new Bitmap(4, 4))
            using (Graphics mg = Graphics.FromImage(mb))
            {
                if (m.LabelStyle == "L2")
                {
                    FlagMetrics fm = MeasureFlag(mg, lay, slot, v, scale);
                    m.NamePx = fm.BaseNamePx;
                    m.ValPx = fm.BaseValPx;
                    m.NameH = fm.BaseNamePx * 1.10f;
                    m.NameY = fm.NameRect.Y + (fm.NameRect.Height - m.NameH) / 2f;
                    m.NameCenterY = m.NameY + m.NameH / 2f;
                    m.ValH = fm.BaseValPx * 1.10f;
                    m.ValY = fm.ValRect.Y + (fm.ValRect.Height - m.ValH) / 2f;
                    m.ValCenterY = m.ValY + m.ValH / 2f;
                    m.DotD = fm.DotD; m.DotCx = fm.DotCx; m.DotCy = fm.DotCy;
                    m.BlockTop = fm.TopY;
                    m.BlockBottom = fm.TopY + fm.Height;
                    m.BlockCenterY = (m.BlockTop + m.BlockBottom) / 2f;
                    m.NameInkW = MeasureInk(mg, fm.NameText, fm.NameFont);
                    m.NameAreaW = fm.NameAreaW;
                    m.NameFits = m.NameInkW <= m.NameAreaW + 0.5f;
                    m.ValInkW = MeasureInk(mg, fm.ValText, fm.ValFont);
                    m.ValAreaW = fm.TextW;
                    m.ValFits = m.ValInkW <= m.ValAreaW + 0.5f;
                    m.NameShrunk = fm.NameShrunk; m.NameEllipsized = fm.NameEllipsized;
                    m.ValShrunk = fm.ValShrunk; m.ValEllipsized = fm.ValEllipsized;
                    Color flagFill = Color.FromArgb(255, 250, 247, 239);
                    Color valInk = lightBody ? Color.FromArgb(255, 56, 50, 40) : Color.FromArgb(255, 60, 54, 44);
                    m.NameContrast = ContrastRatio(FlagNameInk, flagFill);
                    m.ValContrast = ContrastRatio(valInk, flagFill);
                    m.FlagW = fm.Width; m.FlagInnerW = fm.InnerW; m.FlagH = fm.Height;
                    m.FlagTopY = fm.TopY;
                    m.FlagBottomGap = rimBottom - (fm.TopY + fm.Height);
                    m.FlagInBitmap = fm.TopY >= 0.5f && fm.TopY + fm.Height <= lay.GroupH + 0.5f;
                    m.NoRimOverlap = m.BlockBottom <= rimBottom + 0.5f;
                }
                else
                {
                    m.NamePx = lay.PlaqueNamePx > 0 ? lay.PlaqueNamePx : Math.Max(8f, 8f * scale);
                    m.NameH = lay.PlaqueNameH > 0 ? lay.PlaqueNameH : m.NamePx * 1.10f;
                    m.NameY = lay.PlaqueNameY > 0 ? lay.PlaqueNameY : rimBottom + 0.5f;
                    m.NameCenterY = m.NameY + m.NameH / 2f;
                    m.DotD = lay.DotDiameter > 0 ? lay.DotDiameter : 4f * scale;
                    m.DotCx = cx;
                    m.DotCy = lay.DotCenterY > 0 ? lay.DotCenterY : m.NameY + m.NameH;
                    m.ValPx = Math.Max(9f, 9f * scale);
                    float vh = lay.ValueBandH > 0 ? Math.Max(lay.ValueBandH, m.ValPx * 1.05f) : m.ValPx * 1.15f;
                    float vcy = lay.ValueBandH > 0 ? lay.ValueBandY + lay.ValueBandH / 2f : rimBottom + frontFace * 0.62f;
                    float vy = vcy - vh / 2f;
                    float maxVy = bowlBottom - vh;
                    if (vy > maxVy) vy = maxVy;
                    if (vy < rimBottom) vy = rimBottom;
                    m.ValH = vh; m.ValY = vy; m.ValCenterY = vy + vh / 2f;
                    m.BlockTop = Math.Min(m.NameY, m.ValY);
                    m.BlockBottom = Math.Max(m.NameY + m.NameH, m.ValY + m.ValH);
                    m.BlockCenterY = (m.BlockTop + m.BlockBottom) / 2f;
                    NameFitInfo nf = FitNameForSlot(mg, lay, cfg, v, scale);
                    m.NameText = nf.DrawText;
                    m.NameInkW = nf.InkW;
                    m.NameAreaW = nf.MaxW;
                    m.NameFits = nf.InkW > 0f && nf.InkW <= nf.MaxW + 0.5f;
                    m.NameShrunk = nf.Shrunk; m.NameEllipsized = nf.Ellipsized;
                    if (m.LabelStyle == "L3")
                    {
                        float tw = lay.PlaqueW;
                        float valAreaW = Math.Max(4f, tw - 6f * scale);
                        Font valF3 = FitText(g: mg, baseFont: V3Fonts.Get(lay.PlaqueAmountPx > 0 ? lay.PlaqueAmountPx : m.ValPx, FontStyle.Bold),
                            text: m.ValText, maxW: valAreaW - 2f * scale, floorPx: Math.Max(9f, lay.PlaqueAmountPx * 0.70f));
                        m.ValInkW = MeasureInk(mg, m.ValText, valF3);
                        m.ValAreaW = valAreaW;
                        m.ValPx = lay.PlaqueAmountPx > 0 ? lay.PlaqueAmountPx : m.ValPx;
                        m.ValFits = m.ValInkW <= m.ValAreaW + 0.5f;
                        Color body3 = lightBody ? Color.FromArgb(255, 252, 251, 248) : Color.FromArgb(255, 30, 33, 38);
                        Color ink3 = lightBody ? Color.FromArgb(255, 150, 140, 124) : Color.FromArgb(255, 168, 174, 184);
                        m.NameContrast = ContrastRatio(body3, ink3);
                        Color tagFill = WoodPlaqueFill(style, a);
                        Color amtInk;
                        if (v.Low) amtInk = style.LowColor;
                        else if (v.Rice) amtInk = style.DotRice;
                        else if (!v.HasResult || !v.Ok) amtInk = style.FailColor;
                        else amtInk = style.AmountColor;
                        m.ValContrast = ContrastRatio(EnsureContrast(amtInk, tagFill, 4.5), tagFill);
                    }
                    else
                    {
                        float areaW = Math.Max(8f, slot.BowlW - 4f * scale);
                        bool vs2, ve2;
                        Font valF1 = FitTextEx(mg, V3Fonts.Get(m.ValPx, FontStyle.Bold), m.ValText, areaW,
                            Math.Max(7f, m.ValPx * 0.75f), out vs2, out ve2);
                        m.ValInkW = MeasureInk(mg, m.ValText, valF1);
                        m.ValAreaW = areaW;
                        m.ValFits = m.ValInkW <= m.ValAreaW + 0.5f;
                        m.ValShrunk = vs2; m.ValEllipsized = ve2;
                        Color body = BodyBaseColor(a);
                        m.NameContrast = ContrastRatio(nameCol, body);
                        m.ValContrast = ContrastRatio(valCol, body);
                    }
                }
            }
            if (m.LabelStyle == "L2")
            {
                // 旗风格：绿点在旗内上半（不进入数值行），旗底不越过前脸上沿线
                m.DotCentered = m.DotCy >= m.BlockTop - 0.5f && m.DotCy <= m.ValY + 0.5f;
            }
            else
            {
                m.DotCentered = Math.Abs(m.DotCx - cx) <= 0.5f
                    && m.DotCy >= m.NameY + m.NameH - 0.75f && m.DotCy <= m.ValY + 0.75f;
            }
            m.InFrontFace = m.LabelStyle != "L2"
                && m.BlockTop >= rimBottom - 0.5f && m.BlockBottom <= bowlBottom + 0.5f;
            m.NoRimOverlap = m.LabelStyle == "L2"
                ? (m.BlockBottom <= rimBottom + 0.5f)
                : (m.BlockTop >= rimBottom - 0.5f);
            m.InBitmap = m.BlockTop >= -0.5f && m.BlockBottom <= lay.GroupH + 0.5f;
            return m;
        }

        // ============================ THEME-12：木牌配色随主题 + NAME-AUTOFIT：长名缩字/中间省略 ============================

        /// <summary>两色按比例混合（保留 a 的 alpha；t=0 → a，t=1 → b）。</summary>
        internal static Color Mix(Color a, Color b, float t)
        {
            if (t <= 0f) return a;
            if (t >= 1f) return Color.FromArgb(a.A, b.R, b.G, b.B);
            int r = (int)Math.Round(a.R * (1f - t) + b.R * t);
            int g = (int)Math.Round(a.G * (1f - t) + b.G * t);
            int bl = (int)Math.Round(a.B * (1f - t) + b.B * t);
            if (r < 0) r = 0; if (r > 255) r = 255;
            if (g < 0) g = 0; if (g > 255) g = 255;
            if (bl < 0) bl = 0; if (bl > 255) bl = 255;
            return Color.FromArgb(a.A, r, g, bl);
        }

        /// <summary>半透明颜色叠到不透明底色上（GDI+ 实际合成口径，用于亮度/对比度计算）。</summary>
        internal static Color CompositeOver(Color fg, Color bg)
        {
            float a = fg.A / 255f;
            int r = (int)Math.Round(fg.R * a + bg.R * (1f - a));
            int g = (int)Math.Round(fg.G * a + bg.G * (1f - a));
            int b = (int)Math.Round(fg.B * a + bg.B * (1f - a));
            return Color.FromArgb(255, Clamp255(r), Clamp255(g), Clamp255(b));
        }

        private static int Clamp255(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

        /// <summary>盆身近似底色（浅瓷 / 深桶），用于木牌合成底色与对比度计算。</summary>
        internal static Color BodyBaseColor(BowlAsset a)
        {
            return a != null && a.LightBody ? Color.FromArgb(255, 243, 240, 235) : Color.FromArgb(255, 30, 33, 38);
        }

        /// <summary>
        /// THEME-12：L3 木牌底色改为读主题 palettes（paper/sheet + warn 木色混合），
        /// 深色主题=深胡桃木牌、浅色主题=浅桦木牌，两主题亮度差 ≥0.30，且仍是木色（非纯黑/纯白方块）。
        /// </summary>
        internal static Color WoodPlaqueFill(VisualStyle style, BowlAsset a)
        {
            bool light = style != null && style.Light;
            Color paper = style != null ? style.PlaqueFill : VisualStyle.Fallback(light ? "light" : "dark").PlaqueFill;
            Color wood = style != null ? style.WarnColor : (light ? Color.FromArgb(255, 150, 116, 59) : Color.FromArgb(255, 196, 163, 114));
            // 主题纸色 + 木色（warn）混合：暗色少量提亮成深胡桃，浅色混出浅桦木
            Color baseMix = Mix(paper, wood, light ? 0.12f : 0.18f);
            Color body = BodyBaseColor(a);
            Color solid = Color.FromArgb(246, baseMix.R, baseMix.G, baseMix.B);
            return CompositeOver(solid, body);
        }

        /// <summary>木牌描边：主题 line-strong 与木色混合。</summary>
        internal static Color WoodPlaqueBorder(VisualStyle style)
        {
            bool light = style != null && style.Light;
            Color line = style != null ? style.PlaqueBorder : Color.FromArgb(255, 85, 85, 91);
            Color wood = style != null ? style.WarnColor : Color.FromArgb(255, 196, 163, 114);
            return Mix(line, wood, light ? 0.45f : 0.30f);
        }

        /// <summary>木牌投影：暗色主题更沉、浅色主题更淡（同样跟主题）。</summary>
        internal static Color WoodPlaqueShadow(VisualStyle style)
        {
            bool light = style != null && style.Light;
            return light ? Color.FromArgb(50, 84, 66, 44) : Color.FromArgb(95, 0, 0, 0);
        }

        /// <summary>木纹：1~2 条横向细纹，让牌「仍像木牌」；暗色主题用浅纹、浅色主题用深纹。</summary>
        private static void DrawWoodGrain(Graphics g, float tx, float ty, float tw, float th, float scale, VisualStyle style)
        {
            bool light = style != null && style.Light;
            Color grain = light ? Color.FromArgb(24, 120, 96, 60) : Color.FromArgb(26, 255, 238, 205);
            using (Pen gp = new Pen(grain, Math.Max(1f, 0.5f * scale)))
            {
                float x0 = tx + 2.6f * scale;
                float x1 = tx + tw - 2.6f * scale;
                float y1 = ty + th * 0.34f;
                float y2 = ty + th * 0.68f;
                g.DrawLine(gp, x0, y1, x1, y1);
                g.DrawLine(gp, x0 + tw * 0.06f, y2, x1 - tw * 0.04f, y2);
            }
        }

        /// <summary>把前景色朝更远的一端（黑/白）微调，直到与底色对比度 ≥ minRatio（保可读，色相尽量不变）。</summary>
        internal static Color EnsureContrast(Color fg, Color bg, double minRatio)
        {
            double now = ContrastRatio(fg, bg);
            if (now >= minRatio) return fg;
            bool toWhite = RelLum(bg) < 0.5;
            Color target = toWhite ? Color.FromArgb(255, 255, 255, 255) : Color.FromArgb(255, 0, 0, 0);
            Color best = fg;
            for (int i = 1; i <= 10; i++)
            {
                Color c = Mix(fg, target, i / 10f);
                best = c;
                if (ContrastRatio(c, bg) >= minRatio) return c;
            }
            return best;
        }

        internal static double RelLum(Color c) { return BowlLayout.RelLum(c); }
        internal static float ContrastRatio(Color a, Color b) { return BowlLayout.ContrastRatio(a, b); }
        /// <summary>家名几何：判据可用带（≈BowlW*0.9351，即 selftest nameMaxW 口径）内再留左右 ≥1px 与刻痕阴影余量。</summary>
        internal static float NameMaxWidth(BowlLayout lay, float scale, bool brandLogo, bool wrapLogoDraw)
        {
            float off = Math.Max(0.6f, 0.7f * scale);
            float maxW = lay.BowlW * 0.92f;
            float safe = lay.BowlW - 6f * scale - off - 2f;   // BowlW-4*scale（判据）− 左右各 1px − 阴影 off
            if (safe < maxW) maxW = safe;
            if (brandLogo) { float bw = lay.BowlW * 0.52f; if (bw < maxW) maxW = bw; }
            if (wrapLogoDraw) { float ww = lay.BowlW * 0.62f; if (ww < maxW) maxW = ww; }
            if (maxW < 8f) maxW = 8f;
            return maxW;
        }

        /// <summary>名称自适应结果（渲染与 --selftest 共用，保证交付数字与实际一致）。</summary>
        internal sealed class NameFitInfo
        {
            public string DrawText = "";
            public Font Font;
            public float BasePx = 8f;
            public float FitPx = 8f;
            public float MaxW = 0f;
            public float InkW = 0f;
            public float FloorPx = 7f;
            public bool Shrunk;
            public bool Ellipsized;
            public bool BrandLogo;
            public bool WrapLogo;
        }

        /// <summary>
        /// NAME-AUTOFIT：先按 GenericTypographic 实测宽度缩字号（不低于 7px×scale 下限）；
        /// 缩到下限仍放不下才中间省略（保留头尾），并保证省略后左右仍有 ≥1px 留边。
        /// </summary>
        internal static NameFitInfo FitNameForSlot(Graphics g, BowlLayout lay, Config cfg, ProviderView v, float scale)
        {
            NameFitInfo r = new NameFitInfo();
            string name = v != null ? (v.Name ?? "") : "";
            r.BasePx = lay.PlaqueNamePx > 0 ? lay.PlaqueNamePx : Math.Max(8f, 8f * lay.PlaqueScale);
            r.WrapLogo = cfg != null && cfg.Display != null && cfg.Display.Logo
                && string.Equals(cfg.Display.LogoStyle, "wrap", StringComparison.OrdinalIgnoreCase);
            r.BrandLogo = cfg != null && cfg.Display != null && cfg.Display.Logo && !r.WrapLogo
                && string.Equals(cfg.Display.LogoStyle, "deepseek", StringComparison.OrdinalIgnoreCase)
                && v != null && !v.Rice
                && (((v.Id ?? "").ToLowerInvariant().Contains("deepseek")) || ((v.Name ?? "").ToLowerInvariant().Contains("deepseek")));
            r.MaxW = NameMaxWidth(lay, scale, r.BrandLogo, r.WrapLogo);
            r.FloorPx = Math.Max(6f, 7f * scale);
            r.Font = V3Fonts.Get(r.BasePx, FontStyle.Regular);
            r.FitPx = r.BasePx;
            r.DrawText = name;
            r.InkW = 0f;
            if (g == null || string.IsNullOrEmpty(name)) return r;
            try
            {
                using (StringFormat tf = new StringFormat(StringFormat.GenericTypographic))
                {
                    tf.FormatFlags = tf.FormatFlags | StringFormatFlags.NoWrap;
                    tf.Trimming = StringTrimming.None;
                    Font f = r.Font;
                    float w = g.MeasureString(name, f, 10000, tf).Width;
                    float size = r.BasePx;
                    int guard = 0;
                    while (w > r.MaxW && size > r.FloorPx && guard++ < 120)
                    {
                        size -= 0.25f;
                        if (size < r.FloorPx) size = r.FloorPx;
                        f = V3Fonts.Get(size, FontStyle.Regular);
                        w = g.MeasureString(name, f, 10000, tf).Width;
                    }
                    r.Font = f;
                    r.FitPx = f.Size;
                    r.Shrunk = f.Size < r.BasePx - 0.01f;
                    r.InkW = w;
                    if (w > r.MaxW)
                    {
                        // 缩到下限仍放不下 → 中间省略（必须是缩字之后）
                        r.Ellipsized = true;
                        string cut = name;
                        string candidate = cut + "…";
                        float ew = g.MeasureString(candidate, f, 10000, tf).Width;
                        while (cut.Length > 1 && ew > r.MaxW)
                        {
                            int mid = cut.Length / 2;
                            cut = cut.Substring(0, mid) + cut.Substring(mid + 1);
                            candidate = cut + "…";
                            ew = g.MeasureString(candidate, f, 10000, tf).Width;
                        }
                        r.DrawText = cut.Length > 0 ? cut + "…" : "…";
                        r.InkW = ew;
                    }
                }
            }
            catch
            {
                r.Font = V3Fonts.Get(r.BasePx, FontStyle.Regular);
                r.FitPx = r.BasePx;
                r.DrawText = name;
                r.Shrunk = false;
                r.Ellipsized = false;
                r.InkW = 0f;
            }
            return r;
        }

        private static readonly object s_nameFitLogGate = new object();
        private static readonly Dictionary<string, bool> s_nameFitLogged = new Dictionary<string, bool>();

        /// <summary>家名自适应只在组合变化时记一行日志（panel.log 留证，不刷屏）。</summary>
        private static void LogNameFitIfChanged(NameFitInfo nf, string name, string theme)
        {
            if (nf == null) return;
            string key = theme + "|" + name + "|" + nf.BasePx.ToString("0.##", CultureInfo.InvariantCulture) + "|"
                + nf.FitPx.ToString("0.##", CultureInfo.InvariantCulture) + "|" + (nf.Ellipsized ? "E" : "-");
            lock (s_nameFitLogGate)
            {
                if (s_nameFitLogged.ContainsKey(key)) return;
                if (s_nameFitLogged.Count > 200) s_nameFitLogged.Clear();
                s_nameFitLogged[key] = true;
            }
            try
            {
                Log.Write("name fit theme=" + theme + " name=" + Program.SafeText(name)
                    + " base=" + nf.BasePx.ToString("0.##", CultureInfo.InvariantCulture)
                    + " fit=" + nf.FitPx.ToString("0.##", CultureInfo.InvariantCulture)
                    + " maxW=" + nf.MaxW.ToString("0.##", CultureInfo.InvariantCulture)
                    + " inkW=" + nf.InkW.ToString("0.##", CultureInfo.InvariantCulture)
                    + " minPx=" + nf.FloorPx.ToString("0.##", CultureInfo.InvariantCulture)
                    + " shrunk=" + (nf.Shrunk ? "true" : "false")
                    + " ellipsis=" + (nf.Ellipsized ? "true" : "false")
                    + " text=" + Program.SafeText(nf.DrawText));
            }
            catch { }
        }

        /// <summary>大虎鲸绕桶：头在左（圆头/白点眼/背鳍），身体拱形横跨桶身，尾鳍从右缘露出。</summary>
        private static void DrawWhaleWrap(Graphics g, float cx, float top, float bw, float bandH, float scale, Color blue)
        {
            float cy = top + bandH * 0.45f;
            float hw = bw * 0.50f;
            // 身体拱形（粗曲线，从左头拱起横跨到右缘）
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddBezier(new PointF(cx - hw * 0.72f, cy + bandH * 0.10f),
                               new PointF(cx - hw * 0.30f, cy - bandH * 0.52f),
                               new PointF(cx + hw * 0.42f, cy - bandH * 0.62f),
                               new PointF(cx + hw * 1.02f, cy - bandH * 0.10f));
                using (Pen body = new Pen(blue, Math.Max(2f, bandH * 0.34f)))
                {
                    body.StartCap = LineCap.Round;
                    body.EndCap = LineCap.Round;
                    body.LineJoin = LineJoin.Round;
                    g.DrawPath(body, path);
                }
            }
            // 头（左，圆头）
            float headR = bandH * 0.34f;
            using (SolidBrush b = new SolidBrush(blue))
            {
                g.FillEllipse(b, cx - hw * 0.86f, cy - headR * 0.6f, headR * 2.0f, headR * 1.75f);
            }
            // 白点眼
            using (SolidBrush e = new SolidBrush(Color.FromArgb(240, 255, 255, 255)))
            {
                g.FillEllipse(e, cx - hw * 0.74f, cy - headR * 0.20f, headR * 0.42f, headR * 0.42f);
            }
            // 背鳍（拱顶）
            PointF[] fin = { new PointF(cx - bw * 0.06f, cy - bandH * 0.42f),
                             new PointF(cx + bw * 0.02f, cy - bandH * 0.95f),
                             new PointF(cx + bw * 0.14f, cy - bandH * 0.36f) };
            using (SolidBrush b = new SolidBrush(blue)) g.FillPolygon(b, fin);
            // 尾鳍：从右侧边缘露出（暗示绕到桶后）
            PointF[] tail1 = { new PointF(cx + hw * 0.92f, cy - bandH * 0.16f),
                               new PointF(cx + hw * 1.18f, cy - bandH * 0.62f),
                               new PointF(cx + hw * 1.10f, cy + bandH * 0.02f) };
            PointF[] tail2 = { new PointF(cx + hw * 0.92f, cy + bandH * 0.04f),
                               new PointF(cx + hw * 1.16f, cy + bandH * 0.50f),
                               new PointF(cx + hw * 1.06f, cy - bandH * 0.04f) };
            using (SolidBrush b = new SolidBrush(blue))
            {
                g.FillPolygon(b, tail1);
                g.FillPolygon(b, tail2);
            }
            // 白浪/云头点缀（少量）
            using (Pen wv = new Pen(Color.FromArgb(150, 255, 255, 255), Math.Max(1f, 0.9f * scale)))
            {
                wv.StartCap = LineCap.Round; wv.EndCap = LineCap.Round;
                for (int i = 0; i < 3; i++)
                {
                    float wx = cx - bw * 0.20f + i * bw * 0.22f;
                    float wy = cy + bandH * 0.44f;
                    g.DrawArc(wv, wx - bw * 0.05f, wy - bandH * 0.08f, bw * 0.10f, bandH * 0.16f, 200, 140);
                }
            }
        }

        /// <summary>DeepSeek 小虎鲸简笔（青花瓷蓝，圆头+背鳍+尾鳍+白点眼）。</summary>
        private static void DrawWhaleLogo(Graphics g, float cx, float cy, float w, float scale, Color blue)
        {
            float h = w * 0.58f;
            using (SolidBrush b = new SolidBrush(blue))
            {
                g.FillEllipse(b, cx - w * 0.50f, cy - h * 0.50f, w * 0.80f, h);
            }
            // 背鳍
            PointF[] fin = { new PointF(cx - w * 0.10f, cy - h * 0.42f),
                             new PointF(cx + w * 0.02f, cy - h * 0.95f),
                             new PointF(cx + w * 0.14f, cy - h * 0.40f) };
            using (SolidBrush b = new SolidBrush(blue)) g.FillPolygon(b, fin);
            // 尾鳍（两片）
            PointF[] tail = { new PointF(cx + w * 0.22f, cy - h * 0.10f),
                              new PointF(cx + w * 0.52f, cy - h * 0.62f),
                              new PointF(cx + w * 0.46f, cy + h * 0.02f) };
            PointF[] tail2 = { new PointF(cx + w * 0.22f, cy + h * 0.06f),
                               new PointF(cx + w * 0.52f, cy + h * 0.50f),
                               new PointF(cx + w * 0.44f, cy - h * 0.02f) };
            using (SolidBrush b = new SolidBrush(blue))
            {
                g.FillPolygon(b, tail);
                g.FillPolygon(b, tail2);
            }
            // 白点眼
            using (SolidBrush e = new SolidBrush(Color.FromArgb(245, 255, 255, 255)))
            {
                g.FillEllipse(e, cx - w * 0.34f, cy - h * 0.13f, w * 0.075f, h * 0.20f);
            }
            // 腹线（浅色）
            using (Pen pl = new Pen(Color.FromArgb(150, 255, 255, 255), Math.Max(1f, 0.8f * scale)))
            {
                g.DrawArc(pl, cx - w * 0.46f, cy - h * 0.05f, w * 0.72f, h * 0.62f, 20, 140);
            }
        }

        public static string ValueText(ProviderView v)
        {
            if (v.Rice) return "满满一盆";
            if (!v.HasResult || !v.Ok) return "连接失败";
            string symbol = string.Equals(v.Currency, "USD", StringComparison.OrdinalIgnoreCase) ? "$" : "¥";
            return symbol + v.Amount.ToString("0.00", CultureInfo.InvariantCulture);
        }

        // ---------------- 轮子 ----------------
        /// <summary>
        /// 轮子彩蛋：把静态帧按 angleDeg 重绘每只盆底的两枚轮子（AnimTick 移动时调用；angle=0 与静态首帧一致）。
        /// 单排 / 两排（Row=0/1）各自按 slot 相对坐标附着；lay.WheelH&lt;=0（未开彩蛋）返回 null。
        /// </summary>
        public static Bitmap WithWheels(Bitmap src, BowlLayout lay, VisualStyle style, float angleDeg)
        {
            if (src == null || lay == null || lay.WheelH <= 0 || lay.Slots == null || lay.Slots.Count == 0) return null;
            Bitmap dst = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppPArgb);
            Graphics g = null;
            try
            {
                g = Graphics.FromImage(dst);
                g.CompositingMode = CompositingMode.SourceCopy;
                g.DrawImage(src, new Rectangle(0, 0, src.Width, src.Height), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel);
                Prepare(g);
                float wr = lay.WheelH * 0.46f;
                for (int i = 0; i < lay.Slots.Count; i++)
                {
                    BowlSlot slot = lay.Slots[i];
                    RectangleF band = new RectangleF(slot.X, slot.Bottom, slot.BowlW, lay.WheelH);
                    Region clip = new Region(band);
                    // 两行布局：后排（Row=0）轮带位于前排盆身之后，只擦/画没被前排盆身遮挡的部分（z 序与静态渲染一致）
                    if (lay.TwoRows && slot.Row == 0)
                    {
                        for (int k = 0; k < lay.Slots.Count; k++)
                        {
                            BowlSlot front = lay.Slots[k];
                            if (front.Row <= slot.Row) continue;
                            clip.Exclude(new Rectangle(front.X, front.Top, front.BowlW, front.BowlH));
                        }
                    }
                    g.SetClip(clip, CombineMode.Replace);
                    // 轮带先清成透明（只清盆底下方，不抹盆身），再按旋转角度重画两枚轮子
                    g.CompositingMode = CompositingMode.SourceCopy;
                    using (SolidBrush clear = new SolidBrush(Color.Transparent)) g.FillRectangle(clear, band);
                    g.CompositingMode = CompositingMode.SourceOver;
                    float wy = slot.Bottom + lay.WheelH * 0.60f;
                    DrawWheel(g, slot.X + slot.BowlW * 0.27f, wy, wr, style, angleDeg);
                    DrawWheel(g, slot.X + slot.BowlW * 0.73f, wy, wr, style, angleDeg);
                    g.ResetClip();
                    clip.Dispose();
                }
                g.CompositingMode = CompositingMode.SourceOver;
            }
            finally
            {
                if (g != null) g.Dispose();
            }
            return dst;
        }

        /// <summary>画一枚轮子：angleDeg=0 为静态首帧角度；辐条 + 轮毂不对称标记按角度旋转，肉眼可辨。</summary>
        private static void DrawWheel(Graphics g, float cx, float cy, float r, VisualStyle style, float angleDeg)
        {
            using (SolidBrush tire = new SolidBrush(Color.FromArgb(240, 74, 82, 94)))
            {
                g.FillEllipse(tire, cx - r, cy - r, r * 2f, r * 2f);
            }
            using (SolidBrush hub = new SolidBrush(Color.FromArgb(245, 204, 213, 224)))
            {
                g.FillEllipse(hub, cx - r * 0.55f, cy - r * 0.55f, r * 1.1f, r * 1.1f);
            }
            double rot = angleDeg * Math.PI / 180.0;
            using (Pen spoke = new Pen(Color.FromArgb(235, 96, 108, 122), Math.Max(1f, r * 0.26f)))
            {
                for (int k = 0; k < 3; k++)
                {
                    double a = rot + k * Math.PI / 3.0;
                    g.DrawLine(spoke, cx + (float)Math.Cos(a) * r * 0.28f, cy + (float)Math.Sin(a) * r * 0.28f,
                        cx + (float)Math.Cos(a) * r * 0.84f, cy + (float)Math.Sin(a) * r * 0.84f);
                }
            }
            // 轮毂不对称标记：偏离中心的小亮片，随角度绕轮心转，让旋转肉眼可辨
            float mx = cx + (float)Math.Cos(rot - Math.PI / 2.0) * r * 0.72f;
            float my = cy + (float)Math.Sin(rot - Math.PI / 2.0) * r * 0.72f;
            float mr = Math.Max(0.7f, r * 0.17f);
            using (SolidBrush mark = new SolidBrush(Color.FromArgb(250, 236, 240, 246)))
            {
                g.FillEllipse(mark, mx - mr, my - mr, mr * 2f, mr * 2f);
            }
        }

        internal static GraphicsPath RoundedRect(float x, float y, float w, float h, float r)
        {
            if (r < 0.5f) r = 0.5f;
            GraphicsPath p = new GraphicsPath();
            float d = r * 2f;
            p.AddArc(x, y, d, d, 180f, 90f);
            p.AddArc(x + w - d, y, d, d, 270f, 90f);
            p.AddArc(x + w - d, y + h - d, d, d, 0f, 90f);
            p.AddArc(x, y + h - d, d, d, 90f, 90f);
            p.CloseFigure();
            return p;
        }
    }

    // ================================================================== 展开明细
    internal static class DetailRenderer
    {
        public static void Measure(Config cfg, int n, float scale, BowlLayout lay, out int w, out int h)
        {
            int minW = BowlLayout.ScaleI(240, scale);
            int rowH = BowlLayout.ScaleI(30, scale);
            int head = BowlLayout.ScaleI(34, scale);
            int foot = BowlLayout.ScaleI(24, scale);
            w = Math.Max(minW, Math.Min(lay.GroupW, BowlLayout.ScaleI(460, scale)));
            if (w < minW) w = minW;
            h = head + n * rowH + foot;
        }

        public static Bitmap Render(Config cfg, ProviderView[] views, BowlLayout lay, VisualStyle style, float scale)
        {
            int w, h;
            Measure(cfg, views.Length, scale, lay, out w, out h);
            Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                float rad = BowlLayout.ScaleI(10, scale);
                using (GraphicsPath path = BowlRenderer.RoundedRect(0.5f, 0.5f, w - 1f, h - 1f, rad))
                {
                    using (SolidBrush b = new SolidBrush(style.CardFill))
                    {
                        g.FillPath(b, path);
                    }
                    using (Pen p = new Pen(style.CardBorder, Math.Max(1f, scale)))
                    {
                        g.DrawPath(p, path);
                    }
                }
                float pad = BowlLayout.ScaleI(12, scale);
                Font headFont = V3Fonts.Get(11f * scale, FontStyle.Bold);
                Font rowFont = V3Fonts.Get(10.5f * scale, FontStyle.Regular);
                Font subFont = V3Fonts.Get(8.5f * scale, FontStyle.Regular);
                Font rowBold = V3Fonts.Get(11f * scale, FontStyle.Bold);
                using (SolidBrush b = new SolidBrush(style.AmountColor))
                {
                    g.DrawString("余额明细 · 点击面板收起", headFont, b, pad, pad * 0.8f);
                }
                float y = BowlLayout.ScaleI(34, scale);
                float rowH = BowlLayout.ScaleI(30, scale);
                for (int i = 0; i < views.Length; i++)
                {
                    ProviderView v = views[i];
                    Color dot = v.Rice ? style.DotRice : (!v.HasResult || !v.Ok ? style.DotGrey : (v.Low ? style.DotRed : style.DotGreen));
                    using (SolidBrush db = new SolidBrush(dot))
                    {
                        g.FillEllipse(db, pad, y + rowH * 0.34f, Math.Max(5f, 6f * scale), Math.Max(5f, 6f * scale));
                    }
                    using (SolidBrush b = new SolidBrush(style.AmountColor))
                    {
                        g.DrawString(v.Name, rowFont, b, pad + BowlLayout.ScaleI(14, scale), y + rowH * 0.06f);
                    }
                    using (SolidBrush vc = new SolidBrush(v.Rice ? style.DotRice : (!v.HasResult || !v.Ok ? style.FailColor : (v.Low ? style.LowColor : style.AmountColor))))
                    {
                        using (StringFormat rf = new StringFormat())
                        {
                            rf.Alignment = StringAlignment.Far;
                            rf.FormatFlags = StringFormatFlags.NoWrap;
                            g.DrawString(BowlRenderer.ValueText(v), rowBold, vc, new RectangleF(pad, y + rowH * 0.04f, w - pad * 2f, rowH * 0.5f), rf);
                        }
                    }
                    string sub;
                    if (v.Rice) sub = "大白饭档 · 不联网 · 永远满满一盆";
                    else
                    {
                        string thr = double.IsNaN(v.Threshold) ? "无" : ("¥" + v.Threshold.ToString("0.##", CultureInfo.InvariantCulture));
                        string last;
                        if (v.LastOkMs >= 0) last = "成功";
                        else if (v.LastAttemptMs >= 0) last = "失败";
                        else last = "等待刷新";
                        sub = "阈值 " + thr + " · 每 " + v.IntervalSec + "s 刷新 · 最近 " + last;
                    }
                    using (SolidBrush b = new SolidBrush(style.HintColor))
                    {
                        g.DrawString(sub, subFont, b, pad + BowlLayout.ScaleI(14, scale), y + rowH * 0.56f);
                    }
                    if (i + 1 < views.Length)
                    {
                        using (Pen dp = new Pen(style.CardDivider, Math.Max(0.5f, scale * 0.7f)))
                        {
                            g.DrawLine(dp, pad, y + rowH - 1f, w - pad, y + rowH - 1f);
                        }
                    }
                    y += rowH;
                }
                using (SolidBrush b = new SolidBrush(style.HintColor))
                {
                    g.DrawString("窗口置顶 · 点击面板收起", subFont, b, pad, h - BowlLayout.ScaleI(20, scale));
                }
            }
            return bmp;
        }
    }

    // ================================================================== 演示数据
    internal static class DemoData
    {
        public static ProviderView[] BuildViews(int n, Config cfg)
        {
            return BuildViews(n, cfg, null);
        }

        /// <summary>演示数据；state=normal/low/offline/rice 覆盖第一家的状态（出图三态抽样用，不写 config）。</summary>
        public static ProviderView[] BuildViews(int n, Config cfg, string state)
        {
            if (n < 1) n = 1;
            string st = (state ?? "").Trim().ToLowerInvariant();
            List<ProviderView> list = new List<ProviderView>(n);
            if (st == "low")
            {
                ProviderView ds = Make("deepseek", "DeepSeek", 3.20, "", 500, 5, 60);
                ds.Low = true;
                list.Add(ds);
            }
            else if (st == "offline")
            {
                ProviderView ds = new ProviderView();
                ds.Id = "deepseek";
                ds.Name = "DeepSeek";
                ds.HasResult = false;
                ds.Ok = false;
                ds.Amount = 0;
                ds.Currency = "CNY";
                ds.FullAmount = 500;
                ds.Threshold = 5;
                ds.IntervalSec = 60;
                ds.LastAttemptMs = 0;
                ds.LastOkMs = -1;
                list.Add(ds);
            }
            else if (st == "rice")
            {
                ProviderView ds = new ProviderView();
                ds.Id = "deepseek";
                ds.Name = "DeepSeek";
                ds.Rice = true;
                ds.HasResult = true;
                ds.Ok = true;
                ds.Ratio = 1.0;
                ds.FullAmount = 100;
                ds.Threshold = 5;
                ds.IntervalSec = 60;
                ds.LastAttemptMs = 0;
                ds.LastOkMs = 0;
                list.Add(ds);
            }
            else
            {
                list.Add(Make("deepseek", "DeepSeek", 487.35, "", 500, 5, 60));
            }
            if (n >= 2) list.Add(Make("a6", "A6", 19.98, "", 30, 5, 60));
            for (int i = 2; i < n; i++)
            {
                ProviderView v = new ProviderView();
                v.Id = "rice" + (i - 1);
                v.Name = "大白饭";
                v.Rice = true;
                v.HasResult = true;
                v.Ok = true;
                v.Ratio = 1.0;
                v.FullAmount = 100;
                v.Threshold = 5;
                v.IntervalSec = 60;
                v.LastAttemptMs = 0;
                v.LastOkMs = 0;
                list.Add(v);
            }
            return list.ToArray();
        }

        private static ProviderView Make(string id, string name, double amount, string currency, double full, double thr, int interval)
        {
            ProviderView v = new ProviderView();
            v.Id = id;
            v.Name = name;
            v.HasResult = true;
            v.Ok = true;
            v.Amount = amount;
            v.Currency = string.IsNullOrEmpty(currency) ? "CNY" : currency;
            v.FullAmount = full;
            v.Ratio = Math.Max(0, Math.Min(1, amount / full));
            v.Threshold = thr;
            v.IntervalSec = interval;
            v.LastAttemptMs = 0;
            v.LastOkMs = 0;
            return v;
        }
    }

    // ================================================================== 无窗口自检 / 出图
    internal static class ProgramV3
    {
        public static int RunSelftest(string outPath)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                Log.Init(Path.Combine(baseDir, "panel.log"));
                NativeV3.TryEnablePerMonitorV2();
                AppContext app = new AppContext(baseDir);
                app.HeadlessInit();
                Config cfg = app.Cfg;
                // v4.1：config 原文里的 display.wear / display.nineLayout（判据「缺省→默认」迁移依据；只读不改盘）
                string cfgWearRaw = "";
                string cfgNineLayoutRaw = "";
                try
                {
                    string cfgText = File.ReadAllText(app.ConfigPath, Encoding.UTF8);
                    Dictionary<string, object> cfgRoot = Json.AsObject(Json.Parse(cfgText));
                    Dictionary<string, object> cfgDisp = cfgRoot == null ? null : Json.AsObject(Json.GetValue(cfgRoot, "display"));
                    if (cfgDisp != null)
                    {
                        cfgWearRaw = Json.GetString(cfgDisp, "wear", "");
                        cfgNineLayoutRaw = Json.GetString(cfgDisp, "nineLayout", "");
                    }
                }
                catch { }
                StringBuilder sb = new StringBuilder(8192);
                sb.Append("{\n");
                sb.Append("  \"version\": \"v3-A\",\n");
                sb.Append("  \"generated\": ").Append(Json.Quote(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture))).Append(",\n");
                sb.Append("  \"env\": {\n");
                sb.Append("    \"os\": ").Append(Json.Quote(Environment.OSVersion.VersionString)).Append(",\n");
                sb.Append("    \"dpiAware\": ").Append(Json.Quote(NativeV3.DpiAwarenessMode)).Append(",\n");
                sb.Append("    \"monitor\": ").Append(Json.Quote(app.MonitorName)).Append(",\n");
                sb.Append("    \"screen\": { \"width\": ").Append(app.ScreenW).Append(", \"height\": ").Append(app.ScreenH).Append(" },\n");
                sb.Append("    \"workArea\": { \"left\": ").Append(app.WorkLeft).Append(", \"top\": ").Append(app.WorkTop)
                  .Append(", \"right\": ").Append(app.WorkRight).Append(", \"bottom\": ").Append(app.WorkBottom).Append(" },\n");
                sb.Append("    \"dpiScale\": ").Append(FormatNum(app.DpiScale)).Append(",\n");
                sb.Append("    \"petScale\": ").Append(FormatNum(app.PetScaleApi)).Append(",\n");
                sb.Append("    \"petScaleRef\": ").Append(FormatNum(cfg.Display.PetScaleRef)).Append(",\n");
                sb.Append("    \"graphicsScale\": ").Append(FormatNum(app.GraphicsScaleVal)).Append(",\n");
                sb.Append("    \"bowlStyle\": ").Append(Json.Quote(cfg.Display.BowlStyle)).Append(",\n");
                sb.Append("    \"labelStyle\": ").Append(Json.Quote(cfg.Display.LabelStyle)).Append(",\n");
                sb.Append("    \"displayStyle\": ").Append(Json.Quote(cfg.Display.Style)).Append(",\n");
                sb.Append("    \"nineLayout\": ").Append(Json.Quote(cfg.Display.NineLayout)).Append(",\n");
                sb.Append("    \"nineLayoutRaw\": ").Append(Json.Quote(cfgNineLayoutRaw)).Append(",\n");
                sb.Append("    \"compactAfter\": ").Append(cfg.Display.CompactAfter).Append(",\n");
                sb.Append("    \"refYuan\": ").Append(FormatNum(cfg.Display.RefYuan)).Append(",\n");
                sb.Append("    \"bottomGap\": ").Append(cfg.Position.BottomGap).Append(",\n");
                sb.Append("    \"petLift\": ").Append(cfg.PetLift != null && cfg.PetLift.Enabled ? "true" : "false").Append(",\n");
                sb.Append("    \"detectMs\": ").Append(cfg.LiveFollow != null ? cfg.LiveFollow.DetectMs : -1).Append(",\n");
                sb.Append("    \"wear\": ").Append(Json.Quote(cfg.Display != null && string.Equals(cfg.Display.Wear, "head", StringComparison.OrdinalIgnoreCase) ? "head" : "feet")).Append(",\n");
                sb.Append("    \"wearRaw\": ").Append(Json.Quote(cfgWearRaw)).Append("\n");
                sb.Append("  },\n");
                sb.Append("  \"theme\": {\n");
                sb.Append("    \"follow\": ").Append(cfg.Theme.Follow ? "true" : "false").Append(",\n");
                sb.Append("    \"force\": ").Append(cfg.Theme.Force == null || cfg.Theme.Force.Length == 0 ? "null" : Json.Quote(cfg.Theme.Force)).Append(",\n");
                ThemeInfo ti = app.ThemeInfo;
                sb.Append("    \"detected\": ").Append(Json.Quote(ti == null ? "" : (ti.Theme ?? ""))).Append(",\n");
                sb.Append("    \"selectedId\": ").Append(Json.Quote(ti == null ? "" : (ti.SelectedId ?? ""))).Append(",\n");
                sb.Append("    \"paletteSource\": ").Append(Json.Quote(ti == null ? "fallback" : (ti.PaletteSource ?? "fallback"))).Append("\n");
                sb.Append("  },\n");
                sb.Append("  \"layouts\": [\n");
                bool first = true;
                string[] styles = new string[] { "ricebowl", "capsule" };
                float[] scales = new float[] { 1f, 1.25f, 1.5f };
                for (int si = 0; si < styles.Length; si++)
                {
                    for (int bi = 0; bi < scales.Length; bi++)
                    {
                        for (int pi = 0; pi < 2; pi++)
                        {
                        double petScaleSample = pi == 0 ? 1.05 : 2.0;
                        double gsSample = ScaleMath.GraphicsScale(cfg, petScaleSample);
                        for (int n = 2; n <= 9; n++)
                        {
                            Config snapshot = ConfigClone(cfg, styles[si]);
                            BowlLayout lay = BowlLayout.Compute(snapshot, n, scales[bi], gsSample);
                            int lift = (int)Math.Round(6.0 * scales[bi]) + lay.GroupH;
                            int top = app.WorkBottom - cfg.Position.BottomGap - lay.GroupH;
                            float labelH = lay.PlaqueH;
                            float labelW = lay.PlaqueW;
                            float labelGap = lay.PlaqueGapBottom;
                            int labelRimY = lay.PlaqueRimY;
                            float labelFront = lay.PlaqueFrontFace;
                            float labelPct = labelFront > 0 ? labelH / labelFront : 0f;
                            if (!first) sb.Append(",\n");
                            first = false;
                            sb.Append("    { \"style\": ").Append(Json.Quote(styles[si]))
                              .Append(", \"count\": ").Append(n)
                              .Append(", \"dpiScale\": ").Append(FormatNum(scales[bi]))
                              .Append(", \"compact\": ").Append(lay.Compact ? "true" : "false")
                              .Append(", \"twoRows\": ").Append(lay.TwoRows ? "true" : "false")
                              .Append(", \"nineLayout\": ").Append(Json.Quote(cfg.Display.NineLayout))
                              .Append(", \"pyramid\": ").Append(lay.Pyramid ? "true" : "false")
                              .Append(", \"rowCounts\": ").Append(RowCountsJson(lay))
                              .Append(", \"bowlW\": ").Append(lay.Style == "capsule" ? lay.CapsuleW : lay.BowlW)
                              .Append(", \"bowlH\": ").Append(lay.Style == "capsule" ? lay.CapsuleH : lay.BowlH)
                              .Append(", \"gap\": ").Append(lay.Style == "capsule" ? (lay.CapsuleH - lay.Step) : lay.Gap)
                              .Append(", \"step\": ").Append(lay.Style == "capsule" ? lay.Step : (lay.BowlW + lay.Gap))
                              .Append(", \"groupW\": ").Append(lay.GroupW)
                              .Append(", \"groupH\": ").Append(lay.GroupH)
                              .Append(", \"groupTop\": ").Append(top)
                              .Append(", \"groupBottom\": ").Append(top + lay.GroupH)
                              .Append(", \"labelStyle\": ").Append(Json.Quote(cfg.Display.LabelStyle))
                              .Append(", \"label\": { \"plaqueH\": ").Append(FormatNum(labelH))
                              .Append(", \"plaqueW\": ").Append(FormatNum(labelW))
                              .Append(", \"plaqueGapBottom\": ").Append(FormatNum(labelGap))
                              .Append(", \"rimY\": ").Append(labelRimY)
                              .Append(", \"plaqueY\": ").Append(FormatNum(lay.PlaqueY))
                              .Append(", \"bowlBottom\": ").Append(lay.GroupH - lay.WheelH)
                              .Append(", \"plaqueNoRimOverlap\": ").Append(lay.PlaqueH > 0 && lay.PlaqueY >= lay.PlaqueRimBottom + 0.90f ? "true" : "false")
                              .Append(", \"plaqueRimBottom\": ").Append(FormatNum(lay.PlaqueRimBottom))
                              .Append(", \"plaqueOnlyAmount\": true")
                              .Append(", \"amountPx\": ").Append(FormatNum(lay.PlaqueAmountPx))
                              .Append(", \"namePx\": ").Append(FormatNum(lay.PlaqueNamePx))
                              .Append(", \"nameY\": ").Append(FormatNum(lay.PlaqueNameY))
                              .Append(", \"nameBottomGap\": ").Append(FormatNum(lay.PlaqueNameBottomGap))
                              .Append(", \"frontFace\": ").Append(FormatNum(labelFront))
                              .Append(", \"frontPct\": ").Append(FormatNum(labelPct))
                              .Append(" }")
                              .Append(", \"petScale\": ").Append(FormatNum(petScaleSample))
                              .Append(", \"graphicsScale\": ").Append(FormatNum(gsSample))
                              .Append(", \"lift\": ").Append(lift)
                              .Append(", \"centerX\": ").Append(app.WorkLeft + (app.WorkRight - app.WorkLeft) / 2)
                              .Append(", \"workBottom\": ").Append(app.WorkBottom)
                              .Append(" }");
                        }
                        }
                    }
                }
                sb.Append("\n  ],\n");
                // ---- layoutProbe：9 家排法 v4.1（pyramid 默认 / row / twoRows）离线几何证明（测试 LAYOUT 组）----
                sb.Append("  \"layoutProbe\": {\n");
                sb.Append("    \"defaults\": { \"wear\": ").Append(Json.Quote(WearMath.IsHead(cfg) ? "head" : "feet"))
                  .Append(", \"wearRaw\": ").Append(Json.Quote(cfgWearRaw))
                  .Append(", \"nineLayout\": ").Append(Json.Quote(cfg.Display.NineLayout))
                  .Append(", \"nineLayoutRaw\": ").Append(Json.Quote(cfgNineLayoutRaw))
                  .Append(", \"compactAfter\": ").Append(cfg.Display.CompactAfter).Append(" },\n");
                sb.Append("    \"template\": [4, 3, 2],\n");
                sb.Append("    \"pyramid\": { \"cases\": [\n");
                int[] pCounts = new int[] { 6, 7, 8, 9 };
                double[] pScales = new double[] { 0.5, 1.0, 1.5, 2.0 };
                bool firstP = true;
                for (int ci = 0; ci < pCounts.Length; ci++)
                {
                    for (int sc = 0; sc < pScales.Length; sc++)
                    {
                        if (!firstP) sb.Append(",\n");
                        firstP = false;
                        sb.Append("      ").Append(LayoutProbeCaseJson(cfg, "pyramid", pCounts[ci], pScales[sc], 1f));
                    }
                }
                sb.Append("\n    ] },\n");
                sb.Append("    \"compat\": {\n");
                sb.Append("      \"row\": ").Append(LayoutProbeCaseJson(cfg, "row", 9, 1.5, 1f)).Append(",\n");
                sb.Append("      \"twoRows\": ").Append(LayoutProbeCaseJson(cfg, "twoRows", 9, 1.5, 1f)).Append("\n");
                sb.Append("    },\n");
                {
                    Config snapPy = ConfigClone(cfg, "ricebowl");
                    snapPy.Display.NineLayout = "pyramid";
                    snapPy.Display.Wear = "feet";
                    snapPy.Display.Wheels = false;
                    Config snapRow = ConfigClone(cfg, "ricebowl");
                    snapRow.Display.NineLayout = "row";
                    snapRow.Display.Wear = "feet";
                    snapRow.Display.Wheels = false;
                    Config snap2R = ConfigClone(cfg, "ricebowl");
                    snap2R.Display.NineLayout = "twoRows";
                    snap2R.Display.Wear = "feet";
                    snap2R.Display.Wheels = false;
                    double gsR = ScaleMath.GraphicsScale(snapPy, 1.5);
                    BowlLayout layPy = BowlLayout.Compute(snapPy, 9, 1f, gsR);
                    BowlLayout layRow = BowlLayout.Compute(snapRow, 9, 1f, gsR);
                    BowlLayout lay2R = BowlLayout.Compute(snap2R, 9, 1f, gsR);
                    sb.Append("    \"readability\": { \"petScale\": 1.5, \"dpiScale\": 1, \"pyramidBowlW\": ").Append(layPy.BowlW)
                      .Append(", \"rowBowlW\": ").Append(layRow.BowlW)
                      .Append(", \"twoRowsBowlW\": ").Append(lay2R.BowlW)
                      .Append(", \"pyramidVsRowPct\": ").Append(FormatNum(layRow.BowlW > 0 ? (layPy.BowlW * 100.0 / layRow.BowlW) : 0)).Append(" }\n");
                }
                sb.Append("  },\n");
                sb.Append("  \"bowls\": [\n");
                List<BowlAsset> bowls = BowlAssets.ListAll();
                for (int i = 0; i < bowls.Count; i++)
                {
                    BowlAsset b = bowls[i];
                    sb.Append("    { \"id\": ").Append(Json.Quote(b.Id))
                      .Append(", \"name\": ").Append(Json.Quote(b.Name))
                      .Append(", \"source\": ").Append(Json.Quote(b.Source))
                      .Append(", \"ok\": ").Append(b.Ok ? "true" : "false")
                      .Append(" }");
                    if (i + 1 < bowls.Count) sb.Append(",");
                    sb.Append("\n");
                }
                sb.Append("  ],\n");
                // ---- sizeScan：测试口径 petScale 0.5/1.0/1.5/2.0（50/100/150/200%）----
                sb.Append("  \"sizeScan\": [\n");
                double[] scanScales = new double[] { 0.5, 1.0, 1.5, 2.0 };
                // 取「最长家名」做自适应样本（长名测试就靠这一路；2 家默认仍是 DeepSeek）
                string scanName = cfg.Providers.Count > 0 ? cfg.Providers[0].Name : "DeepSeek";
                string scanProviderId = cfg.Providers.Count > 0 ? cfg.Providers[0].Id : "";
                bool scanRice = cfg.Providers.Count > 0 && string.Equals(cfg.Providers[0].Type, "rice", StringComparison.OrdinalIgnoreCase);
                for (int pj = 1; pj < cfg.Providers.Count; pj++)
                {
                    string cand = cfg.Providers[pj].Name ?? "";
                    if (cand.Length > (scanName ?? "").Length)
                    {
                        scanName = cand;
                        scanProviderId = cfg.Providers[pj].Id;
                        scanRice = string.Equals(cfg.Providers[pj].Type, "rice", StringComparison.OrdinalIgnoreCase);
                    }
                }
                for (int si2 = 0; si2 < scanScales.Length; si2++)
                {
                    Config snap2 = ConfigClone(cfg, "ricebowl");
                    double gs2 = ScaleMath.GraphicsScale(snap2, scanScales[si2]);
                    BowlLayout lay2 = BowlLayout.Compute(snap2, 2, 1f, gs2);
                    int bowlBottom2 = lay2.GroupH - lay2.WheelH;
                    float frontFace2 = Math.Max(4f, bowlBottom2 - lay2.PlaqueRimY);
                    float namePx2 = lay2.PlaqueNamePx;
                    float nameTextW2 = 0f;
                    float nameContrast2 = 0f;
                    float nameFitPx2 = namePx2;
                    float nameFitW2 = 0f;
                    float nameMaxW2 = 0f;
                    float nameMinPx2 = 0f;
                    bool nameShrunk2 = false;
                    bool nameEllipsized2 = false;
                    string nameDrawText2 = scanName ?? "";
                    try
                    {
                        ProviderView pv2 = new ProviderView();
                        pv2.Name = scanName;
                        pv2.Id = scanProviderId;
                        pv2.Rice = scanRice;
                        using (Bitmap mb = new Bitmap(4, 4))
                        using (Graphics mg = Graphics.FromImage(mb))
                        {
                            Font mf = V3Fonts.Get(namePx2 > 0 ? namePx2 : 8f, FontStyle.Regular);
                            nameTextW2 = mg.MeasureString(scanName, mf, 10000, StringFormat.GenericTypographic).Width;
                            // NAME-AUTOFIT：与渲染共用同一套自适应（缩字→中间省略）
                            BowlRenderer.NameFitInfo nfi2 = BowlRenderer.FitNameForSlot(mg, lay2, snap2, pv2, (float)Math.Max(0.85, gs2));
                            nameFitPx2 = nfi2.FitPx;
                            nameFitW2 = nfi2.InkW;
                            nameMaxW2 = nfi2.MaxW;
                            nameMinPx2 = nfi2.FloorPx;
                            nameShrunk2 = nfi2.Shrunk;
                            nameEllipsized2 = nfi2.Ellipsized;
                            nameDrawText2 = nfi2.DrawText;
                        }
                        bool lightB2 = lay2.Asset != null && lay2.Asset.LightBody;
                        Color body2 = lightB2 ? Color.FromArgb(252, 251, 248) : Color.FromArgb(30, 33, 38);
                        Color ink2 = lightB2 ? Color.FromArgb(150, 140, 124) : Color.FromArgb(168, 174, 184);
                        nameContrast2 = ContrastRatio(body2, ink2);
                    }
                    catch { }
                    bool noRim2 = lay2.PlaqueH > 0 && lay2.PlaqueY >= lay2.PlaqueRimBottom + 0.90f;
                    if (si2 > 0) sb.Append(",\n");
                    sb.Append("    { \"petScale\": ").Append(FormatNum(scanScales[si2]))
                      .Append(", \"graphicsScale\": ").Append(FormatNum(gs2))
                      .Append(", \"clampedMin\": ").Append(Math.Abs(gs2 - snap2.Display.GraphicsMin) < 0.001 ? "true" : "false")
                      .Append(", \"clampedMax\": ").Append(Math.Abs(gs2 - snap2.Display.GraphicsMax) < 0.001 ? "true" : "false")
                      .Append(", \"bowlW\": ").Append(lay2.BowlW)
                      .Append(", \"bowlH\": ").Append(lay2.BowlH)
                      .Append(", \"groupW\": ").Append(lay2.GroupW)
                      .Append(", \"groupH\": ").Append(lay2.GroupH)
                      .Append(", \"compact\": ").Append(lay2.Compact ? "true" : "false")
                      .Append(", \"lift\": ").Append((int)Math.Round(6.0) + lay2.GroupH)
                      .Append(", \"rimY\": ").Append(lay2.PlaqueRimY)
                      .Append(", \"bowlBottom\": ").Append(bowlBottom2)
                      .Append(", \"frontFace\": ").Append(FormatNum(frontFace2))
                      .Append(", \"plaqueY\": ").Append(FormatNum(lay2.PlaqueY))
                      .Append(", \"plaqueH\": ").Append(FormatNum(lay2.PlaqueH))
                      .Append(", \"plaqueW\": ").Append(FormatNum(lay2.PlaqueW))
                      .Append(", \"frontPct\": ").Append(FormatNum(lay2.PlaqueH / frontFace2))
                      .Append(", \"plaqueNoRimOverlap\": ").Append(noRim2 ? "true" : "false")
                      .Append(", \"amountPx\": ").Append(FormatNum(lay2.PlaqueAmountPx))
                      .Append(", \"namePx\": ").Append(FormatNum(namePx2))
                      .Append(", \"nameY\": ").Append(FormatNum(lay2.PlaqueNameY))
                      .Append(", \"nameH\": ").Append(FormatNum(lay2.PlaqueNameH))
                      .Append(", \"nameTextW\": ").Append(FormatNum(nameTextW2))
                      .Append(", \"nameMaxW\": ").Append(FormatNum(nameMaxW2 > 0f ? nameMaxW2 : lay2.BowlW - 4f * gs2))
                      .Append(", \"nameFits\": ").Append(nameFitW2 > 0f && nameFitW2 <= nameMaxW2 + 0.5f ? "true" : "false")
                      .Append(", \"nameFitPx\": ").Append(FormatNum(nameFitPx2))
                      .Append(", \"nameFitW\": ").Append(FormatNum(nameFitW2))
                      .Append(", \"nameMinPx\": ").Append(FormatNum(nameMinPx2))
                      .Append(", \"nameShrunk\": ").Append(nameShrunk2 ? "true" : "false")
                      .Append(", \"nameEllipsized\": ").Append(nameEllipsized2 ? "true" : "false")
                      .Append(", \"nameDrawText\": ").Append(Json.Quote(nameDrawText2))
                      .Append(", \"nameBottomGap\": ").Append(FormatNum(bowlBottom2 - (lay2.PlaqueNameY + lay2.PlaqueNameH)))
                      .Append(", \"nameContrast\": ").Append(FormatNum(nameContrast2))
                      .Append(", \"dotVisible\": ").Append(lay2.PlaqueH > 0 ? "true" : "false")
                      .Append(", \"heapOverflowPct\": 0.45")
                      .Append(", \"plaqueOnlyAmount\": true")
                      .Append(" }");
                }
                sb.Append("\n  ],\n");
                // ---- nameFit：长名自适应离线证明（与渲染共用 FitNameForSlot；测试 probe nameink 的交付口径）----
                sb.Append("  \"nameFit\": [\n");
                {
                    string fitSample = "硅基流动 SiliconFlow";
                    Config snapF = ConfigClone(cfg, "ricebowl");
                    for (int fi = 0; fi < scanScales.Length; fi++)
                    {
                        double gsF = ScaleMath.GraphicsScale(snapF, scanScales[fi]);
                        BowlLayout layF = BowlLayout.Compute(snapF, 3, 1f, gsF);
                        float scaleF = (float)Math.Max(0.85, gsF);
                        ProviderView pvF = new ProviderView();
                        pvF.Name = fitSample;
                        BowlRenderer.NameFitInfo nfi = null;
                        try
                        {
                            using (Bitmap mbF = new Bitmap(4, 4))
                            using (Graphics mgF = Graphics.FromImage(mbF))
                            {
                                nfi = BowlRenderer.FitNameForSlot(mgF, layF, snapF, pvF, scaleF);
                            }
                        }
                        catch { }
                        if (nfi == null) nfi = new BowlRenderer.NameFitInfo();
                        float offF = Math.Max(0.6f, 0.7f * scaleF);
                        float availW = layF.BowlW - 4f * scaleF;          // 测试：selftest nameMaxW 口径
                        float leftMargin = (availW - nfi.InkW) / 2f;
                        float rightMargin = leftMargin - offF;            // 暗刻痕阴影右移 off
                        bool fitsF = nfi.InkW > 0f && nfi.InkW <= availW - 2f && leftMargin >= 1f && rightMargin >= 1f;
                        if (fi > 0) sb.Append(",\n");
                        sb.Append("    { \"petScale\": ").Append(FormatNum(scanScales[fi]))
                          .Append(", \"graphicsScale\": ").Append(FormatNum(gsF))
                          .Append(", \"bowlW\": ").Append(layF.BowlW)
                          .Append(", \"sampleName\": ").Append(Json.Quote(fitSample))
                          .Append(", \"basePx\": ").Append(FormatNum(nfi.BasePx))
                          .Append(", \"minPx\": ").Append(FormatNum(nfi.FloorPx))
                          .Append(", \"fitPx\": ").Append(FormatNum(nfi.FitPx))
                          .Append(", \"maxW\": ").Append(FormatNum(nfi.MaxW))
                          .Append(", \"availW\": ").Append(FormatNum(availW))
                          .Append(", \"inkW\": ").Append(FormatNum(nfi.InkW))
                          .Append(", \"leftMargin\": ").Append(FormatNum(leftMargin))
                          .Append(", \"rightMargin\": ").Append(FormatNum(rightMargin))
                          .Append(", \"shrunk\": ").Append(nfi.Shrunk ? "true" : "false")
                          .Append(", \"ellipsized\": ").Append(nfi.Ellipsized ? "true" : "false")
                          .Append(", \"fits\": ").Append(fitsF ? "true" : "false")
                          .Append(", \"drawText\": ").Append(Json.Quote(nfi.DrawText ?? ""))
                          .Append(" }");
                    }
                }
                sb.Append("\n  ],\n");
                // ---- labelStyles：三款统一视觉 v4（L1/L2 与 L3 同三条带；四档；测试 LABEL-11/12/13 用）----
                sb.Append("  \"labelStyles\": [\n");
                {
                    string[] lsArr = new string[] { "L1", "L2", "L3" };
                    bool firstLs = true;
                    for (int li = 0; li < lsArr.Length; li++)
                    {
                        for (int fi2 = 0; fi2 < scanScales.Length; fi2++)
                        {
                            Config snapL = ConfigClone(cfg, "ricebowl");
                            snapL.Display.LabelStyle = lsArr[li];
                            double gsL = ScaleMath.GraphicsScale(snapL, scanScales[fi2]);
                            BowlLayout layL = BowlLayout.Compute(snapL, 2, 1f, gsL);
                            ProviderView[] viewsL = DemoData.BuildViews(2, snapL);
                            ProviderView vL = viewsL.Length > 0 ? viewsL[0] : null;
                            VisualStyle stL = VisualStyleBuilder.Build(ti, cfg.Theme.Force, cfg.Display.BowlStyle, cfg.Theme.Follow);
                            BowlSlot slotL = layL.Slots.Count > 0 ? layL.Slots[0] : null;
                            BowlRenderer.LabelMetrics mL = BowlRenderer.MeasureLabel(snapL, layL, slotL, vL, layL.Asset, stL, 1f, lsArr[li]);
                            if (!firstLs) sb.Append(",\n");
                            firstLs = false;
                            sb.Append("    { \"labelStyle\": ").Append(Json.Quote(mL.LabelStyle))
                              .Append(", \"petScale\": ").Append(FormatNum(scanScales[fi2]))
                              .Append(", \"graphicsScale\": ").Append(FormatNum(gsL))
                              .Append(", \"bowlW\": ").Append(layL.BowlW)
                              .Append(", \"bowlH\": ").Append(layL.BowlH)
                              .Append(", \"groupH\": ").Append(layL.GroupH)
                              .Append(", \"rimY\": ").Append(FormatNum(mL.RimBottom))
                              .Append(", \"frontFace\": ").Append(FormatNum(mL.FrontFace))
                              .Append(", \"frontCenterY\": ").Append(FormatNum(mL.FrontCenterY))
                              .Append(", \"namePx\": ").Append(FormatNum(mL.NamePx))
                              .Append(", \"nameH\": ").Append(FormatNum(mL.NameH))
                              .Append(", \"nameY\": ").Append(FormatNum(mL.NameY))
                              .Append(", \"nameCenterY\": ").Append(FormatNum(mL.NameCenterY))
                              .Append(", \"dotD\": ").Append(FormatNum(mL.DotD))
                              .Append(", \"dotCenterX\": ").Append(FormatNum(mL.DotCx))
                              .Append(", \"dotCenterY\": ").Append(FormatNum(mL.DotCy))
                              .Append(", \"valPx\": ").Append(FormatNum(mL.ValPx))
                              .Append(", \"valH\": ").Append(FormatNum(mL.ValH))
                              .Append(", \"valY\": ").Append(FormatNum(mL.ValY))
                              .Append(", \"valCenterY\": ").Append(FormatNum(mL.ValCenterY))
                              .Append(", \"blockTop\": ").Append(FormatNum(mL.BlockTop))
                              .Append(", \"blockBottom\": ").Append(FormatNum(mL.BlockBottom))
                              .Append(", \"blockCenterY\": ").Append(FormatNum(mL.BlockCenterY))
                              .Append(", \"blockCenterDiff\": ").Append(FormatNum(mL.BlockCenterY - mL.FrontCenterY))
                              .Append(", \"nameContrast\": ").Append(FormatNum(mL.NameContrast))
                              .Append(", \"valContrast\": ").Append(FormatNum(mL.ValContrast))
                              .Append(", \"nameTextW\": ").Append(FormatNum(mL.NameInkW))
                              .Append(", \"nameMaxW\": ").Append(FormatNum(mL.NameAreaW))
                              .Append(", \"valTextW\": ").Append(FormatNum(mL.ValInkW))
                              .Append(", \"valMaxW\": ").Append(FormatNum(mL.ValAreaW))
                              .Append(", \"nameDrawText\": ").Append(Json.Quote(mL.NameText ?? ""))
                              .Append(", \"valDrawText\": ").Append(Json.Quote(mL.ValText ?? ""))
                              .Append(", \"nameFits\": ").Append(mL.NameFits ? "true" : "false")
                              .Append(", \"valFits\": ").Append(mL.ValFits ? "true" : "false")
                              .Append(", \"nameShrunk\": ").Append(mL.NameShrunk ? "true" : "false")
                              .Append(", \"nameEllipsized\": ").Append(mL.NameEllipsized ? "true" : "false")
                              .Append(", \"valShrunk\": ").Append(mL.ValShrunk ? "true" : "false")
                              .Append(", \"valEllipsized\": ").Append(mL.ValEllipsized ? "true" : "false")
                              .Append(", \"dotCentered\": ").Append(mL.DotCentered ? "true" : "false")
                              .Append(", \"inFrontFace\": ").Append(mL.InFrontFace ? "true" : "false")
                              .Append(", \"noRimOverlap\": ").Append(mL.NoRimOverlap ? "true" : "false")
                              .Append(", \"inBitmap\": ").Append(mL.InBitmap ? "true" : "false");
                            if (lsArr[li] == "L2")
                            {
                                sb.Append(", \"flagW\": ").Append(FormatNum(mL.FlagW))
                                  .Append(", \"flagH\": ").Append(FormatNum(mL.FlagH))
                                  .Append(", \"flagInnerW\": ").Append(FormatNum(mL.FlagInnerW))
                                  .Append(", \"flagTopY\": ").Append(FormatNum(mL.FlagTopY))
                                  .Append(", \"flagBottomGap\": ").Append(FormatNum(mL.FlagBottomGap))
                                  .Append(", \"flagInBitmap\": ").Append(mL.FlagInBitmap ? "true" : "false");
                            }
                            sb.Append(" }");
                        }
                    }
                }
                sb.Append("\n  ],\n");
                // ---- wearProbe：饭桶位置两态（feet 脚底 / head 头顶）离线证明（测试 WEAR 组）----
                sb.Append("  \"wearProbe\": {\n");
                {
                    string cfgWear = WearMath.IsHead(cfg) ? "head" : "feet";
                    float dpiW = app.DpiScale;
                    int contactW = WearMath.ContactPx(dpiW);
                    Config snapFeet = ConfigClone(cfg, "ricebowl");
                    snapFeet.Display.Wear = "feet";
                    BowlLayout layFeet = BowlLayout.Compute(snapFeet, 2, dpiW, app.GraphicsScaleVal);
                    Config snapHead = ConfigClone(cfg, "ricebowl");
                    snapHead.Display.Wear = "head";
                    BowlLayout layHead = BowlLayout.Compute(snapHead, 2, dpiW, app.GraphicsScaleVal);
                    int feetLift = WearMath.FeetLift(layFeet, dpiW);
                    int feetBottom = WearMath.FeetPanelBottom(cfg, app.WorkBottom);
                    sb.Append("    \"cfgWear\": ").Append(Json.Quote(cfgWear))
                      .Append(", \"dpiScale\": ").Append(FormatNum(dpiW))
                      .Append(", \"contactPx\": ").Append(contactW)
                      .Append(",\n    \"feet\": { \"groupH\": ").Append(layFeet.GroupH)
                      .Append(", \"lift\": ").Append(feetLift)
                      .Append(", \"panelHeight\": ").Append(layFeet.GroupH)
                      .Append(", \"panelBottom\": ").Append(feetBottom)
                      .Append(", \"panelTop\": ").Append(feetBottom - layFeet.GroupH)
                      .Append(", \"wheelH\": ").Append(layFeet.WheelH).Append(" }")
                      .Append(",\n    \"head\": { \"groupH\": ").Append(layHead.GroupH)
                      .Append(", \"lift\": 0")
                      .Append(", \"panelHeight\": ").Append(layHead.GroupH)
                      .Append(", \"panelBottomFormula\": \"headScreen - panelHeight + contact\"")
                      .Append(", \"wheelHForcedOff\": ").Append(layHead.WheelH == 0 ? "true" : "false")
                      .Append(", \"wheelH\": ").Append(layHead.WheelH)
                      .Append(",\n      \"samples\": [");
                    int[] headSamples = new int[] { 900, app.WorkTop + 30, app.WorkBottom - 4 };
                    for (int hi2 = 0; hi2 < headSamples.Length; hi2++)
                    {
                        int hs = headSamples[hi2];
                        int rawY = hs - layHead.GroupH + contactW;
                        int py = WearMath.HeadPanelY(hs, layHead.GroupH, contactW, app.WorkTop, app.MonBottom);
                        if (hi2 > 0) sb.Append(", ");
                        sb.Append("{ \"headScreen\": ").Append(hs)
                          .Append(", \"panelY\": ").Append(py)
                          .Append(", \"rawPanelY\": ").Append(rawY)
                          .Append(", \"clamped\": ").Append(py != rawY ? "true" : "false")
                          .Append(", \"inWorkArea\": ").Append((py >= app.WorkTop && py + layHead.GroupH <= app.MonBottom) ? "true" : "false")
                          .Append(" }");
                    }
                    sb.Append("] },\n    \"sizes\": [");
                    for (int si3 = 0; si3 < scanScales.Length; si3++)
                    {
                        Config snapS = ConfigClone(cfg, "ricebowl");
                        double gsS = ScaleMath.GraphicsScale(snapS, scanScales[si3]);
                        snapS.Display.Wear = "feet";
                        BowlLayout laySF = BowlLayout.Compute(snapS, 2, 1f, gsS);
                        snapS.Display.Wear = "head";
                        BowlLayout laySH = BowlLayout.Compute(snapS, 2, 1f, gsS);
                        if (si3 > 0) sb.Append(", ");
                        sb.Append("{ \"petScale\": ").Append(FormatNum(scanScales[si3]))
                          .Append(", \"graphicsScale\": ").Append(FormatNum(gsS))
                          .Append(", \"groupHFeet\": ").Append(laySF.GroupH)
                          .Append(", \"feetLift\": ").Append(WearMath.FeetLift(laySF, 1f))
                          .Append(", \"headPanelHeight\": ").Append(laySH.GroupH)
                          .Append(", \"headWheelH\": ").Append(laySH.WheelH)
                          .Append(" }");
                    }
                    Config snapW2 = ConfigClone(cfg, "ricebowl");
                    snapW2.Display.Wheels = true;
                    snapW2.Display.Wear = "feet";
                    BowlLayout layWF = BowlLayout.Compute(snapW2, 2, dpiW, app.GraphicsScaleVal);
                    snapW2.Display.Wear = "head";
                    BowlLayout layWH = BowlLayout.Compute(snapW2, 2, dpiW, app.GraphicsScaleVal);
                    sb.Append("],\n    \"wheelsCase\": {")
                      .Append(" \"cfgWheels\": true, \"wearFeetWheelH\": ").Append(layWF.WheelH)
                      .Append(", \"wearHeadWheelH\": ").Append(layWH.WheelH)
                      .Append(", \"headWindowHShrunkBy\": ").Append(layWF.GroupH - layWH.GroupH)
                      .Append(" }\n  },\n");
                }
                // ---- themePlaque：L3 木牌配色随主题（THEME-12）离线证明：底色/亮度/金额对比度 ----
                sb.Append("  \"themePlaque\": {\n");
                {
                    Config snapP = ConfigClone(cfg, "ricebowl");
                    BowlLayout layP = BowlLayout.Compute(snapP, 2, 1f, app.GraphicsScaleVal);
                    Color bodyP = BowlRenderer.BodyBaseColor(layP.Asset);
                    double[] lums = new double[2];
                    for (int pi = 0; pi < 2; pi++)
                    {
                        string thm = pi == 0 ? "dark" : "light";
                        VisualStyle stP = VisualStyleBuilder.Build(ti, thm, cfg.Display.BowlStyle, cfg.Theme.Follow);
                        Color fill = BowlRenderer.WoodPlaqueFill(stP, layP.Asset);
                        Color border = BowlRenderer.WoodPlaqueBorder(stP);
                        lums[pi] = LumSimple(fill);
                        Color amtInk = BowlRenderer.EnsureContrast(stP.AmountColor, fill, 4.5);
                        sb.Append("    ").Append(Json.Quote(thm)).Append(": { \"theme\": ").Append(Json.Quote(stP.Theme))
                          .Append(", \"paletteSource\": ").Append(Json.Quote(ti != null && ti.PaletteOk ? "api" : "fallback"))
                          .Append(", \"plaqueFill\": ").Append(Json.Quote(Hex(fill)))
                          .Append(", \"plaqueBorder\": ").Append(Json.Quote(Hex(border)))
                          .Append(", \"plaqueLum\": ").Append(FormatNum(lums[pi]))
                          .Append(", \"lumMethod\": \"srgb-weighted(0.2126R+0.7152G+0.0722B, 与测试探针一致)\"")
                          .Append(", \"bodyBase\": ").Append(Json.Quote(Hex(bodyP)))
                          .Append(", \"amountInk\": ").Append(Json.Quote(Hex(amtInk)))
                          .Append(", \"amountContrast\": ").Append(FormatNum(ContrastRatio(amtInk, fill)))
                          .Append(" }");
                        if (pi == 0) sb.Append(",\n");
                    }
                    sb.Append(",\n    \"lumDelta\": ").Append(FormatNum(Math.Abs(lums[0] - lums[1]))).Append("\n");
                }
                sb.Append("  },\n");
                // ---- wheelsProbe：轮子彩蛋离线证明（强制 wheels=true 配置副本、2 家、angle=0/30/60/90 四帧）----
                sb.Append("  \"wheelsProbe\": {\n");
                {
                    Config snapW = ConfigClone(cfg, "ricebowl");
                    snapW.Display.LabelStyle = cfg.Display.LabelStyle;
                    snapW.Display.Wheels = true;
                    double gsW = ScaleMath.GraphicsScale(snapW, app.PetScaleApi);
                    BowlLayout layW = BowlLayout.Compute(snapW, 2, 1f, gsW);
                    VisualStyle styleW = VisualStyleBuilder.Build(ti, cfg.Theme.Force, cfg.Display.BowlStyle, cfg.Theme.Follow);
                    Bitmap baseW = BowlRenderer.Render(snapW, DemoData.BuildViews(2, snapW), layW, styleW, 1f);
                    int[] baseArg = ArgbPixels(baseW);
                    int[] angles = new int[] { 0, 30, 60, 90 };
                    int staticWheelPx = WheelBandPixels(baseArg, baseW.Width, baseW.Height, layW, 1);
                    string jsonDir = Path.GetDirectoryName(outPath);
                    if (string.IsNullOrEmpty(jsonDir)) jsonDir = ".";
                    string jsonBase = Path.GetFileNameWithoutExtension(outPath);
                    StringBuilder frameJson = new StringBuilder();
                    StringBuilder diffJson = new StringBuilder();
                    int[] prevArg = baseArg;
                    int[] angle0Arg = null;
                    int staticVsAngle0 = -1;
                    bool framesSaved = true;
                    for (int ai = 0; ai < angles.Length; ai++)
                    {
                        Bitmap fr = BowlRenderer.WithWheels(baseW, layW, styleW, angles[ai]);
                        string frPath = "";
                        int frameDiff = -1;
                        if (fr != null)
                        {
                            frPath = Path.Combine(jsonDir, jsonBase + ".wheels-" + angles[ai].ToString(CultureInfo.InvariantCulture) + ".png");
                            // 帧差必须在内存里先算：对比 PNG 落盘在某些文件系统组合会抛 GDI+ 一般性错误（0x80004005），
                            // 保存失败只影响截图文件，不能拖垮整个 selftest；重试一次仍失败则 frames 记空串并置 framesSaved=false。
                            int[] frArg = ArgbPixels(fr);
                            frameDiff = CountDiffPixels(prevArg, frArg);
                            if (ai == 0)
                            {
                                angle0Arg = frArg;
                                staticVsAngle0 = frameDiff;
                            }
                            prevArg = frArg;
                            bool saved = false;
                            for (int attempt = 0; attempt < 2 && !saved; attempt++)
                            {
                                try
                                {
                                    fr.Save(frPath, ImageFormat.Png);
                                    saved = true;
                                }
                                catch (Exception exSave)
                                {
                                    if (attempt == 0)
                                    {
                                        System.Threading.Thread.Sleep(30);
                                    }
                                    else
                                    {
                                        framesSaved = false;
                                        Log.Write("WARN wheelsProbe frame save failed path=" + frPath + " err=" + Program.SafeText(exSave.Message));
                                    }
                                }
                            }
                            if (!saved) frPath = "";
                            fr.Dispose();
                        }
                        if (ai > 0) { frameJson.Append(", "); diffJson.Append(", "); }
                        frameJson.Append(Json.Quote(frPath));
                        diffJson.Append(frameDiff.ToString(CultureInfo.InvariantCulture));
                    }
                    sb.Append("    \"wheelH\": ").Append(layW.WheelH)
                      .Append(", \"groupW\": ").Append(layW.GroupW)
                      .Append(", \"groupH\": ").Append(layW.GroupH)
                      .Append(", \"slots\": ").Append(layW.Slots.Count)
                      .Append(", \"dpiScale\": 1")
                      .Append(", \"graphicsScale\": ").Append(FormatNum(gsW))
                      .Append(", \"staticWheelPixels\": ").Append(staticWheelPx)
                      .Append(", \"angles\": [0, 30, 60, 90]")
                      .Append(", \"frameDiffs\": [").Append(diffJson.ToString()).Append("]")
                      .Append(", \"staticVsAngle0Diff\": ").Append(staticVsAngle0)
                      .Append(", \"frames\": [").Append(frameJson.ToString()).Append("]")
                      .Append(", \"framesSaved\": ").Append(framesSaved ? "true" : "false");
                    // 两行布局补充：6 家 + twoRows，验证 Row=0/1 各自附着、各自旋转（离屏、不弹窗）
                    Config snap2R = ConfigClone(cfg, "ricebowl");
                    snap2R.Display.LabelStyle = cfg.Display.LabelStyle;
                    snap2R.Display.Wheels = true;
                    snap2R.Display.NineLayout = "twoRows";
                    double gs2R = ScaleMath.GraphicsScale(snap2R, app.PetScaleApi);
                    BowlLayout lay2R = BowlLayout.Compute(snap2R, 6, 1f, gs2R);
                    Bitmap base2R = BowlRenderer.Render(snap2R, DemoData.BuildViews(6, snap2R), lay2R, styleW, 1f);
                    int[] arg2R = ArgbPixels(base2R);
                    int row0Diff = -1, row1Diff = -1;
                    int totalDiff = -1, outsideBandDiff = -1;
                    Bitmap rot2R = BowlRenderer.WithWheels(base2R, lay2R, styleW, 90f);
                    if (rot2R != null)
                    {
                        int[] rot2Arg = ArgbPixels(rot2R);
                        row0Diff = WheelBandDiffPixels(arg2R, rot2Arg, base2R.Width, base2R.Height, lay2R, 0);
                        row1Diff = WheelBandDiffPixels(arg2R, rot2Arg, base2R.Width, base2R.Height, lay2R, 1);
                        totalDiff = CountDiffPixels(arg2R, rot2Arg);
                        int allBandDiff = WheelBandDiffPixels(arg2R, rot2Arg, base2R.Width, base2R.Height, lay2R, -1);
                        outsideBandDiff = (totalDiff >= 0 && allBandDiff >= 0) ? totalDiff - allBandDiff : -1;
                        rot2R.Dispose();
                    }
                    base2R.Dispose();
                    sb.Append(",\n    \"twoRowsProbe\": { \"slots\": ").Append(lay2R.Slots.Count)
                      .Append(", \"twoRows\": ").Append(lay2R.TwoRows ? "true" : "false")
                      .Append(", \"wheelH\": ").Append(lay2R.WheelH)
                      .Append(", \"groupH\": ").Append(lay2R.GroupH)
                      .Append(", \"row0BandDiff\": ").Append(row0Diff)
                      .Append(", \"row1BandDiff\": ").Append(row1Diff)
                      .Append(", \"totalDiff\": ").Append(totalDiff)
                      .Append(", \"outsideBandDiff\": ").Append(outsideBandDiff)
                      .Append(" }\n");
                    baseW.Dispose();
                }
                sb.Append("  },\n");
                sb.Append("  \"providers\": [\n");
                for (int i = 0; i < cfg.Providers.Count; i++)
                {
                    ProviderConfig p = cfg.Providers[i];
                    sb.Append("    { \"id\": ").Append(Json.Quote(p.Id))
                      .Append(", \"name\": ").Append(Json.Quote(p.Name))
                      .Append(", \"type\": ").Append(Json.Quote(p.Type))
                      .Append(", \"preset\": ").Append(Json.Quote(p.Preset))
                      .Append(", \"fullAmount\": ").Append(FormatNum(p.FullAmount))
                      .Append(", \"threshold\": ").Append(p.Threshold.HasValue ? FormatNum(p.Threshold.Value) : "null")
                      .Append(", \"intervalSec\": ").Append(p.IntervalSec)
                      .Append(", \"enabled\": ").Append(p.Enabled ? "true" : "false")
                      .Append(" }");
                    if (i + 1 < cfg.Providers.Count) sb.Append(",");
                    sb.Append("\n");
                }
                sb.Append("  ]\n");
                sb.Append("}\n");
                string dir = Path.GetDirectoryName(outPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(outPath, sb.ToString(), new UTF8Encoding(false));
                Log.Write("selftest saved path=" + outPath + " layouts=" + (styles.Length * scales.Length * 8));
                return 0;
            }
            catch (Exception ex)
            {
                try { Log.Write("ERROR selftest: " + Program.SafeText(ex.Message)); }
                catch { }
                return 4;
            }
        }

        /// <summary>v4 调试：无窗口只读探测一次桌宠（给部署前校验 head/feet 检测；不建窗口、不抢单实例、不改现场）。</summary>
        public static int ProbePet(string outPath)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                Log.Init(Path.Combine(baseDir, "panel.log"));
                NativeV3.TryEnablePerMonitorV2();
                AppContext app = new AppContext(baseDir);
                return app.ProbePetOnce(outPath);
            }
            catch (Exception ex)
            {
                try { Log.Write("ERROR probe-pet init: " + Program.SafeText(ex.Message)); } catch { }
                return 4;
            }
        }

        /// <summary>layoutProbe 单条 case（离线几何 JSON；显式覆盖 nineLayout，不写 config）。</summary>
        private static string LayoutProbeCaseJson(Config cfg, string layoutOverride, int count, double petScale, float dpi)
        {
            Config snap = ConfigClone(cfg, "ricebowl");
            snap.Display.NineLayout = layoutOverride;
            snap.Display.Wear = "feet";
            snap.Display.Wheels = false;
            double gs = ScaleMath.GraphicsScale(snap, petScale);
            BowlLayout lay = BowlLayout.Compute(snap, count, dpi, gs);
            BowlLayout rowRef = null;
            if (lay.Pyramid)
            {
                Config snapRow = ConfigClone(cfg, "ricebowl");
                snapRow.Display.NineLayout = "row";
                snapRow.Display.Wear = "feet";
                snapRow.Display.Wheels = false;
                rowRef = BowlLayout.Compute(snapRow, count, dpi, gs);
            }
            int[] rc = lay.RowCounts.ToArray();
            if (rc.Length == 0) rc = new int[] { count };
            int rows = rc.Length;
            int[] rowWidths = new int[rows];
            double[] rowCenterDeltas = new double[rows];
            int[] rowBottoms = new int[rows];
            for (int r = 0; r < rows; r++)
            {
                int rowNo = rows - 1 - r;
                int minX = int.MaxValue, maxX = int.MinValue, bottom = 0;
                for (int si = 0; si < lay.Slots.Count; si++)
                {
                    BowlSlot s = lay.Slots[si];
                    if (s.Row != rowNo) continue;
                    if (s.X < minX) minX = s.X;
                    if (s.X + s.BowlW > maxX) maxX = s.X + s.BowlW;
                    bottom = s.Bottom;
                }
                rowWidths[r] = (minX == int.MaxValue) ? 0 : (maxX - minX);
                rowCenterDeltas[r] = (minX == int.MaxValue) ? 0 : Math.Round((minX + maxX) / 2.0 - lay.GroupW / 2.0, 1);
                rowBottoms[r] = bottom;
            }
            bool inGroup = true;
            bool sameRowNoOverlap = true;
            int minTop = int.MaxValue;
            for (int si = 0; si < lay.Slots.Count; si++)
            {
                BowlSlot s = lay.Slots[si];
                if (s.X < 0 || s.X + s.BowlW > lay.GroupW || s.Top < 0 || s.Bottom > lay.GroupH - lay.WheelH) inGroup = false;
                if (s.Top < minTop) minTop = s.Top;
            }
            for (int r = 0; r < rows; r++)
            {
                int rowNo = rows - 1 - r;
                int prevRight = int.MinValue;
                for (int si = 0; si < lay.Slots.Count; si++)
                {
                    BowlSlot s = lay.Slots[si];
                    if (s.Row != rowNo) continue;
                    if (prevRight != int.MinValue && s.X < prevRight + lay.Gap - 1) sameRowNoOverlap = false;
                    prevRight = s.X + s.BowlW;
                }
            }
            StringBuilder sb = new StringBuilder(512);
            sb.Append("{ \"layout\": ").Append(Json.Quote(lay.Pyramid ? "pyramid" : (lay.TwoRows ? "twoRows" : "row")))
              .Append(", \"count\": ").Append(count)
              .Append(", \"petScale\": ").Append(FormatNum(petScale))
              .Append(", \"dpiScale\": ").Append(FormatNum(dpi))
              .Append(", \"graphicsScale\": ").Append(FormatNum(gs))
              .Append(", \"compact\": ").Append(lay.Compact ? "true" : "false")
              .Append(", \"pyramid\": ").Append(lay.Pyramid ? "true" : "false")
              .Append(", \"twoRows\": ").Append(lay.TwoRows ? "true" : "false")
              .Append(", \"rowCounts\": ").Append(RowCountsJson(lay))
              .Append(", \"rowWidths\": [");
            for (int i = 0; i < rows; i++) { if (i > 0) sb.Append(", "); sb.Append(rowWidths[i]); }
            sb.Append("], \"rowCenterDeltas\": [");
            for (int i = 0; i < rows; i++) { if (i > 0) sb.Append(", "); sb.Append(FormatNum(rowCenterDeltas[i])); }
            sb.Append("], \"rowBottoms\": [");
            for (int i = 0; i < rows; i++) { if (i > 0) sb.Append(", "); sb.Append(rowBottoms[i]); }
            sb.Append("]")
              .Append(", \"rowShift\": ").Append(lay.RowShift)
              .Append(", \"rowPitch\": ").Append(lay.RowShift)
              .Append(", \"overflowAbove\": ").Append(lay.RowShift > 0 ? (lay.RowShift - lay.BowlH) : 0)
              .Append(", \"topRowTop\": ").Append(minTop)
              .Append(", \"gap\": ").Append(lay.Gap)
              .Append(", \"bowlW\": ").Append(lay.BowlW)
              .Append(", \"bowlH\": ").Append(lay.BowlH)
              .Append(", \"wheelH\": ").Append(lay.WheelH)
              .Append(", \"groupW\": ").Append(lay.GroupW)
              .Append(", \"groupH\": ").Append(lay.GroupH)
              .Append(", \"lift\": ").Append(WearMath.FeetLift(lay, dpi));
            if (rowRef != null)
            {
                sb.Append(", \"baseGroupHRow\": ").Append(rowRef.GroupH)
                  .Append(", \"bowlWRow\": ").Append(rowRef.BowlW)
                  .Append(", \"pyramidVsRowPct\": ").Append(FormatNum(rowRef.BowlW > 0 ? lay.BowlW * 100.0 / rowRef.BowlW : 0));
            }
            sb.Append(", \"slots\": [");
            for (int si = 0; si < lay.Slots.Count; si++)
            {
                BowlSlot s = lay.Slots[si];
                if (si > 0) sb.Append(", ");
                sb.Append("{ \"i\": ").Append(s.Index).Append(", \"row\": ").Append(s.Row)
                  .Append(", \"x\": ").Append(s.X).Append(", \"top\": ").Append(s.Top)
                  .Append(", \"bottom\": ").Append(s.Bottom).Append(", \"w\": ").Append(s.BowlW)
                  .Append(", \"h\": ").Append(s.BowlH).Append(", \"cx\": ").Append(s.X + s.BowlW / 2).Append(" }");
            }
            sb.Append("], \"inGroup\": ").Append(inGroup ? "true" : "false")
              .Append(", \"sameRowNoOverlap\": ").Append(sameRowNoOverlap ? "true" : "false").Append(" }");
            return sb.ToString();
        }

        private static string RowCountsJson(BowlLayout lay)
        {
            if (lay == null || lay.RowCounts == null || lay.RowCounts.Count == 0) return "[]";
            StringBuilder sb = new StringBuilder();
            sb.Append('[');
            for (int i = 0; i < lay.RowCounts.Count; i++)
            {
                if (i > 0) sb.Append(", ");
                sb.Append(lay.RowCounts[i]);
            }
            sb.Append(']');
            return sb.ToString();
        }

        public static int RunShot(string outPath, int demoCount)
        {
            return RunShot(outPath, demoCount, null, null, null, null, 0, null);
        }

        public static int RunShot(string outPath, int demoCount, string labelStyle)
        {
            return RunShot(outPath, demoCount, labelStyle, null, null, null, 0, null);
        }

        public static int RunShot(string outPath, int demoCount, string labelStyle, string wear)
        {
            return RunShot(outPath, demoCount, labelStyle, wear, null, null, 0, null);
        }

        /// <summary>无窗口出图；labelStyle/wear/layout/theme/scale/state 非空时覆盖（仅出图用，不写 config）。</summary>
        public static int RunShot(string outPath, int demoCount, string labelStyle, string wear, string layout, string theme, double petScaleOverride, string state)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                Log.Init(Path.Combine(baseDir, "panel.log"));
                NativeV3.TryEnablePerMonitorV2();
                AppContext app = new AppContext(baseDir);
                app.DemoCount = Math.Max(1, Math.Min(12, demoCount));
                app.HeadlessInit();
                Config cfg = app.Cfg;
                if (!string.IsNullOrEmpty(labelStyle))
                {
                    string ls0 = labelStyle.Trim().ToUpperInvariant();
                    if (ls0 == "L1" || ls0 == "L2" || ls0 == "L3") cfg.Display.LabelStyle = ls0;
                }
                if (!string.IsNullOrEmpty(wear))
                {
                    string w0 = wear.Trim().ToLowerInvariant();
                    if (w0 == "head" || w0 == "feet") cfg.Display.Wear = w0;
                }
                if (!string.IsNullOrEmpty(layout))
                {
                    string l0 = layout.Trim().ToLowerInvariant();
                    if (l0 == "row9") l0 = "row";
                    if (l0 == "row" || l0 == "pyramid") cfg.Display.NineLayout = l0;
                    else if (l0 == "tworows") cfg.Display.NineLayout = "twoRows";
                }
                if (!string.IsNullOrEmpty(theme))
                {
                    string t0 = theme.Trim().ToLowerInvariant();
                    if (t0 == "dark" || t0 == "light")
                    {
                        cfg.Theme.Force = t0;
                        app.Style = VisualStyleBuilder.Build(app.ThemeInfo, t0, cfg.Display.BowlStyle, false);
                    }
                }
                if (petScaleOverride > 0)
                {
                    app.PetScaleApi = petScaleOverride;
                    app.GraphicsScaleVal = ScaleMath.GraphicsScale(cfg, petScaleOverride);
                }
                int n = app.DemoCount;
                ProviderView[] views = DemoData.BuildViews(n, cfg, state);
                Bitmap bmp;
                BowlLayout lay = BowlLayout.Compute(cfg, n, app.DpiScale, app.GraphicsScaleVal);
                if (lay.Style == "capsule")
                {
                    int cw, ch, step;
                    AppContext.CapsuleMetrics(cfg, app.DpiScale, out cw, out ch, out step);
                    bmp = Renderer.Render(views, lay.GroupW, lay.GroupH, app.DpiScale, cw, ch, step);
                }
                else
                {
                    bmp = BowlRenderer.Render(cfg, views, lay, app.Style, app.DpiScale);
                }
                string dir = Path.GetDirectoryName(outPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                bmp.Save(outPath, ImageFormat.Png);
                Log.Write("shot saved path=" + outPath + " count=" + n + " w=" + bmp.Width + " h=" + bmp.Height
                    + " style=" + lay.Style + " dpi=" + FormatNum(app.DpiScale)
                    + " layout=" + cfg.Display.NineLayout + " rows=" + lay.RowCountsText() + " wear=" + cfg.Display.Wear
                    + " theme=" + (app.Style == null ? "" : app.Style.Theme)
                    + " petScale=" + FormatNum(app.PetScaleApi) + " state=" + (state ?? "normal"));
                bmp.Dispose();
                return 0;
            }
            catch (Exception ex)
            {
                try { Log.Write("ERROR shot: " + Program.SafeText(ex.Message)); }
                catch { }
                return 5;
            }
        }

        /// <summary>位图 → ARGB 数组（0xAARRGGBB），供 wheelsProbe 帧差/轮带像素统计用。</summary>
        private static int[] ArgbPixels(Bitmap bmp)
        {
            int w = bmp.Width, h = bmp.Height;
            int[] px = new int[w * h];
            BitmapData bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                int stride = bd.Stride;
                byte[] buf = new byte[stride * h];
                Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
                for (int y = 0; y < h; y++)
                {
                    int row = y * stride;
                    for (int x = 0; x < w; x++)
                    {
                        int o = row + x * 4;
                        px[y * w + x] = (buf[o + 3] << 24) | (buf[o + 2] << 16) | (buf[o + 1] << 8) | buf[o];
                    }
                }
            }
            finally
            {
                bmp.UnlockBits(bd);
            }
            return px;
        }

        private static int CountDiffPixels(int[] a, int[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return -1;
            int n = 0;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) n++;
            return n;
        }

        /// <summary>统计指定行的「盆底轮带」内非透明像素数（证明轮子确实画进静态帧）。</summary>
        private static int WheelBandPixels(int[] argb, int w, int h, BowlLayout lay, int row)
        {
            if (argb == null || lay == null) return 0;
            int n = 0;
            for (int si = 0; si < lay.Slots.Count; si++)
            {
                BowlSlot s = lay.Slots[si];
                if (row >= 0 && s.Row != row) continue;
                int y0 = Math.Max(0, s.Bottom);
                int y1 = Math.Min(h, s.Bottom + lay.WheelH);
                int x0 = Math.Max(0, s.X);
                int x1 = Math.Min(w, s.X + s.BowlW);
                for (int y = y0; y < y1; y++)
                {
                    int rowOff = y * w;
                    for (int x = x0; x < x1; x++)
                    {
                        if (((argb[rowOff + x] >> 24) & 0xFF) > 0) n++;
                    }
                }
            }
            return n;
        }

        /// <summary>统计指定行「盆底轮带」内的帧差像素数（两行布局证明 Row=0/1 各自旋转）。</summary>
        private static int WheelBandDiffPixels(int[] a, int[] b, int w, int h, BowlLayout lay, int row)
        {
            if (a == null || b == null || a.Length != b.Length || lay == null) return -1;
            int n = 0;
            for (int si = 0; si < lay.Slots.Count; si++)
            {
                BowlSlot s = lay.Slots[si];
                if (row >= 0 && s.Row != row) continue;
                int y0 = Math.Max(0, s.Bottom);
                int y1 = Math.Min(h, s.Bottom + lay.WheelH);
                int x0 = Math.Max(0, s.X);
                int x1 = Math.Min(w, s.X + s.BowlW);
                for (int y = y0; y < y1; y++)
                {
                    int rowOff = y * w;
                    for (int x = x0; x < x1; x++)
                    {
                        int o = rowOff + x;
                        if (a[o] != b[o]) n++;
                    }
                }
            }
            return n;
        }

        private static Config ConfigClone(Config src, string style)
        {
            Config c = new Config();
            c.Display.Style = style;
            c.Display.BowlStyle = src.Display.BowlStyle;
            c.Display.NineLayout = src.Display.NineLayout;
            c.Display.CompactAfter = src.Display.CompactAfter;
            c.Display.RefYuan = src.Display.RefYuan;
            c.Display.Wheels = src.Display.Wheels;
            c.Display.LabelStyle = src.Display.LabelStyle;
            c.Display.Wear = src.Display.Wear;
            c.Capsule = src.Capsule;
            c.Position = src.Position;
            return c;
        }

        internal static float ContrastRatio(Color a, Color b)
        {
            double la = RelLum(a), lb = RelLum(b);
            double hi = Math.Max(la, lb), lo = Math.Min(la, lb);
            return (float)((hi + 0.05) / (lo + 0.05));
        }

        internal static double RelLum(Color c)
        {
            double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0;
            r = r <= 0.03928 ? r / 12.92 : Math.Pow((r + 0.055) / 1.055, 2.4);
            g = g <= 0.03928 ? g / 12.92 : Math.Pow((g + 0.055) / 1.055, 2.4);
            b = b <= 0.03928 ? b / 12.92 : Math.Pow((b + 0.055) / 1.055, 2.4);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }

        private static string FormatNum(double v)
        {
            return v.ToString("0.####", CultureInfo.InvariantCulture);
        }

        private static string FormatNum(float v)
        {
            return v.ToString("0.####", CultureInfo.InvariantCulture);
        }

        /// <summary>测试探针口径的「简单亮度」（0.2126R+0.7152G+0.0722B，不线性化），与离线探针一致。</summary>
        private static double LumSimple(Color c)
        {
            return (0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B) / 255.0;
        }

        private static string Hex(Color c)
        {
            return string.Format(CultureInfo.InvariantCulture, "#{0:X2}{1:X2}{2:X2}", c.R, c.G, c.B);
        }
    }

    // ================================================================== Win32（DPI / 显示器）
    internal static class NativeV3
    {
        public static string DpiAwarenessMode = "unknown";

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDPIAware();

        [DllImport("shcore.dll")]
        private static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFOEX lpmi);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
            public POINT(int x, int y) { X = x; Y = y; }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct MONITORINFOEX
        {
            public int cbSize;
            public Native.RECT rcMonitor;
            public Native.RECT rcWork;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string szDevice;
        }

        public static void TryEnablePerMonitorV2()
        {
            try
            {
                if (SetProcessDpiAwarenessContext(new IntPtr(-4)))
                {
                    DpiAwarenessMode = "per-monitor-v2";
                    return;
                }
            }
            catch { }
            try
            {
                if (SetProcessDPIAware())
                {
                    DpiAwarenessMode = "system-aware";
                    return;
                }
            }
            catch { }
            DpiAwarenessMode = "none";
        }

        public static float GetWindowScale(IntPtr hwnd)
        {
            try
            {
                IntPtr mon = IntPtr.Zero;
                if (hwnd != IntPtr.Zero) mon = Native.MonitorFromWindow(hwnd, 2);
                else mon = MonitorFromPoint(new POINT(0, 0), 2);
                if (mon != IntPtr.Zero)
                {
                    uint dx, dy;
                    int hr = GetDpiForMonitor(mon, 0, out dx, out dy);
                    if (hr == 0 && dx > 0) return dx / 96f;
                }
            }
            catch { }
            try
            {
                IntPtr dc = Native.GetDC(IntPtr.Zero);
                int dpi = Native.GetDeviceCaps(dc, Native.LOGPIXELSX);
                Native.ReleaseDC(IntPtr.Zero, dc);
                if (dpi > 0) return dpi / 96f;
            }
            catch { }
            return 1f;
        }

        public static void GetMonitorRect(IntPtr hwnd, out int left, out int top, out int right, out int bottom, out string name)
        {
            left = 0; top = 0;
            right = Native.GetSystemMetrics(Native.SM_CXSCREEN);
            bottom = Native.GetSystemMetrics(Native.SM_CYSCREEN);
            name = "";
            try
            {
                IntPtr mon = hwnd != IntPtr.Zero ? Native.MonitorFromWindow(hwnd, 2) : MonitorFromPoint(new POINT(0, 0), 2);
                if (mon == IntPtr.Zero) return;
                MONITORINFOEX mi = new MONITORINFOEX();
                mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
                if (!GetMonitorInfoW(mon, ref mi)) return;
                left = mi.rcMonitor.Left;
                top = mi.rcMonitor.Top;
                right = mi.rcMonitor.Right;
                bottom = mi.rcMonitor.Bottom;
                name = mi.szDevice == null ? "" : mi.szDevice.Trim();
            }
            catch { }
        }
    }
}
