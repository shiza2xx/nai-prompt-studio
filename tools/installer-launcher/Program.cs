using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

internal static class Program
{
    private const string Product = "NAI Prompt Studio";

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint type);

    [STAThread]
    private static int Main()
    {
        string executable = Process.GetCurrentProcess().MainModule.FileName;
        string payload = Path.ChangeExtension(executable, ".payload");
        string cacheBase = null;
        string sessionCache = null;

        try
        {
            if (!File.Exists(payload))
                throw new InvalidOperationException("The installer payload is missing. Keep the .exe and .payload files together.");

            cacheBase = ResolveNonSystemCache(Path.GetDirectoryName(executable));
            sessionCache = Path.Combine(cacheBase, "session-" + Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(sessionCache);
            ProbeWritable(sessionCache);

            var start = new ProcessStartInfo(payload);
            start.UseShellExecute = false;
            start.WorkingDirectory = Path.GetDirectoryName(payload);
            start.EnvironmentVariables["TEMP"] = sessionCache;
            start.EnvironmentVariables["TMP"] = sessionCache;
            start.EnvironmentVariables["TMPDIR"] = sessionCache;
            start.EnvironmentVariables["NAI_INSTALLER_CACHE"] = sessionCache;

            using (Process child = Process.Start(start))
            {
                if (child == null) throw new InvalidOperationException("The installer payload could not be started.");
                child.WaitForExit();
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
            DeleteExactSession(sessionCache, cacheBase);
        }
    }

    private static string ResolveNonSystemCache(string launcherDirectory)
    {
        string systemRoot = NormalizeRoot(Path.GetPathRoot(Environment.SystemDirectory));
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
}
