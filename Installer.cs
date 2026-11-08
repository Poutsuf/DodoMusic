using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Threading;

namespace DodoMusicInstaller
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (args != null && args.Length > 0 && args[0].ToLower().Contains("uninstall"))
            {
                RunUninstaller();
                return;
            }

            Application.Run(new SetupForm());
        }

        static void RunUninstaller()
        {
            var res = MessageBox.Show(
                "Вы уверены, что хотите полностью удалить DodoMusic с вашего компьютера?",
                "Удаление DodoMusic",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );

            if (res != DialogResult.Yes) return;

            try
            {
                // Закрываем процессы плеера
                foreach (var procName in new[] { "DodoMusic", "DodoMusic-Native" })
                {
                    try
                    {
                        foreach (var p in Process.GetProcessesByName(procName))
                        {
                            p.Kill();
                            p.WaitForExit(1500);
                        }
                    }
                    catch { }
                }

                // Удаляем ярлыки
                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "DodoMusic.lnk");
                if (File.Exists(desktopLnk)) File.Delete(desktopLnk);

                string startMenuLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "DodoMusic.lnk");
                if (File.Exists(startMenuLnk)) File.Delete(startMenuLnk);

                // Удаляем запись из реестра Windows
                try
                {
                    Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DodoMusic", false);
                }
                catch { }

                // Запускаем отложенное удаление папки
                string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
                string cmd = string.Format("/C ping 127.0.0.1 -n 2 > nul & rmdir /s /q \"{0}\"", installDir);
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = cmd,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true
                });

                MessageBox.Show(
                    "DodoMusic был успешно удален с вашего компьютера.",
                    "Удаление завершено",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show("Ошибка при удалении: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    public class SetupForm : Form
    {
        private Color bgDark = Color.FromArgb(14, 17, 26);
        private Color cardBg = Color.FromArgb(20, 25, 38);
        private Color accentGreen = Color.FromArgb(30, 215, 96);
        private Color textPrimary = Color.FromArgb(255, 255, 255);
        private Color textSecondary = Color.FromArgb(148, 163, 184);

        private Panel headerPanel;
        private PictureBox logoBox;
        private Label titleLabel;
        private Label subtitleLabel;

        // Step 1: Config
        private Panel step1Panel;
        private TextBox pathTextBox;
        private Button browseBtn;
        private CheckBox desktopShortCutCb;
        private CheckBox startMenuShortcutCb;
        private Button installBtn;
        private Button cancelBtn;

        // Step 2: Progress
        private Panel step2Panel;
        private Label progressStatusLabel;
        private Label currentFileLabel;
        private ProgressBar progressBar;

        // Step 3: Finished
        private Panel step3Panel;
        private Label finishTitleLabel;
        private Label finishDescLabel;
        private CheckBox launchNowCb;
        private Button finishBtn;

        private string targetDir;

        public SetupForm()
        {
            this.Text = "Установка DodoMusic v1.3";
            this.Size = new Size(580, 490);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = bgDark;
            this.ForeColor = textPrimary;
            this.Font = new Font("Segoe UI", 9.25f, FontStyle.Regular);

            // Попытка загрузить иконку
            try
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon.ico"))
                {
                    if (s != null) this.Icon = new Icon(s);
                }
            }
            catch { }

            InitUI();
        }

        private void InitUI()
        {
            // HEADER
            headerPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 85,
                BackColor = cardBg,
                Padding = new Padding(20, 12, 20, 12)
            };

            logoBox = new PictureBox
            {
                Size = new Size(60, 60),
                Location = new Point(20, 12),
                SizeMode = PictureBoxSizeMode.Zoom
            };
            try
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon_setup.png"))
                {
                    if (s != null) logoBox.Image = Image.FromStream(s);
                }
            }
            catch { }

            titleLabel = new Label
            {
                Text = "DodoMusic v1.3",
                Font = new Font("Segoe UI", 16f, FontStyle.Bold),
                ForeColor = textPrimary,
                Location = new Point(92, 16),
                AutoSize = true
            };

            subtitleLabel = new Label
            {
                Text = "Свободный музыкальный плеер • Караоке в реальном времени • Zero Telemetry",
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                ForeColor = accentGreen,
                Location = new Point(94, 48),
                AutoSize = true
            };

            headerPanel.Controls.Add(logoBox);
            headerPanel.Controls.Add(titleLabel);
            headerPanel.Controls.Add(subtitleLabel);
            this.Controls.Add(headerPanel);

            // STEP 1: CONFIG PANEL
            step1Panel = new Panel
            {
                Location = new Point(0, 85),
                Size = new Size(580, 365),
                BackColor = bgDark
            };

            Label dirTitle = new Label
            {
                Text = "Папка для установки:",
                ForeColor = textSecondary,
                Location = new Point(30, 20),
                AutoSize = true
            };

            string defaultPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "DodoMusic"
            );

            pathTextBox = new TextBox
            {
                Text = defaultPath,
                Location = new Point(30, 45),
                Size = new Size(410, 26),
                BackColor = cardBg,
                ForeColor = textPrimary,
                BorderStyle = BorderStyle.FixedSingle
            };

            browseBtn = new Button
            {
                Text = "Обзор...",
                Location = new Point(450, 44),
                Size = new Size(95, 28),
                BackColor = Color.FromArgb(32, 40, 58),
                ForeColor = textPrimary,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            browseBtn.FlatAppearance.BorderColor = Color.FromArgb(50, 60, 85);
            browseBtn.Click += (s, e) =>
            {
                using (var fbd = new FolderBrowserDialog())
                {
                    fbd.SelectedPath = pathTextBox.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        pathTextBox.Text = Path.Combine(fbd.SelectedPath, "DodoMusic");
                    }
                }
            };

            desktopShortCutCb = new CheckBox
            {
                Text = "Создать ярлык на Рабочем столе",
                Checked = true,
                Location = new Point(30, 90),
                Size = new Size(350, 24),
                ForeColor = textPrimary,
                Cursor = Cursors.Hand
            };

            startMenuShortcutCb = new CheckBox
            {
                Text = "Добавить в меню «Пуск»",
                Checked = true,
                Location = new Point(30, 118),
                Size = new Size(350, 24),
                ForeColor = textPrimary,
                Cursor = Cursors.Hand
            };

            // Инфо-блок
            Panel infoCard = new Panel
            {
                Location = new Point(30, 155),
                Size = new Size(515, 125),
                BackColor = cardBg,
                Padding = new Padding(16)
            };
            Label infoTitle = new Label
            {
                Text = "Особенности установки:",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = textPrimary,
                Location = new Point(14, 12),
                AutoSize = true
            };
            Label infoItems = new Label
            {
                Text = "✔ Полный движок воспроизведения (SoundCloud, Audius)\n" +
                       "✔ Синхронизированный караоке-текст с перемоткой по строкам\n" +
                       "✔ Умная волна рекомендаций и анализ вкуса\n" +
                       "✔ 100% Zero Telemetry — все данные только на вашем компьютере",
                ForeColor = Color.FromArgb(203, 213, 225),
                Location = new Point(14, 38),
                Size = new Size(485, 75),
                Font = new Font("Segoe UI", 8.8f, FontStyle.Regular)
            };
            infoCard.Controls.Add(infoTitle);
            infoCard.Controls.Add(infoItems);

            // Кнопки внизу
            installBtn = new Button
            {
                Text = "Установить DodoMusic",
                Location = new Point(345, 305),
                Size = new Size(200, 38),
                BackColor = accentGreen,
                ForeColor = Color.Black,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            installBtn.FlatAppearance.BorderSize = 0;
            installBtn.Click += (s, e) => StartInstallation();

            cancelBtn = new Button
            {
                Text = "Отмена",
                Location = new Point(235, 305),
                Size = new Size(100, 38),
                BackColor = Color.FromArgb(28, 35, 50),
                ForeColor = textSecondary,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            cancelBtn.FlatAppearance.BorderColor = Color.FromArgb(45, 55, 75);
            cancelBtn.Click += (s, e) => this.Close();

            step1Panel.Controls.Add(dirTitle);
            step1Panel.Controls.Add(pathTextBox);
            step1Panel.Controls.Add(browseBtn);
            step1Panel.Controls.Add(desktopShortCutCb);
            step1Panel.Controls.Add(startMenuShortcutCb);
            step1Panel.Controls.Add(infoCard);
            step1Panel.Controls.Add(installBtn);
            step1Panel.Controls.Add(cancelBtn);
            this.Controls.Add(step1Panel);

            // STEP 2: PROGRESS PANEL
            step2Panel = new Panel
            {
                Location = new Point(0, 85),
                Size = new Size(580, 365),
                BackColor = bgDark,
                Visible = false
            };

            progressStatusLabel = new Label
            {
                Text = "Идет распаковка и установка файлов...",
                Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                ForeColor = textPrimary,
                Location = new Point(30, 70),
                AutoSize = true
            };

            progressBar = new ProgressBar
            {
                Location = new Point(30, 115),
                Size = new Size(515, 24),
                Style = ProgressBarStyle.Continuous,
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            currentFileLabel = new Label
            {
                Text = "Подготовка файлов...",
                ForeColor = textSecondary,
                Location = new Point(30, 150),
                Size = new Size(515, 20),
                AutoEllipsis = true
            };

            step2Panel.Controls.Add(progressStatusLabel);
            step2Panel.Controls.Add(progressBar);
            step2Panel.Controls.Add(currentFileLabel);
            this.Controls.Add(step2Panel);

            // STEP 3: FINISHED PANEL
            step3Panel = new Panel
            {
                Location = new Point(0, 85),
                Size = new Size(580, 365),
                BackColor = bgDark,
                Visible = false
            };

            Label checkmark = new Label
            {
                Text = "✔",
                Font = new Font("Segoe UI", 36f, FontStyle.Bold),
                ForeColor = accentGreen,
                Location = new Point(30, 40),
                Size = new Size(60, 60),
                TextAlign = ContentAlignment.MiddleCenter
            };

            finishTitleLabel = new Label
            {
                Text = "DodoMusic успешно установлен!",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = textPrimary,
                Location = new Point(100, 45),
                AutoSize = true
            };

            finishDescLabel = new Label
            {
                Text = "Все файлы скопированы, а ярлыки добавлены в систему.\nПриложение готово к запуску.",
                ForeColor = textSecondary,
                Location = new Point(102, 80),
                Size = new Size(440, 50)
            };

            launchNowCb = new CheckBox
            {
                Text = "Запустить DodoMusic сейчас",
                Checked = true,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                ForeColor = accentGreen,
                Location = new Point(102, 150),
                Size = new Size(300, 26),
                Cursor = Cursors.Hand
            };

            finishBtn = new Button
            {
                Text = "Завершить",
                Location = new Point(380, 290),
                Size = new Size(165, 40),
                BackColor = accentGreen,
                ForeColor = Color.Black,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            finishBtn.FlatAppearance.BorderSize = 0;
            finishBtn.Click += (s, e) =>
            {
                if (launchNowCb.Checked && !string.IsNullOrEmpty(targetDir))
                {
                    string exePath = Path.Combine(targetDir, "DodoMusic.exe");
                    if (File.Exists(exePath))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exePath,
                            WorkingDirectory = targetDir
                        });
                    }
                }
                this.Close();
            };

            step3Panel.Controls.Add(checkmark);
            step3Panel.Controls.Add(finishTitleLabel);
            step3Panel.Controls.Add(finishDescLabel);
            step3Panel.Controls.Add(launchNowCb);
            step3Panel.Controls.Add(finishBtn);
            this.Controls.Add(step3Panel);
        }

        private void StartInstallation()
        {
            targetDir = pathTextBox.Text.Trim();
            if (string.IsNullOrEmpty(targetDir))
            {
                MessageBox.Show("Пожалуйста, укажите папку для установки.", "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            step1Panel.Visible = false;
            step2Panel.Visible = true;

            bool makeDesktop = desktopShortCutCb.Checked;
            bool makeStartMenu = startMenuShortcutCb.Checked;

            Thread worker = new Thread(() =>
            {
                try
                {
                    if (!Directory.Exists(targetDir))
                    {
                        Directory.CreateDirectory(targetDir);
                    }

                    // Закрываем запущенные экземпляры перед перезаписью
                    try
                    {
                        foreach (var p in Process.GetProcessesByName("DodoMusic"))
                        {
                            p.Kill();
                            p.WaitForExit(1000);
                        }
                    }
                    catch { }

                    // Распаковываем embedded payload.zip
                    using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                    {
                        if (stream == null) throw new Exception("Файлы установки повреждены (payload not found).");

                        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
                        {
                            int total = zip.Entries.Count;
                            int count = 0;

                            foreach (var entry in zip.Entries)
                            {
                                count++;
                                string fullDest = Path.Combine(targetDir, entry.FullName);

                                if (string.IsNullOrEmpty(entry.Name))
                                {
                                    // Это директория
                                    Directory.CreateDirectory(fullDest);
                                }
                                else
                                {
                                    string dir = Path.GetDirectoryName(fullDest);
                                    if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

                                    entry.ExtractToFile(fullDest, true);
                                }

                                int percent = (int)(((double)count / total) * 90.0);
                                this.BeginInvoke(new Action(() =>
                                {
                                    progressBar.Value = Math.Min(90, percent);
                                    currentFileLabel.Text = entry.Name;
                                }));
                            }
                        }
                    }

                    // Копируем сам установщик как деинсталлятор
                    string currentExe = Assembly.GetExecutingAssembly().Location;
                    string uninstallerPath = Path.Combine(targetDir, "Uninstall-DodoMusic.exe");
                    try
                    {
                        File.Copy(currentExe, uninstallerPath, true);
                    }
                    catch { }

                    string mainExe = Path.Combine(targetDir, "DodoMusic.exe");
                    string iconPath = mainExe;

                    // Создаем ярлык на Рабочем столе
                    if (makeDesktop)
                    {
                        this.BeginInvoke(new Action(() => currentFileLabel.Text = "Создание ярлыка на Рабочем столе..."));
                        string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                        string lnkFile = Path.Combine(desktopPath, "DodoMusic.lnk");
                        CreateShortcut(lnkFile, mainExe, targetDir, iconPath, "DodoMusic Music Player");
                    }

                    // Создаем ярлык в меню «Пуск»
                    if (makeStartMenu)
                    {
                        this.BeginInvoke(new Action(() => currentFileLabel.Text = "Добавление в меню «Пуск»..."));
                        string startMenuPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                        string lnkFile = Path.Combine(startMenuPath, "DodoMusic.lnk");
                        CreateShortcut(lnkFile, mainExe, targetDir, iconPath, "DodoMusic Music Player");
                    }

                    // Регистрация в панели «Программы и компоненты» Windows
                    try
                    {
                        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DodoMusic"))
                        {
                            if (key != null)
                            {
                                key.SetValue("DisplayName", "DodoMusic");
                                key.SetValue("DisplayVersion", "1.3.0");
                                key.SetValue("Publisher", "DodoMusic");
                                key.SetValue("DisplayIcon", mainExe + ",0");
                                key.SetValue("InstallLocation", targetDir);
                                key.SetValue("UninstallString", "\"" + uninstallerPath + "\" --uninstall");
                                key.SetValue("URLInfoAbout", "https://github.com/redmi157312/DodoMusic");
                                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                            }
                        }
                    }
                    catch { }

                    this.BeginInvoke(new Action(() =>
                    {
                        progressBar.Value = 100;
                        currentFileLabel.Text = "Готово!";
                        step2Panel.Visible = false;
                        step3Panel.Visible = true;
                    }));
                }
                catch (Exception ex)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        MessageBox.Show("Ошибка при установке: " + ex.Message, "Ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        step2Panel.Visible = false;
                        step1Panel.Visible = true;
                    }));
                }
            });

            worker.IsBackground = true;
            worker.Start();
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string iconPath, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null)
                {
                    dynamic shell = Activator.CreateInstance(shellType);
                    var shortcut = shell.CreateShortcut(shortcutPath);
                    shortcut.TargetPath = targetPath;
                    shortcut.WorkingDirectory = workingDir;
                    shortcut.IconLocation = iconPath + ",0";
                    shortcut.Description = description;
                    shortcut.Save();
                }
            }
            catch { }
        }
    }
}
