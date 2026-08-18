using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace DeepSeekHarness.BrowserCompanion
{
    /// <summary>The process that claimed the Harness origin before it began serving.</summary>
    public sealed class HarnessAddressHolder
    {
        /// <summary>Gets the process id recorded when the claim was taken.</summary>
        public int Pid { get; private set; }

        /// <summary>Gets the ISO timestamp the holder recorded at claim time.</summary>
        public string StartedAt { get; private set; }

        /// <summary>Gets the command that took the claim, for user-facing identification.</summary>
        public string Command { get; private set; }

        /// <summary>Read a claim record, accepting only the fields this companion relies on.</summary>
        /// <param name="json">Claim file contents written by the Node web app.</param>
        /// <returns>The holder, or null when the record is not a readable claim.</returns>
        public static HarnessAddressHolder Parse(string json)
        {
            Dictionary<string, object> value;
            try
            {
                value = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            }
            catch (Exception)
            {
                // A half-written or foreign file is treated as no claim, matching the
                // Node side, which reclaims a record it cannot read.
                return null;
            }
            if (value == null || !value.ContainsKey("pid"))
            {
                return null;
            }
            int pid;
            try
            {
                pid = Convert.ToInt32(value["pid"], CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return null;
            }
            return new HarnessAddressHolder
            {
                Pid = pid,
                StartedAt = value.ContainsKey("startedAt") ? value["startedAt"] as string : null,
                Command = value.ContainsKey("command") ? value["command"] as string : null
            };
        }

        /// <summary>Describe this holder for a user who must decide which instance to keep.</summary>
        /// <returns>A message naming the process and, when recorded, its start time and command.</returns>
        public string Describe()
        {
            StringBuilder text = new StringBuilder();
            text.Append("进程 ").Append(Pid.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrEmpty(StartedAt))
            {
                text.Append("，启动于 ").Append(StartedAt);
            }
            if (!string.IsNullOrEmpty(Command))
            {
                text.Append("，命令：").Append(Command);
            }
            return text.ToString();
        }
    }

    /// <summary>
    /// Reader for the address claim the Node web app takes before its slow boot.
    ///
    /// The companion's health probe cannot distinguish "nothing is running" from
    /// "an instance is loading its tree and has not bound yet", so on its own it
    /// would launch a duplicate that only fails at listen time. The Node app
    /// records its intent in a claim file the moment it parses its command line;
    /// reading that file turns a doomed launch into either a wait or a message
    /// naming the process that owns the origin.
    ///
    /// The path is a cross-language contract with
    /// `packages/bundle/web-app/src/single-instance.ts`; both sides derive it
    /// from the temp directory, the origin, and the current user name. The
    /// companion launches Node with an inherited environment, so both resolve the
    /// same temp directory. A machine where they disagree simply loses this
    /// early check and falls back to the port conflict Node reports.
    /// </summary>
    public static class HarnessAddressClaim
    {
        /// <summary>Reduce a value to the characters the Node side keeps in a claim file name.</summary>
        /// <param name="value">Host or user name component.</param>
        /// <returns>The component with every other character replaced by a hyphen.</returns>
        private static string FileSafe(string value)
        {
            StringBuilder safe = new StringBuilder(value.Length);
            foreach (char character in value)
            {
                bool keep = (character >= 'A' && character <= 'Z')
                    || (character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')
                    || character == '.' || character == '_' || character == '-';
                safe.Append(keep ? character : '-');
            }
            return safe.ToString();
        }

        /// <summary>Build the claim file path for one origin.</summary>
        /// <param name="origin">Validated Harness origin.</param>
        /// <returns>The absolute claim path for the current user.</returns>
        public static string PathFor(string origin)
        {
            Uri parsed = new Uri(origin, UriKind.Absolute);
            string name = "dsh-web-" + FileSafe(parsed.Host)
                + "-" + parsed.Port.ToString(CultureInfo.InvariantCulture)
                + "-" + FileSafe(Environment.UserName) + ".json";
            return Path.Combine(Path.GetTempPath(), name);
        }

        /// <summary>Return whether a recorded process is still running.</summary>
        /// <param name="pid">Process id recorded in a claim.</param>
        /// <returns>True only while that process exists.</returns>
        private static bool ProcessAlive(int pid)
        {
            if (pid <= 0)
            {
                return false;
            }
            try
            {
                using (Process.GetProcessById(pid))
                {
                    return true;
                }
            }
            catch (ArgumentException)
            {
                return false;
            }
        }

        /// <summary>Read the claim on one origin, ignoring a record its process no longer backs.</summary>
        /// <param name="origin">Validated Harness origin.</param>
        /// <returns>The live holder, or null when the origin is unclaimed or the claim is abandoned.</returns>
        public static HarnessAddressHolder ReadLiveHolder(string origin)
        {
            string path = PathFor(origin);
            string json;
            try
            {
                json = File.ReadAllText(path, Encoding.UTF8);
            }
            catch (FileNotFoundException)
            {
                return null;
            }
            catch (DirectoryNotFoundException)
            {
                return null;
            }
            HarnessAddressHolder holder = HarnessAddressHolder.Parse(json);
            if (holder == null || !ProcessAlive(holder.Pid))
            {
                return null;
            }
            return holder;
        }
    }
}
