using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace DodoSpoti
{
    static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        private const int SW_RESTORE = 9;

        [STAThread]
        static void Main()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;

            // 1. Проверяем, если процесс уже запущен - активируем окно
            Process currentProc = Process.GetCurrentProcess();
            Process[] existing = Process.GetProcessesByName("DodoSpoti");
            foreach (var p in existing)
            {
                if (p.Id != currentProc.Id && p.MainWindowHandle != IntPtr.Zero)
                {
                    ShowWindowAsync(p.MainWindowHandle, SW_RESTORE);
                    SetForegroundWindow(p.MainWindowHandle);
                    return;
                }
            }

            // 2. Ищем бинарный исполняемый файл
            string distExe = Path.Combine(baseDir, "dist", "DodoSpoti-win32-x64", "DodoSpoti.exe");
            if (!File.Exists(distExe))
            {
                distExe = Path.Combine(baseDir, "DodoSpoti-win32-x64", "DodoSpoti.exe");
            }
            if (!File.Exists(distExe))
            {
                distExe = Path.Combine(baseDir, "resources", "app", "DodoSpoti.exe");
            }
            if (!File.Exists(distExe))
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string knownPath = Path.Combine(userProfile, ".gemini", "antigravity", "scratch", "dodospoti", "dist", "DodoSpoti-win32-x64", "DodoSpoti.exe");
                if (File.Exists(knownPath))
                {
                    distExe = knownPath;
                }
            }

            if (File.Exists(distExe))
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = distExe,
                    WorkingDirectory = Path.GetDirectoryName(distExe),
                    UseShellExecute = true
                };
                Process.Start(psi);
                return;
            }

            // 3. Fallback: запуск в режиме разработки без всплывающих консольных окон
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npx electron electron-main.cjs",
                    WorkingDirectory = baseDir,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Ошибка запуска DodoSpoti: " + ex.Message, "DodoSpoti Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
