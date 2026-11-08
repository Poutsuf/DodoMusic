using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

namespace DodoSpoti;

public partial class Form1 : Form
{
    private WebView2 webView = null!;
    private Process? serverProcess;
    private const int PORT = 58240;
    private static readonly HttpClient http = new HttpClient();

    public Form1()
    {
        InitializeComponent();
        ConfigureWindow();
        InitializeAppAsync();
    }

    private void ConfigureWindow()
    {
        this.Text = "DodoSpoti";
        this.Width = 1320;
        this.Height = 840;
        this.MinimumSize = new Size(980, 660);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.BackColor = Color.FromArgb(7, 8, 12);

        string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico");
        if (File.Exists(iconPath))
        {
            try
            {
                this.Icon = new Icon(iconPath);
            }
            catch { }
        }

        webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(7, 8, 12)
        };
        this.Controls.Add(webView);
    }

    private async void InitializeAppAsync()
    {
        await EnsureServerRunningAsync();

        try
        {
            string userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "DodoSpoti",
                "WebView2Data"
            );
            Directory.CreateDirectory(userDataFolder);

            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await webView.EnsureCoreWebView2Async(env);

            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = false;

            webView.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                if (!string.IsNullOrEmpty(e.Uri) && e.Uri.StartsWith("http"))
                {
                    Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
                }
            };

            webView.Source = new Uri($"http://127.0.0.1:{PORT}");
        }
        catch (Exception ex)
        {
            MessageBox.Show("Ошибка инициализации WebView2: " + ex.Message, "DodoSpoti", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task EnsureServerRunningAsync()
    {
        bool isAlive = await CheckServerAliveAsync();
        if (isAlive) return;

        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string? projectRoot = FindProjectRoot(baseDir);

        string logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native-debug.log");
        File.AppendAllText(logPath, $"[ENSURE] startDir={baseDir}, projectRoot={projectRoot}\n");

        if (projectRoot != null)
        {
            string serverScript = Path.Combine(projectRoot, "server.js");
            File.AppendAllText(logPath, $"[ENSURE] serverScript={serverScript}, exists={File.Exists(serverScript)}\n");
            if (File.Exists(serverScript))
            {
                try
                {
                    string nodeExe = FindNodeExecutable();
                    File.AppendAllText(logPath, $"[ENSURE] nodeExe={nodeExe}\n");
                    serverProcess = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = nodeExe,
                            Arguments = $"\"{serverScript}\"",
                            WorkingDirectory = projectRoot,
                            CreateNoWindow = true,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            UseShellExecute = false
                        }
                    };
                    serverProcess.StartInfo.EnvironmentVariables["PORT"] = PORT.ToString();
                    serverProcess.Start();
                    File.AppendAllText(logPath, $"[ENSURE] Started process ID={serverProcess.Id}\n");
                }
                catch (Exception ex)
                {
                    File.AppendAllText(logPath, $"[ENSURE_ERROR] {ex}\n");
                }
            }
        }

        for (int i = 0; i < 30; i++)
        {
            await Task.Delay(200);
            if (await CheckServerAliveAsync()) break;
        }
    }

    private static string FindNodeExecutable()
    {
        string[] candidates = new[]
        {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe")
        };
        foreach (var c in candidates)
        {
            if (File.Exists(c)) return c;
        }
        return "node.exe";
    }

    private static string? FindProjectRoot(string startDir)
    {
        if (File.Exists(Path.Combine(startDir, "server.js"))) return startDir;

        string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string scratchRoot = Path.Combine(userProfile, ".gemini", "antigravity", "scratch", "dodospoti");
        if (File.Exists(Path.Combine(scratchRoot, "server.js"))) return scratchRoot;

        string? current = startDir;
        for (int i = 0; i < 4 && current != null; i++)
        {
            if (File.Exists(Path.Combine(current, "server.js"))) return current;
            current = Directory.GetParent(current)?.FullName;
        }

        return null;
    }

    private static async Task<bool> CheckServerAliveAsync()
    {
        try
        {
            using var cts = new System.Threading.CancellationTokenSource(600);
            var res = await http.GetAsync($"http://127.0.0.1:{PORT}/api/check-update", cts.Token);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        try
        {
            if (serverProcess != null && !serverProcess.HasExited)
            {
                serverProcess.Kill();
            }
        }
        catch { }
    }
}
