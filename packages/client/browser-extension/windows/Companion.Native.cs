using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading.Tasks;

namespace DeepSeekHarness.BrowserCompanion
{
    /// <summary>Fixed Task Scheduler launcher that keeps the tray outside Chrome's process job.</summary>
    public static class TrayTaskLauncher
    {
        /// <summary>Create the fixed hidden <c>schtasks /Run</c> invocation.</summary>
        /// <param name="windowsDirectory">Trusted Windows directory.</param>
        /// <returns>Closed task-launch process settings.</returns>
        public static ProcessStartInfo CreateStartInfo(string windowsDirectory)
        {
            if (string.IsNullOrWhiteSpace(windowsDirectory) || !Path.IsPathRooted(windowsDirectory))
            {
                throw new InvalidDataException("Windows directory must be an absolute path.");
            }
            string executable = Path.Combine(Path.GetFullPath(windowsDirectory), "System32", "schtasks.exe");
            if (!File.Exists(executable))
            {
                throw new FileNotFoundException("Windows Task Scheduler command was not found.", executable);
            }
            return new ProcessStartInfo
            {
                FileName = executable,
                Arguments = "/Run /TN \"DeepSeek Harness Browser Companion\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
        }

        /// <summary>Start the installed current-user task and require Task Scheduler acceptance.</summary>
        public static void Start()
        {
            string windowsDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            using (Process process = new Process { StartInfo = CreateStartInfo(windowsDirectory) })
            {
                if (!process.Start())
                {
                    throw new InvalidOperationException("Windows 未能启动 Harness 登录任务。");
                }
                if (!process.WaitForExit(10000))
                {
                    process.Kill();
                    process.WaitForExit();
                    throw new TimeoutException("Windows 登录任务启动命令超时。");
                }
                string output = process.StandardOutput.ReadToEnd().Trim();
                string error = process.StandardError.ReadToEnd().Trim();
                if (process.ExitCode != 0)
                {
                    string detail = string.IsNullOrEmpty(error) ? output : error;
                    throw new InvalidOperationException("Windows 登录任务未能启动。" + (string.IsNullOrEmpty(detail) ? string.Empty : " " + detail));
                }
            }
        }
    }

    /// <summary>One-shot client for the current user's tray command pipe.</summary>
    public static class CompanionPipeClient
    {
        /// <summary>Send one framed request and wait for one framed response.</summary>
        /// <param name="pipeName">Current-user pipe name.</param>
        /// <param name="requestJson">Closed request JSON.</param>
        /// <param name="connectTimeoutMilliseconds">Bounded pipe connection wait.</param>
        /// <returns>Closed response JSON.</returns>
        public static string Send(string pipeName, string requestJson, int connectTimeoutMilliseconds)
        {
            using (NamedPipeClientStream client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.None))
            {
                client.Connect(connectTimeoutMilliseconds);
                NativeMessageProtocol.WriteJson(client, requestJson);
                return NativeMessageProtocol.ReadJson(client);
            }
        }
    }

    /// <summary>Current-user-only command server owned by the long-lived tray.</summary>
    public sealed class CompanionPipeServer : IDisposable
    {
        private readonly string pipeName;
        private readonly Func<CompanionRequest, Task<string>> handler;
        private readonly CompanionLog log;
        private readonly object sync = new object();
        private NamedPipeServerStream current;
        private bool disposed;
        private Task loop;

        /// <summary>Create one serial command server.</summary>
        /// <param name="pipeName">Current-user pipe name.</param>
        /// <param name="handler">Closed ensure-web handler.</param>
        /// <param name="log">Companion diagnostic sink.</param>
        public CompanionPipeServer(string pipeName, Func<CompanionRequest, Task<string>> handler, CompanionLog log)
        {
            this.pipeName = pipeName;
            this.handler = handler;
            this.log = log;
        }

        /// <summary>Start accepting serial current-user commands.</summary>
        public void Start()
        {
            lock (sync)
            {
                if (loop != null)
                {
                    return;
                }
                loop = AcceptLoopAsync();
            }
        }

        /// <summary>Accept, validate, handle, and close one pipe connection at a time.</summary>
        private async Task AcceptLoopAsync()
        {
            while (true)
            {
                NamedPipeServerStream server;
                lock (sync)
                {
                    if (disposed)
                    {
                        return;
                    }
                    server = CreateServer();
                    current = server;
                }
                try
                {
                    await Task.Factory.FromAsync(server.BeginWaitForConnection, server.EndWaitForConnection, null).ConfigureAwait(false);
                    log.Write("Companion pipe accepted a client.");
                    CompanionRequest request = CompanionRequest.Parse(NativeMessageProtocol.ReadJson(server));
                    log.Write("Companion pipe validated ensure-web for " + request.Origin + ".");
                    string response = await handler(request).ConfigureAwait(false);
                    log.Write("Companion pipe handler completed.");
                    NativeMessageProtocol.WriteJson(server, response);
                    log.Write("Companion pipe response was written.");
                }
                catch (ObjectDisposedException)
                {
                    lock (sync)
                    {
                        if (disposed)
                        {
                            return;
                        }
                    }
                }
                catch (IOException error)
                {
                    lock (sync)
                    {
                        if (disposed)
                        {
                            return;
                        }
                    }
                    log.Write("Companion pipe I/O failed: " + error.Message);
                }
                catch (Exception error)
                {
                    log.Write("Companion pipe request failed: " + error.Message);
                    if (server.IsConnected)
                    {
                        try
                        {
                            NativeMessageProtocol.WriteJson(server, CompanionResponse.Failure(Program.UserMessage(error)));
                        }
                        catch (Exception responseError)
                        {
                            log.Write("Companion pipe failure response failed: " + responseError.Message);
                        }
                    }
                }
                finally
                {
                    lock (sync)
                    {
                        if (ReferenceEquals(current, server))
                        {
                            current = null;
                        }
                    }
                    server.Dispose();
                }
            }
        }

