using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

internal static class Program
{
    private const string Product = "NAI Prompt Studio";
    // Must stay aligned with the Electron executable, taskbar identity and NSIS shortcuts.
    private const string CanonicalApplicationExecutable = "NAI Prompt Studio.exe";
    private const int FooterSize = 96;
    private const string FooterMagic = "NAISETUPV0640000";

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint type);

    [STAThread]
    private static int Main()
    {
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        string payload = null;
        string cacheBase = null;
        string sessionCache = null;
        string originalLauncher = null;
        string relocatedLauncher = null;

        try
        {
            string executableDirectory = Path.GetDirectoryName(executable);
            cacheBase = ResolveNonSystemCache(executableDirectory, File.Exists(Path.ChangeExtension(executable, ".payload")));
            sessionCache = Path.Combine(cacheBase, "session-" + Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(sessionCache);
            ProbeWritable(sessionCache);
            // Set only this launcher's process environment. Accessing
            // ProcessStartInfo.EnvironmentVariables rebuilds the complete
            // block as a case-insensitive dictionary and crashes when a host
            // provides both Path and PATH.
            Environment.SetEnvironmentVariable("TEMP", sessionCache);
            Environment.SetEnvironmentVariable("TMP", sessionCache);
            Environment.SetEnvironmentVariable("TMPDIR", sessionCache);
            Environment.SetEnvironmentVariable("NAI_INSTALLER_CACHE", sessionCache);
            string legacyPayload = Path.ChangeExtension(executable, ".payload");
            if (File.Exists(legacyPayload))
            {
                // Keep the process synchronous for callers, but move its image
                // out of the top-level install directory before NSIS removes
                // application files. The data directory is preserved.
                originalLauncher = executable;
                relocatedLauncher = Path.Combine(sessionCache, "uninstaller-launcher.exe");
                File.Move(originalLauncher, relocatedLauncher);
            }
            if (!File.Exists(legacyPayload))
            {
                string[] commandArguments = Environment.GetCommandLineArgs().Skip(1).ToArray();
                int directoryArgument = Array.FindIndex(commandArguments, argument => argument.StartsWith("_?=", StringComparison.OrdinalIgnoreCase));
                string originalDirectory = directoryArgument >= 0 ? commandArguments[directoryArgument].Substring(3).Trim('"') : null;
                if (directoryArgument >= 0 && directoryArgument + 1 < commandArguments.Length) originalDirectory += " " + string.Join(" ", commandArguments.Skip(directoryArgument + 1).Select(argument => argument.Trim('"')));
                if (string.IsNullOrWhiteSpace(originalDirectory) || !Directory.Exists(originalDirectory))
                {
                    string raw = Environment.CommandLine;
                    int marker = raw.IndexOf("_?=", StringComparison.OrdinalIgnoreCase);
                    if (marker >= 0) originalDirectory = raw.Substring(marker + 3).Trim().Trim('"');
                }
                if (!string.IsNullOrWhiteSpace(originalDirectory)) legacyPayload = Path.Combine(originalDirectory, "Uninstall NAI Prompt Studio.payload");
            }
            if (File.Exists(legacyPayload))
            {
                // Never execute the generated NSIS uninstaller from INSTDIR.
                // Its update path atomically moves that directory, so an image
                // mapped from inside it makes the operation fail with exit 2.
                payload = Path.Combine(sessionCache, "NAI-Prompt-Studio-Uninstaller.exe");
                File.Copy(legacyPayload, payload, true);
            }
            else { payload = Path.Combine(sessionCache, "NAI-Prompt-Studio-Installer.exe"); ExtractVerifiedPayload(executable, payload); }

            var start = new ProcessStartInfo(payload);
            start.UseShellExecute = false;
            start.WorkingDirectory = Path.GetDirectoryName(payload);
            string[] childArguments = Environment.GetCommandLineArgs().Skip(1).ToArray();
            int originalDirectoryArgument = Array.FindIndex(childArguments, argument => argument.StartsWith("_?=", StringComparison.OrdinalIgnoreCase));
            string originalDirectoryArgumentValue = null;
            if (originalDirectoryArgument >= 0)
            {
                originalDirectoryArgumentValue = childArguments[originalDirectoryArgument].Substring(3).Trim('"');
                if (originalDirectoryArgument + 1 < childArguments.Length)
                    originalDirectoryArgumentValue += " " + string.Join(" ", childArguments.Skip(originalDirectoryArgument + 1).Select(argument => argument.Trim('"')));
                childArguments = childArguments.Take(originalDirectoryArgument).ToArray();
            }
            else if (File.Exists(legacyPayload))
            {
                // A directly launched installed uninstaller has no NSIS _?=
                // argument yet. Its verified payload runs from D-local cache,
                // while this value preserves the real installation directory.
                originalDirectoryArgumentValue = Path.GetDirectoryName(executable);
            }
            int installParentArgument = Array.FindIndex(childArguments, argument => argument.StartsWith("/INSTALL_PARENT=", StringComparison.OrdinalIgnoreCase));
            string installDirectoryArgumentValue = null;
            if (installParentArgument >= 0)
            {
                var installParentParts = new System.Collections.Generic.List<string>
                {
                    childArguments[installParentArgument].Substring("/INSTALL_PARENT=".Length).Trim('"')
                };
                int installParentEnd = installParentArgument + 1;
                while (installParentEnd < childArguments.Length &&
                       !childArguments[installParentEnd].StartsWith("/", StringComparison.Ordinal) &&
                       !childArguments[installParentEnd].StartsWith("--", StringComparison.Ordinal))
                {
                    installParentParts.Add(childArguments[installParentEnd].Trim('"'));
                    installParentEnd++;
                }
                string installParent = string.Join(" ", installParentParts);
                if (string.IsNullOrWhiteSpace(installParent))
                    throw new InvalidOperationException("The requested installation parent is empty.");
                installDirectoryArgumentValue = Path.Combine(Path.GetFullPath(installParent), Product);
                childArguments = childArguments.Take(installParentArgument).Concat(childArguments.Skip(installParentEnd)).ToArray();
            }
            foreach (string argument in childArguments)
            {
                // NSIS detects /S and its special final /D= option in the raw
                // command line, where surrounding quotes prevent recognition.
                if (argument.Equals("/S", StringComparison.OrdinalIgnoreCase) || argument.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) start.Arguments += " " + argument;
                else start.Arguments += " \"" + argument.Replace("\"", "\\\"") + "\"";
            }
            // /D= is NSIS' authoritative install-directory override. It must
            // be final and unquoted, even when the value contains spaces.
            if (!string.IsNullOrWhiteSpace(installDirectoryArgumentValue))
                start.Arguments += " /D=" + installDirectoryArgumentValue;
            // NSIS requires _?= to be the final unquoted argument. Electron's
            // update flow may split an installation path containing spaces,
            // so rebuild it once and append it last.
            if (!string.IsNullOrWhiteSpace(originalDirectoryArgumentValue))
            {
                Environment.SetEnvironmentVariable("NAI_INSTALL_DIR", originalDirectoryArgumentValue);
                start.Arguments += " _?=" + originalDirectoryArgumentValue;
            }

            using (Process child = Process.Start(start))
            {
                if (child == null) throw new InvalidOperationException("The installer payload could not be started.");
                child.WaitForExit();
                if (child.ExitCode != 0 && relocatedLauncher != null && originalLauncher != null && !File.Exists(originalLauncher))
                    File.Copy(relocatedLauncher, originalLauncher, true);
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBoxW(IntPtr.Zero,
                error.Message + Environment.NewLine + Environment.NewLine +
                "No system-drive temporary directory was used.",
                Product + " installer", 0x10U);
            return 1;
        }
        finally
        {
            if (relocatedLauncher != null) ScheduleExactSessionCleanup(sessionCache, cacheBase);
            else DeleteExactSession(sessionCache, cacheBase);
        }
    }

    private static void ExtractVerifiedPayload(string executable, string payload)
    {
        long offset; long length; byte[] expected;
        using (var input = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var reader = new BinaryReader(input, Encoding.ASCII, true))
        {
            if (input.Length < FooterSize) throw new InvalidOperationException("The setup package is incomplete.");
            input.Seek(-FooterSize, SeekOrigin.End);
            if (Encoding.ASCII.GetString(reader.ReadBytes(16)) != FooterMagic) throw new InvalidOperationException("The setup footer is invalid.");
            offset = reader.ReadInt64(); length = reader.ReadInt64(); expected = reader.ReadBytes(64);
            if (offset < 1 || length < 1 || offset + length + FooterSize != input.Length) throw new InvalidOperationException("The setup payload boundaries are invalid.");
            input.Seek(offset, SeekOrigin.Begin);
            using (var output = new FileStream(payload, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var sha = SHA512.Create())
            {
                var buffer = new byte[1024 * 1024]; long remaining = length; int read;
                while (remaining > 0 && (read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining))) > 0) { output.Write(buffer, 0, read); sha.TransformBlock(buffer, 0, read, null, 0); remaining -= read; }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                if (remaining != 0 || !sha.Hash.SequenceEqual(expected)) throw new InvalidOperationException("The setup payload failed SHA-512 verification.");
            }
        }
    }

    private static string ResolveNonSystemCache(string launcherDirectory, bool installedUninstaller)
    {
        string systemRoot = NormalizeRoot(Path.GetPathRoot(Environment.SystemDirectory));
        if (installedUninstaller)
            return ValidateCacheBase(Path.Combine(launcherDirectory, ".nai-uninstaller-cache"), systemRoot);
        string requested = Environment.GetEnvironmentVariable("NAI_INSTALLER_TEMP_ROOT");
        if (!string.IsNullOrWhiteSpace(requested))
            return ValidateCacheBase(Path.GetFullPath(requested), systemRoot);

        string launcherRoot = NormalizeRoot(Path.GetPathRoot(launcherDirectory));
        if (!string.Equals(launcherRoot, systemRoot, StringComparison.OrdinalIgnoreCase))
            return ValidateCacheBase(Path.Combine(launcherDirectory, ".nai-installer-cache"), systemRoot);

        foreach (DriveInfo drive in DriveInfo.GetDrives()
                     .Where(item => item.IsReady && item.DriveType == DriveType.Fixed)
                     .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase))
        {
            if (string.Equals(NormalizeRoot(drive.RootDirectory.FullName), systemRoot, StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                return ValidateCacheBase(Path.Combine(drive.RootDirectory.FullName, "NAI-Prompt-Studio-Installer-Cache"), systemRoot);
            }
            catch (Exception)
            {
                // Try the next non-system fixed volume. There is deliberately no system-drive fallback.
            }
        }

        throw new InvalidOperationException("No writable non-system drive is available for installer extraction. Move the setup files to drive D or set NAI_INSTALLER_TEMP_ROOT to a writable folder on a non-system drive.");
    }

    private static string ValidateCacheBase(string candidate, string systemRoot)
    {
        string full = Path.GetFullPath(candidate);
        string root = NormalizeRoot(Path.GetPathRoot(full));
        if (string.Equals(root, systemRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Installer extraction on the system drive is forbidden: " + full);
        Directory.CreateDirectory(full);
        ProbeWritable(full);
        return full;
    }

    private static string NormalizeRoot(string root)
    {
        return (root ?? string.Empty).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static void ProbeWritable(string directory)
    {
        string probe = Path.Combine(directory, ".write-test-" + Guid.NewGuid().ToString("N"));
        File.WriteAllText(probe, "ok");
        File.Delete(probe);
    }

    private static void DeleteExactSession(string sessionCache, string cacheBase)
    {
        if (string.IsNullOrEmpty(sessionCache) || string.IsNullOrEmpty(cacheBase)) return;
        try
        {
            string fullSession = Path.GetFullPath(sessionCache);
            string fullBase = Path.GetFullPath(cacheBase).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!fullSession.StartsWith(fullBase, StringComparison.OrdinalIgnoreCase)) return;
            if (!Path.GetFileName(fullSession).StartsWith("session-", StringComparison.Ordinal)) return;
            if (Directory.Exists(fullSession)) Directory.Delete(fullSession, true);
            if (Directory.Exists(cacheBase) && !Directory.EnumerateFileSystemEntries(cacheBase).Any()) Directory.Delete(cacheBase);
        }
        catch (Exception)
        {
            // Cleanup failure must not overwrite the installer's own result.
        }
    }

    private static void ScheduleExactSessionCleanup(string sessionCache, string cacheBase)
    {
        if (string.IsNullOrEmpty(sessionCache) || string.IsNullOrEmpty(cacheBase)) return;
        try
        {
            string fullSession = Path.GetFullPath(sessionCache);
            string fullBase = Path.GetFullPath(cacheBase).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!fullSession.StartsWith(fullBase, StringComparison.OrdinalIgnoreCase)) return;
            if (!Path.GetFileName(fullSession).StartsWith("session-", StringComparison.Ordinal)) return;
            string fullCache = Path.GetFullPath(cacheBase);
            if (!string.Equals(Path.GetFileName(fullCache), ".nai-uninstaller-cache", StringComparison.OrdinalIgnoreCase)) return;
            DirectoryInfo installParent = Directory.GetParent(fullCache);
            string installDirectory = installParent == null ? null : installParent.FullName;
            if (string.IsNullOrEmpty(installDirectory)) return;
            string commandInterpreter = Environment.GetEnvironmentVariable("ComSpec");
            if (string.IsNullOrWhiteSpace(commandInterpreter)) commandInterpreter = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            string cleanupScript = Path.Combine(Path.GetFullPath(cacheBase), "cleanup-" + Guid.NewGuid().ToString("N") + ".cmd");
            File.WriteAllText(cleanupScript,
                "@echo off\r\n" +
                "ping 127.0.0.1 -n 3 >nul\r\n" +
                "rmdir /s /q \"" + fullSession.Replace("\"", string.Empty) + "\"\r\n" +
                "start \"\" /b cmd /d /s /c \"ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"\"" + fullCache.Replace("\"", string.Empty) + "\"\" & rmdir \"\"" + installDirectory.Replace("\"", string.Empty) + "\"\"\"\r\n" +
                "del /f /q \"%~f0\"\r\n",
                Encoding.ASCII);
            var cleanup = new ProcessStartInfo(commandInterpreter)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(cacheBase)),
                Arguments = "/d /s /c \"\"" + cleanupScript + "\"\""
            };
            Process.Start(cleanup);
        }
        catch (Exception)
        {
            // A stale exact session is safer than deleting an unverified path.
        }
    }
}
