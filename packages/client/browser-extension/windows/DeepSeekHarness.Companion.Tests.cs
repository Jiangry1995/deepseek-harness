using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using DeepSeekHarness.BrowserCompanion;

/// <summary>Dependency-free executable tests for the Windows companion wire and security rules.</summary>
public static class CompanionTests
{
    private static int failures;

    /// <summary>Run every focused companion test and return a process status.</summary>
    /// <param name="arguments">Unused test-runner arguments.</param>
    /// <returns>Zero when every assertion passes.</returns>
    public static int Main(string[] arguments)
    {
        Run("native framing preserves multibyte JSON", NativeFramingPreservesMultibyteJson);
        Run("native framing rejects oversized messages", NativeFramingRejectsOversizedMessages);
        Run("request parser admits only ensure-web", RequestParserAdmitsOnlyEnsureWeb);
        Run("configuration admits only the fixed loopback origin", ConfigurationAdmitsOnlyFixedLoopbackOrigin);
        Run("command line separates tray and Chrome invocation", CommandLineSeparatesTrayAndChromeInvocation);
        Run("responses keep the closed response fields", ResponsesKeepClosedFields);
        Run("external healthy services are never destructively controlled", ExternalServicesAreNeverDestructivelyControlled);
        Run("native recovery starts only the fixed login task", NativeRecoveryStartsOnlyFixedLoginTask);
        Run("address claim matches the Node contract", AddressClaimMatchesTheNodeContract);
        Console.WriteLine(failures == 0 ? "Companion tests: 9 passed" : "Companion tests: " + failures + " failed");
        return failures == 0 ? 0 : 1;
    }

    /// <summary>Run one test while allowing the remaining assertions to report.</summary>
    /// <param name="name">Human-readable behavior name.</param>
    /// <param name="test">Test body.</param>
    private static void Run(string name, Action test)
    {
        try
        {
            test();
            Console.WriteLine("PASS " + name);
        }
        catch (Exception error)
        {
            failures++;
            Console.Error.WriteLine("FAIL " + name + ": " + error.GetType().Name + ": " + error.Message);
        }
    }