        /// <summary>Create a byte-mode pipe whose ACL grants only the current Windows user.</summary>
        /// <returns>One asynchronous single-client server instance.</returns>
        private NamedPipeServerStream CreateServer()
        {
            SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
            if (user == null)
            {
                throw new InvalidOperationException("Companion could not resolve the current Windows user SID for pipe security.");
            }
            PipeSecurity security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.SetOwner(user);
            security.AddAccessRule(new PipeAccessRule(
                user,
                PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance,
                AccessControlType.Allow));
            return new NamedPipeServerStream(
                pipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous,
                4096,
                4096,
                security);
        }

        /// <summary>Stop accepting commands and await no work beyond the active handler.</summary>
        public void Dispose()
        {
            Task running;
            lock (sync)
            {
                if (disposed)
                {
                    return;
                }
                disposed = true;
                if (current != null)
                {
                    current.Dispose();
                }
                running = loop;
            }
            if (running != null)
            {
                try
                {
                    running.GetAwaiter().GetResult();
                }
                catch (Exception error)
                {
                    log.Write("Companion pipe teardown failed: " + error.Message);
                }
            }
        }
    }

    /// <summary>Chrome Native Messaging adapter that starts or reuses the tray.</summary>
    public static class NativeHostApplication
    {
        /// <summary>Read one Chrome request, authorize it, and write one response.</summary>
        /// <param name="config">Validated installed configuration.</param>
        /// <param name="commandLine">Chrome-supplied caller origin.</param>
        /// <param name="input">Chrome standard input.</param>
        /// <param name="output">Chrome standard output.</param>
        /// <returns>Zero after a framed response, nonzero for a failed ensure.</returns>
        public static int Run(CompanionConfig config, CompanionCommandLine commandLine, Stream input, Stream output)
        {
            string response;
            string tracePath = Path.Combine(config.LogDirectory, "native-host-" + Process.GetCurrentProcess().Id + ".log");
            try
            {
                Trace(tracePath, "Native host started.");
                string caller = CompanionConfigurationPolicy.ValidateExtensionOrigin(commandLine.CallerOrigin);
                if (!string.Equals(caller, config.ExtensionOrigin, StringComparison.Ordinal))
                {
                    throw new InvalidDataException("Chrome caller is not authorized for this companion installation.");
                }
                string requestJson = NativeMessageProtocol.ReadJson(input);
                Trace(tracePath, "Native request frame was read.");
                CompanionRequest request = CompanionRequest.Parse(requestJson);
                if (!string.Equals(CompanionConfigurationPolicy.ValidateOrigin(request.Origin), config.Origin, StringComparison.Ordinal))
                {
                    throw new InvalidDataException("Native request origin does not match the installed Harness origin.");
                }
                Trace(tracePath, "Native request was validated; sending to tray.");
                response = SendWithTrayRecovery(requestJson, tracePath);
                Trace(tracePath, "Tray response was received.");
            }
            catch (Exception error)
            {
                Trace(tracePath, "Native request failed: " + error.GetType().Name + ": " + error.Message);
                response = CompanionResponse.Failure(Program.UserMessage(error));
            }
            Trace(tracePath, "Writing Chrome response.");
            NativeMessageProtocol.WriteJson(output, response);
            Trace(tracePath, "Chrome response was written; exiting.");
            return response.StartsWith("{\"ok\":true", StringComparison.Ordinal) ? 0 : 1;
        }

        /// <summary>Use the existing tray, or launch it and retry its command pipe.</summary>
        /// <param name="config">Validated installed configuration.</param>
        /// <param name="requestJson">Already validated native request.</param>
        /// <returns>Tray response JSON.</returns>
        private static string SendWithTrayRecovery(string requestJson, string tracePath)
        {
            try
            {
                Trace(tracePath, "Trying existing tray pipe.");
                return CompanionPipeClient.Send(CompanionIdentity.PipeName(), requestJson, 400);
            }
            catch (TimeoutException)
            {
                Trace(tracePath, "Existing tray pipe timed out; starting tray.");
                TrayTaskLauncher.Start();
            }
            catch (IOException)
            {
                Trace(tracePath, "Existing tray pipe was unavailable; starting tray.");
                TrayTaskLauncher.Start();
            }
            Stopwatch timer = Stopwatch.StartNew();
            Exception last = null;
            while (timer.Elapsed < TimeSpan.FromSeconds(10))
            {
                try
                {
                    Trace(tracePath, "Retrying tray pipe.");
                    return CompanionPipeClient.Send(CompanionIdentity.PipeName(), requestJson, 500);
                }
                catch (TimeoutException error)
                {
                    last = error;
                }
                catch (IOException error)
                {
                    last = error;
                }
            }
            throw new InvalidOperationException("本机托盘在 10 秒内未就绪。", last);
        }

        /// <summary>Append one per-process diagnostic without using Native Messaging stdout.</summary>
        /// <param name="path">Unique native-host log path.</param>
        /// <param name="message">Lifecycle boundary without request secrets.</param>
        private static void Trace(string path, string message)
        {
            try
            {
                File.AppendAllText(path, DateTimeOffset.Now.ToString("o") + " " + message + Environment.NewLine);
            }
            catch (IOException)
            {
                // Per-process trace loss must not alter the Native Messaging response.
            }
            catch (UnauthorizedAccessException)
            {
                // Installer-owned log ACL failures remain observable through Chrome's host error.
            }
        }

    }
}
