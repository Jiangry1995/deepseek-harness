using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace DeepSeekHarness.BrowserCompanion
{
    /// <summary>Long-lived notification-area owner for Harness Web lifecycle controls.</summary>
    public sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly CompanionConfig config;
        private readonly CompanionLog log;
        private readonly HarnessServiceManager service;
        private readonly CompanionPipeServer pipe;
        private readonly NotifyIcon icon;
        private readonly ToolStripMenuItem statusItem;
        private readonly ToolStripMenuItem startItem;
        private readonly ToolStripMenuItem restartItem;
        private readonly ToolStripMenuItem stopItem;
        private readonly Timer healthTimer;
        private readonly Control dispatcher;
        private bool polling;
        private bool disposed;

        /// <summary>Create the tray, command pipe, lifecycle owner, and periodic health projection.</summary>
        /// <param name="config">Validated installed configuration.</param>
        /// <param name="startService">Whether login startup must immediately ensure Harness.</param>
        public TrayApplicationContext(CompanionConfig config, bool startService)
        {
            this.config = config;
            log = new CompanionLog(config.LogDirectory);
            service = new HarnessServiceManager(config, log);
            service.StateChanged += ServiceStateChanged;
            dispatcher = new Control();
            dispatcher.CreateControl();

            ContextMenuStrip menu = new ContextMenuStrip();
            statusItem = new ToolStripMenuItem("状态：正在检查") { Enabled = false };
            ToolStripMenuItem openItem = new ToolStripMenuItem("打开 Harness");
            startItem = new ToolStripMenuItem("启动服务");
            restartItem = new ToolStripMenuItem("重启服务");
            stopItem = new ToolStripMenuItem("关闭服务");
            ToolStripMenuItem logsItem = new ToolStripMenuItem("打开日志目录");
            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出托盘并关闭自有服务");
            openItem.Click += OpenHarnessClicked;
            startItem.Click += StartClicked;
            restartItem.Click += RestartClicked;
            stopItem.Click += StopClicked;
            logsItem.Click += OpenLogsClicked;
            exitItem.Click += ExitClicked;
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(openItem);
            menu.Items.Add(startItem);
            menu.Items.Add(restartItem);
            menu.Items.Add(stopItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(logsItem);
            menu.Items.Add(exitItem);

            icon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "DeepSeek Harness：正在检查",
                ContextMenuStrip = menu,
                Visible = true
            };
            icon.DoubleClick += OpenHarnessClicked;

            pipe = new CompanionPipeServer(CompanionIdentity.PipeName(), HandlePipeRequestAsync, log);
            pipe.Start();
            healthTimer = new Timer { Interval = 3000 };
            healthTimer.Tick += HealthTimerTick;
            healthTimer.Start();
            ApplySnapshot(service.Snapshot);
            log.Write("Tray companion started.");
            if (startService)
            {
                RunOperationAsync(service.EnsureAsync, false);
            }
            else
            {
                RunRefreshAsync();
            }
        }

        /// <summary>Validate a pipe request and ensure the configured origin.</summary>
        /// <param name="request">Validated closed request.</param>
        /// <returns>Closed Native Messaging response JSON.</returns>
        private async Task<string> HandlePipeRequestAsync(CompanionRequest request)
        {
            string origin;
            try
            {
                origin = CompanionConfigurationPolicy.ValidateOrigin(request.Origin);
            }
            catch (Exception error)
            {
                return CompanionResponse.Failure(Program.UserMessage(error));
            }
            if (!string.Equals(origin, config.Origin, StringComparison.Ordinal))
            {
                return CompanionResponse.Failure("请求 origin 与已安装的 Harness 地址不一致。");
            }
            ServiceOperationResult result = await service.EnsureAsync().ConfigureAwait(false);
            return result.ToNativeJson(config.Origin);
        }

        /// <summary>Project service changes onto the WinForms thread.</summary>
        /// <param name="snapshot">Committed service state.</param>
        private void ServiceStateChanged(ServiceSnapshot snapshot)
        {
            if (disposed || dispatcher.IsDisposed)
            {
                return;
            }
            try
            {
                dispatcher.BeginInvoke(new Action<ServiceSnapshot>(ApplySnapshot), snapshot);
            }
            catch (InvalidOperationException error)
            {
                if (!disposed)
                {
                    log.Write("Tray UI dispatch failed: " + error.Message);
                }
            }
        }

        /// <summary>Update status, tooltip, and destructive-action availability.</summary>
        /// <param name="snapshot">Committed service state.</param>
        private void ApplySnapshot(ServiceSnapshot snapshot)
        {
            string label;
            switch (snapshot.State)
            {
                case CompanionServiceState.Starting:
                    label = "正在启动";
                    break;
                case CompanionServiceState.RunningOwned:
                    label = "正在运行";
                    break;
                case CompanionServiceState.RunningExternal:
                    label = "外部服务";
                    break;
                case CompanionServiceState.Stopping:
                    label = "正在关闭";
                    break;
                case CompanionServiceState.Failed:
                    label = "启动失败";
                    break;
                default:
                    label = "已停止";
                    break;
            }
            statusItem.Text = "状态：" + label;
            icon.Text = TruncateTooltip("DeepSeek Harness：" + label);
            bool busy = snapshot.State == CompanionServiceState.Starting || snapshot.State == CompanionServiceState.Stopping;
            startItem.Enabled = !busy && snapshot.State != CompanionServiceState.RunningOwned && snapshot.State != CompanionServiceState.RunningExternal;
            restartItem.Enabled = !busy && snapshot.State == CompanionServiceState.RunningOwned;
            stopItem.Enabled = !busy && snapshot.State == CompanionServiceState.RunningOwned;
        }

        /// <summary>Keep NotifyIcon text within Windows' 63-character limit.</summary>
        /// <param name="text">Candidate tooltip.</param>
        /// <returns>Bounded tooltip.</returns>
        private static string TruncateTooltip(string text)
        {
            return text.Length <= 63 ? text : text.Substring(0, 63);
        }

        /// <summary>Open the configured Harness origin in the default browser.</summary>
        private void OpenHarnessClicked(object sender, EventArgs args)
        {
            OpenShellTarget(config.Origin, "无法打开 Harness");
        }

        /// <summary>Start Harness from the tray menu.</summary>
        private void StartClicked(object sender, EventArgs args)
        {
            RunOperationAsync(service.StartAsync, true);
        }

        /// <summary>Restart only the tray-owned process generation.</summary>
        private void RestartClicked(object sender, EventArgs args)
        {
            RunOperationAsync(service.RestartAsync, true);
        }

        /// <summary>Stop only the tray-owned process generation.</summary>
        private void StopClicked(object sender, EventArgs args)
        {
            RunOperationAsync(service.StopAsync, true);
        }

        /// <summary>Open the durable companion log directory.</summary>
        private void OpenLogsClicked(object sender, EventArgs args)
        {
            OpenShellTarget(config.LogDirectory, "无法打开日志目录");
        }

        /// <summary>Exit the tray; teardown synchronously waits for its owned Web tree.</summary>
        private void ExitClicked(object sender, EventArgs args)
        {
            ExitThread();
        }

        /// <summary>Open one trusted installed URL or directory with Windows shell association.</summary>
        /// <param name="target">Configured URL or absolute directory.</param>
        /// <param name="failurePrefix">Visible failure label.</param>
        private void OpenShellTarget(string target, string failurePrefix)
        {
            try
            {
                Process process = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
                if (process != null)
                {
                    process.Dispose();
                }
            }
            catch (Exception error)
            {
                ShowBalloon(failurePrefix + "：" + Program.UserMessage(error), ToolTipIcon.Error);
            }
        }

        /// <summary>Run a menu operation with callback exception containment.</summary>
        /// <param name="operation">Serialized lifecycle operation.</param>
        /// <param name="showSuccess">Whether menu invocation gets an outcome balloon.</param>
        private async void RunOperationAsync(Func<Task<ServiceOperationResult>> operation, bool showSuccess)
        {
            try
            {
                ServiceOperationResult result = await operation();
                if (!result.Ok || showSuccess)
                {
                    ShowBalloon(result.Message, result.Ok ? ToolTipIcon.Info : ToolTipIcon.Error);
                }
            }
            catch (Exception error)
            {
                log.Write("Tray service operation failed: " + error.Message);
                ShowBalloon("Harness 操作失败：" + Program.UserMessage(error), ToolTipIcon.Error);
            }
        }

        /// <summary>Refresh health without overlapping the previous timer tick.</summary>
        private async void RunRefreshAsync()
        {
            if (polling || disposed)
            {
                return;
            }
            polling = true;
            try
            {
                await service.RefreshAsync();
            }
            catch (Exception error)
            {
                log.Write("Tray health refresh failed: " + error.Message);
            }
            finally
            {
                polling = false;
            }
        }

        /// <summary>Trigger one contained periodic health refresh.</summary>
        private void HealthTimerTick(object sender, EventArgs args)
        {
            RunRefreshAsync();
        }

        /// <summary>Display one bounded notification-area outcome.</summary>
        /// <param name="message">User-displayable outcome.</param>
        /// <param name="kind">Information or error icon.</param>
        private void ShowBalloon(string message, ToolTipIcon kind)
        {
            icon.BalloonTipTitle = "DeepSeek Harness";
            icon.BalloonTipText = message;
            icon.BalloonTipIcon = kind;
            icon.ShowBalloonTip(4000);
        }

        /// <summary>Stop command intake, await owned process quiescence, then remove the icon.</summary>
        protected override void ExitThreadCore()
        {
            if (disposed)
            {
                base.ExitThreadCore();
                return;
            }
            disposed = true;
            healthTimer.Stop();
            healthTimer.Tick -= HealthTimerTick;
            pipe.Dispose();
            service.StateChanged -= ServiceStateChanged;
            service.Dispose();
            icon.Visible = false;
            icon.Dispose();
            healthTimer.Dispose();
            dispatcher.Dispose();
            log.Write("Tray companion stopped.");
            log.Dispose();
            base.ExitThreadCore();
        }

        /// <summary>Dispose the application context through the same quiescent exit path.</summary>
        protected override void Dispose(bool disposing)
        {
            if (disposing && !disposed)
            {
                ExitThreadCore();
            }
            base.Dispose(disposing);
        }
    }
}