    /// <summary>Assert one equality relation with a concrete failure.</summary>
    /// <typeparam name="T">Comparable value type.</typeparam>
    /// <param name="expected">Expected value.</param>
    /// <param name="actual">Observed value.</param>
    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException("expected " + expected + ", received " + actual);
        }
    }

    /// <summary>Assert that an action throws the requested exception type.</summary>
    /// <typeparam name="TException">Required exception type.</typeparam>
    /// <param name="action">Action expected to fail.</param>
    private static void Throws<TException>(Action action) where TException : Exception
    {
        try
        {
            action();
        }
        catch (TException)
        {
            return;
        }
        throw new InvalidOperationException("expected " + typeof(TException).Name);
    }

    /// <summary>Verify framing counts UTF-8 bytes rather than UTF-16 characters.</summary>
    private static void NativeFramingPreservesMultibyteJson()
    {
        using (MemoryStream stream = new MemoryStream())
        {
            const string json = "{\"message\":\"你好 Harness\"}";
            NativeMessageProtocol.WriteJson(stream, json);
            Equal(Encoding.UTF8.GetByteCount(json), BitConverter.ToInt32(stream.ToArray(), 0));
            stream.Position = 0;
            Equal(json, NativeMessageProtocol.ReadJson(stream));
        }
    }

    /// <summary>Verify the host refuses attacker-controlled allocation sizes.</summary>
    private static void NativeFramingRejectsOversizedMessages()
    {
        byte[] prefix = BitConverter.GetBytes(1024 * 1024 + 1);
        using (MemoryStream stream = new MemoryStream(prefix))
        {
            Throws<InvalidDataException>(() => NativeMessageProtocol.ReadJson(stream));
        }
    }

    /// <summary>Verify arbitrary native commands and extra fields are rejected.</summary>
    private static void RequestParserAdmitsOnlyEnsureWeb()
    {
        CompanionRequest request = CompanionRequest.Parse("{\"kind\":\"ensure-web\",\"origin\":\"http://127.0.0.1:3080\"}");
        Equal("http://127.0.0.1:3080", request.Origin);
        Throws<InvalidDataException>(() => CompanionRequest.Parse("{\"kind\":\"run\",\"command\":\"whoami\"}"));
        Throws<InvalidDataException>(() => CompanionRequest.Parse("{\"kind\":\"ensure-web\",\"origin\":\"http://127.0.0.1:3080\",\"extra\":true}"));
    }

    /// <summary>Verify configuration cannot redirect startup to another host or port.</summary>
    private static void ConfigurationAdmitsOnlyFixedLoopbackOrigin()
    {
        Equal("http://127.0.0.1:3080", CompanionConfigurationPolicy.ValidateOrigin("http://127.0.0.1:3080"));
        Throws<InvalidDataException>(() => CompanionConfigurationPolicy.ValidateOrigin("http://localhost:4310"));
        Throws<InvalidDataException>(() => CompanionConfigurationPolicy.ValidateOrigin("https://127.0.0.1:3080"));
        Equal("chrome-extension://gjkldbgjbgjendihekikhjkilimfaikb/", CompanionConfigurationPolicy.ValidateExtensionOrigin("chrome-extension://gjkldbgjbgjendihekikhjkilimfaikb/"));
    }

    /// <summary>Verify only the installed tray and Chrome invocation forms are accepted.</summary>
    private static void CommandLineSeparatesTrayAndChromeInvocation()
    {
        CompanionCommandLine tray = CompanionCommandLine.Parse(new[] { "--tray", "--start-service" });
        Equal(CompanionMode.Tray, tray.Mode);
        Equal(true, tray.StartService);
        CompanionCommandLine native = CompanionCommandLine.Parse(new[] { "chrome-extension://gjkldbgjbgjendihekikhjkilimfaikb/", "--parent-window=0" });
        Equal(CompanionMode.NativeHost, native.Mode);
        Equal("chrome-extension://gjkldbgjbgjendihekikhjkilimfaikb/", native.CallerOrigin);
        Equal(CompanionMode.Invalid, CompanionCommandLine.Parse(new[] { "--run", "anything" }).Mode);
    }

    /// <summary>Verify responses serialize only the extension's accepted fields.</summary>
    private static void ResponsesKeepClosedFields()
    {
        Equal("{\"ok\":true,\"state\":\"started\",\"origin\":\"http://127.0.0.1:3080\"}", CompanionResponse.Success("started", "http://127.0.0.1:3080"));
        Equal("{\"ok\":false,\"error\":\"failed\"}", CompanionResponse.Failure("failed"));
        Throws<InvalidDataException>(() => CompanionResponse.Success("unknown", "http://127.0.0.1:3080"));
    }

    /// <summary>Verify a healthy server without an owned process is read-only.</summary>
    private static void ExternalServicesAreNeverDestructivelyControlled()
    {
        Equal(false, ServiceOwnershipPolicy.CanStopOrRestart(true, false));
        Equal(true, ServiceOwnershipPolicy.CanStopOrRestart(true, true));
        Equal(true, ServiceOwnershipPolicy.CanStopOrRestart(false, true));
        Equal(false, ServiceOwnershipPolicy.CanStopOrRestart(false, false));
    }

    /// <summary>Verify native recovery cannot launch an arbitrary executable or task name.</summary>
    private static void NativeRecoveryStartsOnlyFixedLoginTask()
    {
        System.Diagnostics.ProcessStartInfo info = TrayTaskLauncher.CreateStartInfo("C:\\Windows");
        Equal("C:\\Windows\\System32\\schtasks.exe", info.FileName);
        Equal("/Run /TN \"DeepSeek Harness Browser Companion\"", info.Arguments);
        Equal(false, info.UseShellExecute);
        Equal(true, info.CreateNoWindow);
    }

    /// <summary>
    /// Verify the address-claim contract this companion shares with the Node web
    /// app: the file it looks for, and the record fields it reads from it. A
    /// silent drift here would restore duplicate launches rather than fail loudly.
    /// </summary>
    private static void AddressClaimMatchesTheNodeContract()
    {
        string path = HarnessAddressClaim.PathFor("http://127.0.0.1:3080");
        Equal(Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar), Path.GetDirectoryName(path));
        Equal(true, Path.GetFileName(path).StartsWith("dsh-web-127.0.0.1-3080-", StringComparison.Ordinal));
        Equal(".json", Path.GetExtension(path));

        HarnessAddressHolder holder = HarnessAddressHolder.Parse("{\"pid\":4242,\"host\":\"127.0.0.1\",\"port\":3080,\"startedAt\":\"2026-08-15T00:00:00.000Z\",\"command\":\"apps/cli/src/bin.ts --profile web\"}");
        Equal(4242, holder.Pid);
        Equal("2026-08-15T00:00:00.000Z", holder.StartedAt);
        Equal("进程 4242，启动于 2026-08-15T00:00:00.000Z，命令：apps/cli/src/bin.ts --profile web", holder.Describe());

        Equal(null, HarnessAddressHolder.Parse("half-written {"));
        Equal(null, HarnessAddressHolder.Parse("{\"host\":\"127.0.0.1\"}"));
    }
}
