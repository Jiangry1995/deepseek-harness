using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace DeepSeekHarness.BrowserCompanion
{
    /// <summary>Closed execution modes accepted by the companion executable.</summary>
    public enum CompanionMode
    {
        Invalid,
        Tray,
        NativeHost
    }

    /// <summary>Validated companion command-line selection.</summary>
    public sealed class CompanionCommandLine
    {
        /// <summary>Gets the selected executable mode.</summary>
        public CompanionMode Mode { get; private set; }

        /// <summary>Gets whether tray startup also ensures the Web service.</summary>
        public bool StartService { get; private set; }

        /// <summary>Gets the Chrome extension origin supplied to a native host.</summary>
        public string CallerOrigin { get; private set; }

        /// <summary>Parse the fixed tray and Chrome Native Messaging forms.</summary>
        /// <param name="arguments">Process arguments excluding the executable path.</param>
        /// <returns>A validated closed mode selection.</returns>
        public static CompanionCommandLine Parse(string[] arguments)
        {
            CompanionCommandLine result = new CompanionCommandLine { Mode = CompanionMode.Invalid };
            if (arguments == null || arguments.Length == 0)
            {
                return result;
            }
            if (string.Equals(arguments[0], "--tray", StringComparison.Ordinal))
            {
                if (arguments.Length == 1)
                {
                    result.Mode = CompanionMode.Tray;
                    return result;
                }
                if (arguments.Length == 2 && string.Equals(arguments[1], "--start-service", StringComparison.Ordinal))
                {
                    result.Mode = CompanionMode.Tray;
                    result.StartService = true;
                }
                return result;
            }
            if (arguments[0].StartsWith("chrome-extension://", StringComparison.Ordinal))
            {
                if (arguments.Length > 2 || (arguments.Length == 2 && !arguments[1].StartsWith("--parent-window=", StringComparison.Ordinal)))
                {
                    return result;
                }
                result.Mode = CompanionMode.NativeHost;
                result.CallerOrigin = arguments[0];
            }
            return result;
        }
    }

    /// <summary>Length-prefixed UTF-8 JSON framing required by Chrome Native Messaging.</summary>
    public static class NativeMessageProtocol
    {
        private const int MaximumMessageBytes = 1024 * 1024;

        /// <summary>Read one bounded Native Messaging JSON document.</summary>
        /// <param name="input">Binary standard-input stream.</param>
        /// <returns>The decoded JSON document.</returns>
        public static string ReadJson(Stream input)
        {
            if (input == null)
            {
                throw new ArgumentNullException("input");
            }
            byte[] prefix = ReadExactly(input, 4);
            int length = prefix[0] | (prefix[1] << 8) | (prefix[2] << 16) | (prefix[3] << 24);
            if (length <= 0 || length > MaximumMessageBytes)
            {
                throw new InvalidDataException("Native Messaging message length is outside the permitted range.");
            }
            byte[] payload = ReadExactly(input, length);
            return new UTF8Encoding(false, true).GetString(payload);
        }

        /// <summary>Write one Native Messaging JSON document and flush the stream.</summary>
        /// <param name="output">Binary standard-output stream.</param>
        /// <param name="json">UTF-8 JSON document.</param>
        public static void WriteJson(Stream output, string json)
        {
            if (output == null)
            {
                throw new ArgumentNullException("output");
            }
            if (string.IsNullOrEmpty(json))
            {
                throw new InvalidDataException("Native Messaging response JSON must not be empty.");
            }
            byte[] payload = new UTF8Encoding(false, true).GetBytes(json);
            if (payload.Length > MaximumMessageBytes)
            {
                throw new InvalidDataException("Native Messaging response exceeds one megabyte.");
            }
            byte[] prefix = new[]
            {
                (byte)(payload.Length & 0xff),
                (byte)((payload.Length >> 8) & 0xff),
                (byte)((payload.Length >> 16) & 0xff),
                (byte)((payload.Length >> 24) & 0xff)
            };
            output.Write(prefix, 0, prefix.Length);
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }

        /// <summary>Read the exact byte count or reject a truncated Chrome/native frame.</summary>
        /// <param name="input">Input stream.</param>
        /// <param name="count">Required byte count.</param>
        /// <returns>The complete byte buffer.</returns>
        private static byte[] ReadExactly(Stream input, int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = input.Read(buffer, offset, count - offset);
                if (read == 0)
                {
                    throw new EndOfStreamException("Native Messaging frame ended before its declared length.");
                }
                offset += read;
            }
            return buffer;
        }
    }

    /// <summary>Closed native request accepted from the authorized extension.</summary>
    public sealed class CompanionRequest
    {
        /// <summary>Gets the configured Harness origin to ensure.</summary>
        public string Origin { get; private set; }

        /// <summary>Parse an exact <c>ensure-web</c> JSON request.</summary>
        /// <param name="json">Untrusted Native Messaging JSON.</param>
        /// <returns>The validated request.</returns>
        public static CompanionRequest Parse(string json)
        {
            Dictionary<string, object> value;
            try
            {
                value = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            }
            catch (Exception error)
            {
                throw new InvalidDataException("Native request is not valid JSON.", error);
            }
            if (value == null || value.Count != 2 || !value.ContainsKey("kind") || !value.ContainsKey("origin")
                || !string.Equals(value["kind"] as string, "ensure-web", StringComparison.Ordinal)
                || string.IsNullOrEmpty(value["origin"] as string))
            {
                throw new InvalidDataException("Native request must contain only kind=ensure-web and origin.");
            }
            return new CompanionRequest { Origin = (string)value["origin"] };
        }
    }

    /// <summary>Native Messaging response serialization.</summary>
    public static class CompanionResponse
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        /// <summary>Serialize a successful healthy-origin result.</summary>
        /// <param name="state">Either <c>running</c> or <c>started</c>.</param>
        /// <param name="origin">Configured healthy origin.</param>
        /// <returns>Exact response JSON.</returns>
        public static string Success(string state, string origin)
        {
            if (!string.Equals(state, "running", StringComparison.Ordinal) && !string.Equals(state, "started", StringComparison.Ordinal))
            {
                throw new InvalidDataException("Companion success state must be running or started.");
            }
            string validatedOrigin = CompanionConfigurationPolicy.ValidateOrigin(origin);
            return "{\"ok\":true,\"state\":" + Serializer.Serialize(state) + ",\"origin\":" + Serializer.Serialize(validatedOrigin) + "}";
        }

        /// <summary>Serialize a concrete startup failure.</summary>
        /// <param name="message">User-displayable failure without secrets.</param>
        /// <returns>Exact response JSON.</returns>
        public static string Failure(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                message = "本机伴随程序发生未知错误。";
            }
            return "{\"ok\":false,\"error\":" + Serializer.Serialize(message) + "}";
        }
    }

    /// <summary>Security validation for installed companion configuration.</summary>
    public static class CompanionConfigurationPolicy
    {
        private const string ManagedOrigin = "http://127.0.0.1:3080";

        /// <summary>Validate the one origin a companion installation may manage.</summary>
        /// <param name="origin">Candidate absolute origin.</param>
        /// <returns>The canonical permitted origin.</returns>
        public static string ValidateOrigin(string origin)
        {
            Uri parsed;
            if (!Uri.TryCreate(origin, UriKind.Absolute, out parsed)
                || !string.Equals(parsed.Scheme, Uri.UriSchemeHttp, StringComparison.Ordinal)
                || !string.Equals(parsed.Host, "127.0.0.1", StringComparison.Ordinal)
                || parsed.Port != 3080
                || !string.Equals(parsed.AbsolutePath, "/", StringComparison.Ordinal)
                || !string.IsNullOrEmpty(parsed.Query)
                || !string.IsNullOrEmpty(parsed.Fragment)
                || !string.IsNullOrEmpty(parsed.UserInfo)
                || !string.Equals(parsed.GetLeftPart(UriPartial.Authority), ManagedOrigin, StringComparison.Ordinal))
            {
                throw new InvalidDataException("Companion origin must be exactly http://127.0.0.1:3080.");
            }
            return ManagedOrigin;
        }

        /// <summary>Validate the stable extension caller origin.</summary>
        /// <param name="origin">Candidate Chrome extension origin.</param>
        /// <returns>The exact normalized caller origin.</returns>
        public static string ValidateExtensionOrigin(string origin)
        {
            Uri parsed;
            if (!Uri.TryCreate(origin, UriKind.Absolute, out parsed)
                || !string.Equals(parsed.Scheme, "chrome-extension", StringComparison.Ordinal)
                || parsed.Host.Length != 32
                || !AllExtensionIdCharacters(parsed.Host)
                || !string.Equals(parsed.AbsolutePath, "/", StringComparison.Ordinal)
                || !string.IsNullOrEmpty(parsed.Query)
                || !string.IsNullOrEmpty(parsed.Fragment))
            {
                throw new InvalidDataException("Companion extension origin is invalid.");
            }
            return "chrome-extension://" + parsed.Host + "/";
        }

        /// <summary>Check Chrome's a-through-p extension-id alphabet.</summary>
        /// <param name="value">Candidate 32-character id.</param>
        /// <returns>Whether every character belongs to the Chrome id alphabet.</returns>
        private static bool AllExtensionIdCharacters(string value)
        {
            for (int index = 0; index < value.Length; index++)
            {
                if (value[index] < 'a' || value[index] > 'p')
                {
                    return false;
                }
            }
            return true;
        }
    }

    /// <summary>Ownership policy preventing tray controls from killing external servers.</summary>
    public static class ServiceOwnershipPolicy
    {
        /// <summary>Decide whether a destructive service action is permitted.</summary>
        /// <param name="healthy">Whether the configured origin currently answers.</param>
        /// <param name="ownedProcessAlive">Whether the tray owns a live Web process.</param>
        /// <returns>Whether stop or restart may terminate the server.</returns>
        public static bool CanStopOrRestart(bool healthy, bool ownedProcessAlive)
        {
            return ownedProcessAlive;
        }
    }

    /// <summary>Validated installation configuration loaded beside the executable.</summary>
    public sealed class CompanionConfig
    {
        /// <summary>Gets the repository root containing the source-launch entry.</summary>
        public string RepositoryRoot { get; private set; }

        /// <summary>Gets the absolute Node executable path captured during installation.</summary>
        public string NodePath { get; private set; }

        /// <summary>Gets the only Harness origin this installation manages.</summary>
        public string Origin { get; private set; }

        /// <summary>Gets the stable extension origin authorized by the native-host manifest.</summary>
        public string ExtensionOrigin { get; private set; }

        /// <summary>Gets the durable companion and Web-process log directory.</summary>
        public string LogDirectory { get; private set; }

        /// <summary>Load and validate an installer-owned JSON configuration file.</summary>
        /// <param name="path">Absolute configuration path beside the executable.</param>
        /// <returns>The validated configuration.</returns>
        public static CompanionConfig Load(string path)
        {
            string fullPath = Path.GetFullPath(path);
            Dictionary<string, object> value;
            try
            {
                value = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(fullPath, Encoding.UTF8));
            }
            catch (Exception error)
            {
                throw new InvalidDataException("Companion configuration could not be read: " + fullPath, error);
            }
            if (value == null || value.Count != 5)
            {
                throw new InvalidDataException("Companion configuration must contain exactly five fields.");
            }
            CompanionConfig config = new CompanionConfig
            {
                RepositoryRoot = RequireAbsoluteDirectory(value, "repositoryRoot"),
                NodePath = RequireAbsoluteFile(value, "nodePath"),
                Origin = CompanionConfigurationPolicy.ValidateOrigin(RequireString(value, "origin")),
                ExtensionOrigin = CompanionConfigurationPolicy.ValidateExtensionOrigin(RequireString(value, "extensionOrigin")),
                LogDirectory = RequireAbsolutePath(value, "logDirectory")
            };
            if (!string.Equals(Path.GetFileName(config.NodePath), "node.exe", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Companion nodePath must name node.exe.");
            }
            string cliEntry = Path.Combine(config.RepositoryRoot, "apps", "cli", "src", "bin.ts");
            if (!File.Exists(cliEntry))
            {
                throw new InvalidDataException("Companion repositoryRoot does not contain apps/cli/src/bin.ts.");
            }
            Directory.CreateDirectory(config.LogDirectory);
            return config;
        }

        /// <summary>Read one required text field from installer JSON.</summary>
        /// <param name="value">Parsed JSON record.</param>
        /// <param name="key">Required field name.</param>
        /// <returns>Non-empty text value.</returns>
        private static string RequireString(Dictionary<string, object> value, string key)
        {
            object field;
            if (!value.TryGetValue(key, out field) || string.IsNullOrWhiteSpace(field as string))
            {
                throw new InvalidDataException("Companion configuration field " + key + " must be non-empty text.");
            }
            return (string)field;
        }

        /// <summary>Validate and resolve one absolute existing directory.</summary>
        /// <param name="value">Parsed JSON record.</param>
        /// <param name="key">Required field name.</param>
        /// <returns>Resolved existing directory.</returns>
        private static string RequireAbsoluteDirectory(Dictionary<string, object> value, string key)
        {
            string path = RequireAbsolutePath(value, key);
            if (!Directory.Exists(path))
            {
                throw new InvalidDataException("Companion configuration directory does not exist: " + path);
            }
            return path;
        }

        /// <summary>Validate and resolve one absolute existing file.</summary>
        /// <param name="value">Parsed JSON record.</param>
        /// <param name="key">Required field name.</param>
        /// <returns>Resolved existing file.</returns>
        private static string RequireAbsoluteFile(Dictionary<string, object> value, string key)
        {
            string path = RequireAbsolutePath(value, key);
            if (!File.Exists(path))
            {
                throw new InvalidDataException("Companion configuration file does not exist: " + path);
            }
            return path;
        }

        /// <summary>Validate and resolve one absolute path without creating it.</summary>
        /// <param name="value">Parsed JSON record.</param>
        /// <param name="key">Required field name.</param>
        /// <returns>Resolved absolute path.</returns>
        private static string RequireAbsolutePath(Dictionary<string, object> value, string key)
        {
            string path = RequireString(value, key);
            if (!Path.IsPathRooted(path))
            {
                throw new InvalidDataException("Companion configuration field " + key + " must be absolute.");
            }
            return Path.GetFullPath(path);
        }
    }

    /// <summary>Per-user names for the mutex and named-pipe control channel.</summary>
    public static class CompanionIdentity
    {
        /// <summary>Build the current user's isolated named-pipe name.</summary>
        /// <returns>A stable non-secret current-user pipe name.</returns>
        public static string PipeName()
        {
            return "DeepSeekHarnessBrowserCompanion." + UserSuffix();
        }

        /// <summary>Build the current user's local single-instance mutex name.</summary>
        /// <returns>A stable current-session mutex name.</returns>
        public static string MutexName()
        {
            return "Local\\DeepSeekHarnessBrowserCompanion." + UserSuffix();
        }

        /// <summary>Hash the current Windows SID so names contain no account text.</summary>
        /// <returns>Sixteen lowercase hexadecimal characters.</returns>
        private static string UserSuffix()
        {
            SecurityIdentifier sid = WindowsIdentity.GetCurrent().User;
            if (sid == null)
            {
                throw new InvalidOperationException("Companion could not resolve the current Windows user SID.");
            }
            byte[] bytes = Encoding.UTF8.GetBytes(sid.Value);
            byte[] hash;
            using (SHA256 algorithm = SHA256.Create())
            {
                hash = algorithm.ComputeHash(bytes);
            }
            StringBuilder suffix = new StringBuilder(16);
            for (int index = 0; index < 8; index++)
            {
                suffix.Append(hash[index].ToString("x2", CultureInfo.InvariantCulture));
            }
            return suffix.ToString();
        }
    }

    /// <summary>Low-volume companion diagnostics that never write to Native Messaging stdout.</summary>
    public sealed class CompanionLog : IDisposable
    {
        private readonly object sync = new object();
        private readonly StreamWriter writer;

        /// <summary>Open an append-only UTF-8 companion log.</summary>
        /// <param name="directory">Validated log directory.</param>
        public CompanionLog(string directory)
        {
            Directory.CreateDirectory(directory);
            writer = new StreamWriter(Path.Combine(directory, "companion.log"), true, new UTF8Encoding(false));
            writer.AutoFlush = true;
        }

        /// <summary>Append one timestamped diagnostic line.</summary>
        /// <param name="message">Diagnostic without credentials.</param>
        public void Write(string message)
        {
            lock (sync)
            {
                writer.WriteLine(DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture) + " " + message);
            }
        }

        /// <summary>Flush and close the owned append writer.</summary>
        public void Dispose()
        {
            lock (sync)
            {
                writer.Dispose();
            }
        }
    }

    /// <summary>Executable entry point for tray and Chrome Native Messaging modes.</summary>
    public static class Program
    {
        /// <summary>Run the selected companion mode.</summary>
        /// <param name="arguments">Tray or Chrome Native Messaging arguments.</param>
        /// <returns>Process exit status.</returns>
        [STAThread]
        public static int Main(string[] arguments)
        {
            CompanionCommandLine commandLine = CompanionCommandLine.Parse(arguments);
            if (commandLine.Mode == CompanionMode.Invalid)
            {
                return 2;
            }
            try
            {
                string executable = Assembly.GetExecutingAssembly().Location;
                CompanionConfig config = CompanionConfig.Load(Path.Combine(Path.GetDirectoryName(executable), "companion.json"));
                if (commandLine.Mode == CompanionMode.NativeHost)
                {
                    return NativeHostApplication.Run(config, commandLine, Console.OpenStandardInput(), Console.OpenStandardOutput());
                }
                return RunTray(config, commandLine.StartService);
            }
            catch (Exception error)
            {
                if (commandLine.Mode == CompanionMode.NativeHost)
                {
                    TryWriteNativeFailure(error);
                }
                else
                {
                    Trace.WriteLine("DeepSeek Harness companion startup failed: " + error);
                }
                return 1;
            }
        }

        /// <summary>Run one tray instance or forward startup to the existing instance.</summary>
        /// <param name="config">Validated installed configuration.</param>
        /// <param name="startService">Whether this invocation must ensure Harness.</param>
        /// <returns>Process exit status after tray exit or forwarding.</returns>
        private static int RunTray(CompanionConfig config, bool startService)
        {
            bool created;
            using (System.Threading.Mutex mutex = new System.Threading.Mutex(true, CompanionIdentity.MutexName(), out created))
            {
                if (!created)
                {
                    if (startService)
                    {
                        string request = "{\"kind\":\"ensure-web\",\"origin\":\"http://127.0.0.1:3080\"}";
                        CompanionPipeClient.Send(CompanionIdentity.PipeName(), request, 10000);
                    }
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (TrayApplicationContext context = new TrayApplicationContext(config, startService))
                {
                    Application.Run(context);
                }
                return 0;
            }
        }

        /// <summary>Best-effort one framed failure when configuration fails before native dispatch.</summary>
        /// <param name="error">Fatal startup error.</param>
        private static void TryWriteNativeFailure(Exception error)
        {
            try
            {
                NativeMessageProtocol.WriteJson(Console.OpenStandardOutput(), CompanionResponse.Failure(UserMessage(error)));
            }
            catch (Exception writeError)
            {
                Console.Error.WriteLine("DeepSeek Harness native host failed: " + writeError.Message);
            }
        }

        /// <summary>Remove stack and nested process details from a user-visible native failure.</summary>
        /// <param name="error">Caught startup error.</param>
        /// <returns>Concrete single-line message.</returns>
        internal static string UserMessage(Exception error)
        {
            string message = error == null ? "本机伴随程序发生未知错误。" : error.Message;
            return message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        }
    }
}
