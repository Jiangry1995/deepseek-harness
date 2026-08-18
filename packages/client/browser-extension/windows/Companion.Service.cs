using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace DeepSeekHarness.BrowserCompanion
{
    /// <summary>Observable service states rendered by the tray.</summary>
    public enum CompanionServiceState
    {
        Stopped,
        Starting,
        RunningOwned,
        RunningExternal,
        Stopping,
        Failed
    }

    /// <summary>Immutable service state projected to tray controls.</summary>
    public sealed class ServiceSnapshot
    {
        /// <summary>Gets the current lifecycle state.</summary>
        public CompanionServiceState State { get; private set; }

        /// <summary>Gets a concise status or failure detail.</summary>
        public string Detail { get; private set; }

        /// <summary>Create one immutable state notification.</summary>
        /// <param name="state">Current lifecycle state.</param>
        /// <param name="detail">Concise status detail.</param>
        public ServiceSnapshot(CompanionServiceState state, string detail)
        {
            State = state;
            Detail = detail ?? string.Empty;
        }
    }

    /// <summary>One tray or native service operation result.</summary>
    public sealed class ServiceOperationResult
    {
        /// <summary>Gets whether the requested operation reached its postcondition.</summary>
        public bool Ok { get; private set; }

        /// <summary>Gets whether an ensured service already ran or was started.</summary>
        public string State { get; private set; }

        /// <summary>Gets a concrete user-displayable outcome.</summary>
        public string Message { get; private set; }

        /// <summary>Create a successful operation result.</summary>
        /// <param name="state">Native ensure state when applicable.</param>
        /// <param name="message">User-displayable outcome.</param>
        /// <returns>Successful result.</returns>
        public static ServiceOperationResult Success(string state, string message)
        {
            return new ServiceOperationResult { Ok = true, State = state, Message = message };
        }

        /// <summary>Create a failed operation result.</summary>
        /// <param name="message">Concrete user-displayable failure.</param>
        /// <returns>Failed result.</returns>
        public static ServiceOperationResult Failure(string message)
        {
            return new ServiceOperationResult { Ok = false, Message = message };
        }

        /// <summary>Serialize an ensure result for Chrome Native Messaging.</summary>
        /// <param name="origin">Configured Harness origin.</param>
        /// <returns>Closed native response JSON.</returns>
        public string ToNativeJson(string origin)
        {
            return Ok ? CompanionResponse.Success(State, origin) : CompanionResponse.Failure(Message);
        }
    }

    /// <summary>Bounded loopback health checks that bypass ambient HTTP proxies.</summary>
    public sealed class HarnessHealthProbe : IDisposable
    {
        private readonly HttpClient client;
        private readonly string address;

        /// <summary>Create one reusable health client for the configured origin.</summary>
        /// <param name="origin">Validated Harness origin.</param>
        public HarnessHealthProbe(string origin)
        {
            HttpClientHandler handler = new HttpClientHandler { UseProxy = false };
            client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(2);
            address = CompanionConfigurationPolicy.ValidateOrigin(origin) + "/";
        }

        /// <summary>Probe whether the configured Web server returns a successful HTTP response.</summary>
        /// <returns>True only for a complete 2xx response.</returns>
        public async Task<bool> IsHealthyAsync()
        {
            try
            {
                using (HttpResponseMessage response = await client.GetAsync(address).ConfigureAwait(false))
                {
                    return response.IsSuccessStatusCode;
                }
            }
            catch (HttpRequestException)
            {
                return false;
            }
            catch (TaskCanceledException)
            {
                return false;
            }
        }

        /// <summary>Dispose the owned HTTP client and handler.</summary>
        public void Dispose()
        {
            client.Dispose();
        }
    }

    /// <summary>Timestamped stdout/stderr sink owned by one Web process.</summary>
    internal sealed class ServiceLog : IDisposable
    {
        private readonly object sync = new object();
        private readonly StreamWriter writer;

        /// <summary>Open a fresh UTF-8 log file.</summary>
        /// <param name="directory">Validated log directory.</param>
        public ServiceLog(string directory)
        {
            Directory.CreateDirectory(directory);
            string name = "harness-web-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture) + ".log";
            Path = System.IO.Path.Combine(directory, name);
            writer = new StreamWriter(Path, false, new UTF8Encoding(false));
            writer.AutoFlush = true;
        }

        /// <summary>Gets the concrete log path reported on startup failure.</summary>
        public string Path { get; private set; }

        /// <summary>Append one process output line with stream and timestamp.</summary>
        /// <param name="stream">stdout or stderr.</param>
        /// <param name="line">Process output line.</param>
        public void Write(string stream, string line)
        {
            if (line == null)
            {
                return;
            }
            lock (sync)
            {
                writer.WriteLine(DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture) + " [" + stream + "] " + line);
            }
        }

        /// <summary>Flush and close the process log.</summary>
        public void Dispose()
        {
            lock (sync)
            {
                writer.Dispose();
            }
        }
    }

    /// <summary>Windows Job Object that kills the entire owned Web tree when closed.</summary>
    internal sealed class OwnedProcessJob : IDisposable
    {
        private const uint JobObjectExtendedLimitInformation = 9;
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private IntPtr handle;

        /// <summary>Create a kill-on-close Job Object.</summary>
        public OwnedProcessJob()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero)
            {
                throw new InvalidOperationException("Windows could not create the Harness process job: " + Marshal.GetLastWin32Error());
            }
            JobObjectExtendedLimitInformationValue information = new JobObjectExtendedLimitInformationValue();
            information.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            int length = Marshal.SizeOf(information);
            IntPtr pointer = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(information, pointer, false);
                if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, pointer, (uint)length))
                {
                    throw new InvalidOperationException("Windows could not configure the Harness process job: " + Marshal.GetLastWin32Error());
                }
            }
            finally
            {
                Marshal.FreeHGlobal(pointer);
            }
        }

        /// <summary>Assign the newly started Node process to the owned job.</summary>
        /// <param name="process">Live Node process.</param>
        public void Assign(Process process)
        {
            if (!AssignProcessToJobObject(handle, process.Handle))
            {
                throw new InvalidOperationException("Windows could not assign Harness to the companion job: " + Marshal.GetLastWin32Error());
            }
        }

        /// <summary>Terminate every process in the owned job.</summary>
        public void Terminate()
        {
            if (handle != IntPtr.Zero && !TerminateJobObject(handle, 1))
            {
                int error = Marshal.GetLastWin32Error();
                if (error != 5 && error != 6)
                {
                    throw new InvalidOperationException("Windows could not stop the Harness process job: " + error);
                }
            }
        }

        /// <summary>Close the job handle, enforcing kill-on-close for remaining descendants.</summary>
        public void Dispose()
        {
            if (handle == IntPtr.Zero)
            {
                return;
            }
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectExtendedLimitInformationValue
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        /// <summary>Create an unnamed Windows Job Object.</summary>
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        /// <summary>Configure kill-on-close limits on an owned Job Object.</summary>
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, uint informationClass, IntPtr information, uint length);

        /// <summary>Assign one process to an owned Job Object.</summary>
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        /// <summary>Terminate every process assigned to an owned Job Object.</summary>
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        /// <summary>Close a native Job Object handle.</summary>
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr value);
    }

    /// <summary>Resources owned by one managed Web process generation.</summary>
    internal sealed class OwnedServiceRun : IDisposable
    {
        /// <summary>Create one process generation resource set.</summary>
        /// <param name="process">Started Node process.</param>
        /// <param name="job">Kill-on-close Job Object.</param>
        /// <param name="log">Redirected output log.</param>
        public OwnedServiceRun(Process process, OwnedProcessJob job, ServiceLog log)
        {
            Process = process;
            Job = job;
            Log = log;
        }

        /// <summary>Gets the started Node process.</summary>
        public Process Process { get; private set; }

        /// <summary>Gets the process-tree Job Object.</summary>
        public OwnedProcessJob Job { get; private set; }

        /// <summary>Gets the output log sink.</summary>
        public ServiceLog Log { get; private set; }

        /// <summary>Dispose process, job, and log resources after quiescence.</summary>
        public void Dispose()
        {
            Process.Dispose();
            Job.Dispose();
            Log.Dispose();
        }
    }

    /// <summary>Serial lifecycle owner for the companion-managed Web process.</summary>
    public sealed class HarnessServiceManager : IDisposable
    {
        private readonly CompanionConfig config;
        private readonly CompanionLog log;
        private readonly HarnessHealthProbe probe;
        private readonly SemaphoreSlim lifecycle = new SemaphoreSlim(1, 1);
        private OwnedServiceRun owned;
        private bool disposed;
        private ServiceSnapshot snapshot = new ServiceSnapshot(CompanionServiceState.Stopped, "服务未运行");

        /// <summary>
        /// Cold <c>tsx</c> boot of the Web profile commonly takes 40–50s before port 3080 answers.
        /// </summary>
        private static readonly TimeSpan StartupHealthTimeout = TimeSpan.FromSeconds(90);

        /// <summary>Create a service manager over validated installation configuration.</summary>
        /// <param name="config">Validated installation configuration.</param>
        /// <param name="log">Companion lifecycle log.</param>
        public HarnessServiceManager(CompanionConfig config, CompanionLog log)
        {
            this.config = config;
            this.log = log;
            probe = new HarnessHealthProbe(config.Origin);
        }

        /// <summary>Notifies the tray after committed state changes.</summary>
        public event Action<ServiceSnapshot> StateChanged;

        /// <summary>Gets the last committed state projection.</summary>
        public ServiceSnapshot Snapshot
        {
            get { return snapshot; }
        }

        /// <summary>Ensure a healthy service, reusing external or owned listeners.</summary>
        /// <returns>A native-compatible running or started result.</returns>
        public async Task<ServiceOperationResult> EnsureAsync()
        {
            await lifecycle.WaitAsync().ConfigureAwait(false);
            try
            {
                ThrowIfDisposed();
                bool healthy = await probe.IsHealthyAsync().ConfigureAwait(false);
                if (healthy)
                {
                    bool owns = OwnedProcessAlive();
                    Publish(owns ? CompanionServiceState.RunningOwned : CompanionServiceState.RunningExternal,
                        owns ? "Harness 正在运行" : "检测到外部 Harness 服务");
                    return ServiceOperationResult.Success("running", owns ? "Harness 正在运行" : "外部 Harness 服务正在运行");
                }
                return await StartCoreAsync().ConfigureAwait(false);
            }
            finally
            {
                lifecycle.Release();
            }
        }

        /// <summary>Start Harness only when no healthy service occupies the configured origin.</summary>
        /// <returns>Operation result after readiness or failure.</returns>
        public async Task<ServiceOperationResult> StartAsync()
        {
            return await EnsureAsync().ConfigureAwait(false);
        }

        /// <summary>Restart only the Web process generation owned by this tray.</summary>
        /// <returns>Operation result after old-process quiescence and new readiness.</returns>
        public async Task<ServiceOperationResult> RestartAsync()
        {
            await lifecycle.WaitAsync().ConfigureAwait(false);
            try
            {
                ThrowIfDisposed();
                bool healthy = await probe.IsHealthyAsync().ConfigureAwait(false);
                if (!ServiceOwnershipPolicy.CanStopOrRestart(healthy, OwnedProcessAlive()))
                {
                    return ServiceOperationResult.Failure(healthy
                        ? "当前端口由外部 Harness 服务占用，托盘不会重启不属于它的进程。"
                        : "没有可重启的托盘自有 Harness 服务。");
                }
                await StopOwnedCoreAsync().ConfigureAwait(false);
                return await StartCoreAsync().ConfigureAwait(false);
            }
            finally
            {
                lifecycle.Release();
            }
        }

        /// <summary>Stop and await only the Web process generation owned by this tray.</summary>
        /// <returns>Operation result after port release.</returns>
        public async Task<ServiceOperationResult> StopAsync()
        {
            await lifecycle.WaitAsync().ConfigureAwait(false);
            try
            {
                ThrowIfDisposed();
                bool healthy = await probe.IsHealthyAsync().ConfigureAwait(false);
                if (!ServiceOwnershipPolicy.CanStopOrRestart(healthy, OwnedProcessAlive()))
                {
                    return ServiceOperationResult.Failure(healthy
                        ? "当前端口由外部 Harness 服务占用，托盘不会关闭不属于它的进程。"
                        : "Harness 服务已经停止。");
                }
                await StopOwnedCoreAsync().ConfigureAwait(false);
                return ServiceOperationResult.Success("running", "Harness 服务已关闭");
            }
            finally
            {
                lifecycle.Release();
            }
        }

        /// <summary>Refresh external/owned health without starting or stopping anything.</summary>
        /// <returns>Settlement after the state notification.</returns>
        public async Task RefreshAsync()
        {
            await lifecycle.WaitAsync().ConfigureAwait(false);
            try
            {
                if (disposed || snapshot.State == CompanionServiceState.Starting || snapshot.State == CompanionServiceState.Stopping)
                {
                    return;
                }
                bool healthy = await probe.IsHealthyAsync().ConfigureAwait(false);
                if (healthy)
                {
                    bool owns = OwnedProcessAlive();
                    Publish(owns ? CompanionServiceState.RunningOwned : CompanionServiceState.RunningExternal,
                        owns ? "Harness 正在运行" : "检测到外部 Harness 服务");
                }
                else if (!OwnedProcessAlive())
                {
                    CleanupExitedOwnedRun();
                    Publish(CompanionServiceState.Stopped, "服务未运行");
                }
            }
            finally
            {
                lifecycle.Release();
            }
        }

        /// <summary>Launch the fixed source Web profile and await bounded readiness.</summary>
        /// <returns>Started result or concrete failure.</returns>
        private async Task<ServiceOperationResult> StartCoreAsync()
        {
            CleanupExitedOwnedRun();
            HarnessAddressHolder holder = HarnessAddressClaim.ReadLiveHolder(config.Origin);
            if (holder != null)
            {
                return await AwaitClaimedStartAsync(holder).ConfigureAwait(false);
            }
            Publish(CompanionServiceState.Starting, "正在启动 Harness");
            ServiceLog serviceLog = new ServiceLog(config.LogDirectory);
            Process process = new Process();
            OwnedProcessJob job = null;
            try
            {
                process.StartInfo = CreateStartInfo();
                process.EnableRaisingEvents = true;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { serviceLog.Write("stdout", args.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { serviceLog.Write("stderr", args.Data); };
                if (!process.Start())
                {
                    throw new InvalidOperationException("Windows did not start the Harness Node process.");
                }
                job = new OwnedProcessJob();
                job.Assign(process);
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                owned = new OwnedServiceRun(process, job, serviceLog);
                process.Exited += OwnedProcessExited;
                log.Write("Started managed Harness process " + process.Id + "; output: " + serviceLog.Path);
                bool healthy = await WaitForHealthAsync(process, StartupHealthTimeout).ConfigureAwait(false);
                if (!healthy)
                {
                    int? exitCode = process.HasExited ? (int?)process.ExitCode : null;
                    await TerminateRunAsync(owned).ConfigureAwait(false);
                    owned = null;
                    string detail = exitCode.HasValue
                        ? "Harness 进程在就绪前退出，退出码 " + exitCode.Value + "。日志：" + serviceLog.Path
                        : "Harness 在 " + ((int)StartupHealthTimeout.TotalSeconds) + " 秒内未就绪。日志：" + serviceLog.Path;
                    Publish(CompanionServiceState.Failed, detail);
                    return ServiceOperationResult.Failure(detail);
                }
                Publish(CompanionServiceState.RunningOwned, "Harness 正在运行");
                return ServiceOperationResult.Success("started", "Harness 已启动");
            }
            catch (Exception error)
            {
                if (owned != null && ReferenceEquals(owned.Process, process))
                {
                    await TerminateRunAsync(owned).ConfigureAwait(false);
                    owned = null;
                }
                else
                {
                    if (job != null)
                    {
                        try { job.Terminate(); } catch (Exception terminateError) { log.Write("Failed to terminate partial Harness job: " + terminateError.Message); }
                        job.Dispose();
                    }
                    process.Dispose();
                    serviceLog.Dispose();
                }
                string detail = "Harness 启动失败：" + Program.UserMessage(error) + " 日志：" + serviceLog.Path;
                log.Write(detail);
                Publish(CompanionServiceState.Failed, detail);
                return ServiceOperationResult.Failure(detail);
            }
        }

        /// <summary>
        /// Wait out a boot another process already claimed instead of launching a
        /// duplicate. That other process binds the origin as soon as its tree
        /// finishes loading, so the only useful outcomes are the health this
        /// caller wanted and a message naming who to stop.
        /// </summary>
        /// <param name="holder">The live process holding the origin claim.</param>
        /// <returns>Running once the claimed boot answers, or a failure naming its holder.</returns>
        private async Task<ServiceOperationResult> AwaitClaimedStartAsync(HarnessAddressHolder holder)
        {
            string who = holder.Describe();
            log.Write("Harness origin already claimed by " + who + "; awaiting its readiness instead of starting a second one.");
            Publish(CompanionServiceState.Starting, "另一个 Harness 正在启动（" + who + "），正在等待它就绪");
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.Elapsed < StartupHealthTimeout)
            {
                if (await probe.IsHealthyAsync().ConfigureAwait(false))
                {
                    Publish(CompanionServiceState.RunningExternal, "检测到外部 Harness 服务");
                    return ServiceOperationResult.Success("running", "外部 Harness 服务正在运行");
                }
                if (HarnessAddressClaim.ReadLiveHolder(config.Origin) == null)
                {
                    string gone = "另一个 Harness（" + who + "）在就绪前退出，请重试启动。";
                    Publish(CompanionServiceState.Failed, gone);
                    return ServiceOperationResult.Failure(gone);
                }
                await Task.Delay(300).ConfigureAwait(false);
            }
            string detail = "另一个 Harness（" + who + "）已占用 " + config.Origin
                + "，但在 " + ((int)StartupHealthTimeout.TotalSeconds) + " 秒内仍未就绪。请先结束该进程再启动。";
            Publish(CompanionServiceState.Failed, detail);
            return ServiceOperationResult.Failure(detail);
        }

        /// <summary>Build the only executable and argument set the companion may launch.</summary>
        /// <returns>Hidden, redirected Node process settings.</returns>
        private ProcessStartInfo CreateStartInfo()
        {
            ProcessStartInfo info = new ProcessStartInfo
            {
                FileName = config.NodePath,
                Arguments = "--import tsx/esm apps/cli/src/bin.ts --profile web",
                WorkingDirectory = config.RepositoryRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false)
            };
            info.EnvironmentVariables.Remove("NODE_OPTIONS");
            info.EnvironmentVariables["DSH_BROWSER_COMPANION_MANAGED"] = "1";
            return info;
        }

        /// <summary>Wait until Harness answers or the owned process exits.</summary>
        /// <param name="process">Owned Node process.</param>
        /// <param name="timeout">Readiness deadline.</param>
        /// <returns>Whether a healthy response arrived before the deadline.</returns>
        private async Task<bool> WaitForHealthAsync(Process process, TimeSpan timeout)
        {
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.Elapsed < timeout)
            {
                if (process.HasExited)
                {
                    return false;
                }
                if (await probe.IsHealthyAsync().ConfigureAwait(false))
                {
                    return true;
                }
                await Task.Delay(300).ConfigureAwait(false);
            }
            return false;
        }

        /// <summary>Terminate the owned job and await process and port quiescence.</summary>
        private async Task StopOwnedCoreAsync()
        {
            OwnedServiceRun run = owned;
            if (run == null)
            {
                Publish(CompanionServiceState.Stopped, "服务未运行");
                return;
            }
            Publish(CompanionServiceState.Stopping, "正在关闭 Harness");
            owned = null;
            await TerminateRunAsync(run).ConfigureAwait(false);
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.Elapsed < TimeSpan.FromSeconds(10) && await probe.IsHealthyAsync().ConfigureAwait(false))
            {
                await Task.Delay(200).ConfigureAwait(false);
            }
            if (await probe.IsHealthyAsync().ConfigureAwait(false))
            {
                Publish(CompanionServiceState.RunningExternal, "托盘自有进程已退出，但端口仍由外部服务占用");
                return;
            }
            Publish(CompanionServiceState.Stopped, "服务未运行");
        }

        /// <summary>Terminate one job and wait for its main process before disposal.</summary>
        /// <param name="run">Owned process generation.</param>
        private async Task TerminateRunAsync(OwnedServiceRun run)
        {
            run.Process.Exited -= OwnedProcessExited;
            try
            {
                run.Job.Terminate();
            }
            catch (Exception error)
            {
                log.Write("Failed to terminate Harness job: " + error.Message);
            }
            await WaitForExitAsync(run.Process, TimeSpan.FromSeconds(10)).ConfigureAwait(false);
            try
            {
                run.Process.WaitForExit();
            }
            catch (InvalidOperationException)
            {
                // A failed Process.Start has no process handle to flush.
            }
            run.Dispose();
        }

        /// <summary>Await process exit without returning before the timeout.</summary>
        /// <param name="process">Started process.</param>
        /// <param name="timeout">Maximum exit wait.</param>
        /// <returns>Whether the process exited.</returns>
        private static async Task<bool> WaitForExitAsync(Process process, TimeSpan timeout)
        {
            if (process.HasExited)
            {
                return true;
            }
            TaskCompletionSource<bool> exited = new TaskCompletionSource<bool>();
            EventHandler handler = delegate { exited.TrySetResult(true); };
            process.Exited += handler;
            process.EnableRaisingEvents = true;
            try
            {
                if (process.HasExited)
                {
                    return true;
                }
                Task completed = await Task.WhenAny(exited.Task, Task.Delay(timeout)).ConfigureAwait(false);
                return ReferenceEquals(completed, exited.Task);
            }
            finally
            {
                process.Exited -= handler;
            }
        }

        /// <summary>Observe unexpected exit and reconcile state through the lifecycle serializer.</summary>
        private async void OwnedProcessExited(object sender, EventArgs args)
        {
            try
            {
                await lifecycle.WaitAsync().ConfigureAwait(false);
                try
                {
                    Process process = sender as Process;
                    if (owned == null || process == null || !ReferenceEquals(owned.Process, process))
                    {
                        return;
                    }
                    int exitCode = process.ExitCode;
                    OwnedServiceRun run = owned;
                    owned = null;
                    run.Dispose();
                    Publish(CompanionServiceState.Failed, "Harness 进程意外退出，退出码 " + exitCode + "。");
                }
                finally
                {
                    lifecycle.Release();
                }
            }
            catch (Exception error)
            {
                log.Write("Failed to reconcile an exited Harness process: " + error.Message);
            }
        }

        /// <summary>Release an already-exited process generation before a new start.</summary>
        private void CleanupExitedOwnedRun()
        {
            if (owned == null || !owned.Process.HasExited)
            {
                return;
            }
            OwnedServiceRun run = owned;
            owned = null;
            run.Process.Exited -= OwnedProcessExited;
            run.Dispose();
        }

        /// <summary>Check whether the current owned main process still exists.</summary>
        /// <returns>Whether this manager owns a live process generation.</returns>
        private bool OwnedProcessAlive()
        {
            return owned != null && !owned.Process.HasExited;
        }

        /// <summary>Commit state and contain tray subscriber failures.</summary>
        /// <param name="state">New lifecycle state.</param>
        /// <param name="detail">Concise user-visible detail.</param>
        private void Publish(CompanionServiceState state, string detail)
        {
            if (snapshot.State == state && string.Equals(snapshot.Detail, detail, StringComparison.Ordinal))
            {
                return;
            }
            snapshot = new ServiceSnapshot(state, detail);
            Action<ServiceSnapshot> handler = StateChanged;
            if (handler == null)
            {
                return;
            }
            try
            {
                handler(snapshot);
            }
            catch (Exception error)
            {
                log.Write("Tray state subscriber failed: " + error.Message);
            }
        }

        /// <summary>Reject lifecycle work after teardown begins.</summary>
        private void ThrowIfDisposed()
        {
            if (disposed)
            {
                throw new ObjectDisposedException("HarnessServiceManager");
            }
        }

        /// <summary>Synchronously reach process quiescence before tray teardown returns.</summary>
        public void Dispose()
        {
            lifecycle.Wait();
            try
            {
                if (disposed)
                {
                    return;
                }
                disposed = true;
                if (owned != null)
                {
                    OwnedServiceRun run = owned;
                    owned = null;
                    TerminateRunAsync(run).GetAwaiter().GetResult();
                }
                probe.Dispose();
            }
            finally
            {
                lifecycle.Release();
                lifecycle.Dispose();
            }
        }
    }
}
