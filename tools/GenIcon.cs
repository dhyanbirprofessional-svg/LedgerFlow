using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

class GenIcon {
    static byte[] RenderPng(int size) {
        using (var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.Clear(Color.Transparent);

            float pad = size * 0.06f;
            float w = size - pad * 2;
            float r = size * 0.24f;

            using (var path = new GraphicsPath()) {
                path.AddArc(pad, pad, r, r, 180, 90);
                path.AddArc(pad + w - r, pad, r, r, 270, 90);
                path.AddArc(pad + w - r, pad + w - r, r, r, 0, 90);
                path.AddArc(pad, pad + w - r, r, r, 90, 90);
                path.CloseFigure();

                using (var brush = new LinearGradientBrush(
                    new PointF(pad, pad),
                    new PointF(pad + w, pad + w),
                    Color.FromArgb(16, 185, 129),
                    Color.FromArgb(79, 70, 229))) {
                    g.FillPath(brush, path);
                }
            }

            float stroke = Math.Max(1.6f, size * 0.09f);
            using (var pen = new Pen(Color.White, stroke)) {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                PointF[] pts = new PointF[] {
                    new PointF(size * 0.25f, size * 0.66f),
                    new PointF(size * 0.42f, size * 0.46f),
                    new PointF(size * 0.56f, size * 0.57f),
                    new PointF(size * 0.74f, size * 0.33f)
                };
                g.DrawLines(pen, pts);
            }

            float dotR = Math.Max(1.5f, size * 0.075f);
            using (var dotBrush = new SolidBrush(Color.White)) {
                g.FillEllipse(dotBrush, size * 0.74f - dotR, size * 0.33f - dotR, dotR * 2, dotR * 2);
            }

            using (var ms = new MemoryStream()) {
                bmp.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
        }
    }

    static void Main(string[] args) {
        if (args.Length < 1) {
            Console.Error.WriteLine("Usage: GenIcon.exe <output.ico>");
            Environment.Exit(1);
        }
        int[] sizes = new int[] { 16, 32, 48, 256 };
        var pngs = new List<byte[]>();
        foreach (int s in sizes) pngs.Add(RenderPng(s));

        string outPath = args[0];
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath)));
        using (var fs = new FileStream(outPath, FileMode.Create, FileAccess.Write))
        using (var bw = new BinaryWriter(fs)) {
            // ICONDIR header
            bw.Write((ushort)0); // reserved
            bw.Write((ushort)1); // type = icon
            bw.Write((ushort)sizes.Length);

            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++) {
                int s = sizes[i];
                byte dim = (byte)(s >= 256 ? 0 : s);
                bw.Write(dim); // width
                bw.Write(dim); // height
                bw.Write((byte)0); // color count
                bw.Write((byte)0); // reserved
                bw.Write((ushort)1); // planes
                bw.Write((ushort)32); // bpp
                bw.Write((uint)pngs[i].Length);
                bw.Write((uint)offset);
                offset += pngs[i].Length;
            }
            for (int i = 0; i < sizes.Length; i++) {
                bw.Write(pngs[i]);
            }
        }
        Console.WriteLine("Generated icon: " + outPath);
    }
}
