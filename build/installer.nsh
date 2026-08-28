; V0.6 assisted-install policy. The generated NSIS finish page uses Launch by
; default (package.json runAfterFinish). These values are persisted in data so
; an update inherits the user's shortcut choices while customRemoveFiles keeps
; the entire data directory untouched.
; The custom include is emitted before electron-builder's installer template,
; so every standard macro used by the functions below must be available here.
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"

!macro customHeader
!macroend

; Override electron-builder's broad process-name fallback for both install
; and uninstall paths, including silent operation. This must remain top-level:
; NSIS rejects macro declarations nested inside customHeader.
!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    Call un.CloseExactStudioProcess
  !else
    Call CloseExactStudioProcess
    ; Legacy 0.6.2 catalog preservation must finish after the exact process
    ; closes and before electron-builder invokes uninstallOldVersion.
    Call PreserveLegacyCatalog
  !endif
!macroend
!ifdef BUILD_UNINSTALLER
  Var NAIPreserveData
  Var NAIPreserveDataCheckbox
!else
  Var NAIStartMenuShortcut
  Var NAIDesktopShortcut
  Var NAIStartMenuCheckbox
  Var NAIDesktopCheckbox
  Var NAIShortcutPolicyLoaded
  Var NAIShortcutPolicyDirectory
  Var NAICatalogArtists
  Var NAICatalogCharacters
  Var NAICatalogGuide
  Var NAICatalogCheckboxArtists
  Var NAICatalogCheckboxCharacters
  Var NAICatalogCheckboxGuide
  Var NAICatalogOptionsFresh
!endif

!ifndef BUILD_UNINSTALLER
Function LoadNAIShortcutPolicy
  ${If} $NAIShortcutPolicyLoaded == "1"
  ${AndIf} $NAIShortcutPolicyDirectory == "$INSTDIR"
    Return
  ${EndIf}
  ReadINIStr $NAIStartMenuShortcut "$INSTDIR\data\installer-options.ini" "shortcuts" "startMenu"
  ${If} $NAIStartMenuShortcut == ""
    StrCpy $NAIStartMenuShortcut "1"
  ${EndIf}
  ReadINIStr $NAIDesktopShortcut "$INSTDIR\data\installer-options.ini" "shortcuts" "desktop"
  ${If} $NAIDesktopShortcut == ""
    StrCpy $NAIDesktopShortcut "0"
  ${EndIf}
  StrCpy $NAIShortcutPolicyLoaded "1"
  StrCpy $NAIShortcutPolicyDirectory "$INSTDIR"
FunctionEnd

!macro customPageAfterChangeDir
  Page custom NAIShortcutOptionsPage NAIShortcutOptionsLeave
  Page custom NAICatalogOptionsPage NAICatalogOptionsLeave
!macroend

Function NAIShortcutOptionsPage
  ; This page runs after the directory page has finalized $INSTDIR. Read the
  ; retained policy once here, then let its Leave callback own the final vars.
  Call LoadNAIShortcutPolicy
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 20u "Shortcut options"
  Pop $0
  ${NSD_CreateCheckbox} 0 28u 100% 12u "Create Start Menu shortcut"
  Pop $NAIStartMenuCheckbox
  ${NSD_CreateCheckbox} 0 48u 100% 12u "Create Desktop shortcut"
  Pop $NAIDesktopCheckbox
  ${If} $NAIStartMenuShortcut == "1"
    ${NSD_Check} $NAIStartMenuCheckbox
  ${EndIf}
  ${If} $NAIDesktopShortcut == "1"
    ${NSD_Check} $NAIDesktopCheckbox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function NAIShortcutOptionsLeave
  ${NSD_GetState} $NAIStartMenuCheckbox $NAIStartMenuShortcut
  ${NSD_GetState} $NAIDesktopCheckbox $NAIDesktopShortcut
FunctionEnd

Function NAICatalogOptionsPage
  ; Existing profiles retain their choices and do not show this page.
  IfFileExists "$INSTDIR\data\installer-options.ini" catalogOptionsExisting catalogOptionsCheckWorkspace
catalogOptionsCheckWorkspace:
  IfFileExists "$INSTDIR\data\workspace.json" catalogOptionsExisting catalogOptionsCheckCatalog
catalogOptionsCheckCatalog:
  IfFileExists "$INSTDIR\data\catalog\*.*" catalogOptionsExisting catalogOptionsCheckComponents
catalogOptionsCheckComponents:
  IfFileExists "$INSTDIR\data\catalog\components\*.*" catalogOptionsExisting catalogOptionsCheckLegacy
catalogOptionsCheckLegacy:
  IfFileExists "$INSTDIR\data\catalog\legacy\*.*" catalogOptionsExisting catalogOptionsCheckGenerations
catalogOptionsCheckGenerations:
  IfFileExists "$INSTDIR\data\catalog\generations\*.*" catalogOptionsExisting catalogOptionsFresh
catalogOptionsExisting:
  Abort
catalogOptionsFresh:
  StrCpy $NAICatalogOptionsFresh "1"
  StrCpy $NAICatalogArtists "1"
  StrCpy $NAICatalogGuide "1"
  StrCpy $NAICatalogCharacters "0"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 20u "Card libraries"
  Pop $0
  ${NSD_CreateCheckbox} 0 28u 100% 12u "V5 artists"
  Pop $NAICatalogCheckboxArtists
  ${NSD_CreateCheckbox} 0 48u 100% 12u "Prompt Builder references"
  Pop $NAICatalogCheckboxGuide
  ${NSD_CreateCheckbox} 0 68u 100% 12u "V4.5 characters"
  Pop $NAICatalogCheckboxCharacters
  ${NSD_Check} $NAICatalogCheckboxArtists
  ${NSD_Check} $NAICatalogCheckboxGuide
  nsDialogs::Show
FunctionEnd

Function NAICatalogOptionsLeave
  ${NSD_GetState} $NAICatalogCheckboxArtists $NAICatalogArtists
  ${NSD_GetState} $NAICatalogCheckboxGuide $NAICatalogGuide
  ${NSD_GetState} $NAICatalogCheckboxCharacters $NAICatalogCharacters
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnWelcomePage
  UninstPage custom un.NAIPreserveDataPage un.NAIPreserveDataLeave
!macroend

Function un.NAIPreserveDataPage
  StrCpy $NAIPreserveData "1"
  ${If} ${Silent}
    Abort
  ${EndIf}
  ; This function is compiled from the early custom include, before
  ; electron-builder adds the StdUtils plug-in directory. Detect the same
  ; --updated switch directly with FileFunc instead of using the late helper.
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 20u "Local data"
  Pop $0
  ${NSD_CreateCheckbox} 0 28u 100% 24u "Preserve local settings, storage, downloads and custom cards"
  Pop $NAIPreserveDataCheckbox
  ${NSD_Check} $NAIPreserveDataCheckbox
  nsDialogs::Show
FunctionEnd

Function un.NAIPreserveDataLeave
  ${NSD_GetState} $NAIPreserveDataCheckbox $NAIPreserveData
FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
Function PreserveLegacyCatalog
  ; Preserve the v0.6.2 fat archive on the same install volume. A valid
  ; existing preservation is immutable; never replace it during an update.
  IfFileExists "$INSTDIR\data\catalog\legacy\legacy-app.asar" preserveLegacyValidate preserveLegacySource
preserveLegacyValidate:
  ; Do not trust a stale filename alone. A readable fat archive remains
  ; immutable; an undersized or unreadable one falls through to source.
  ; Backtick-delimited NSIS text lets the command contain normal PowerShell
  ; quoting. Paths travel through a process environment slot and are passed
  ; to a param() binding, never interpolated into PowerShell source text.
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_LEGACY", "$INSTDIR\data\catalog\legacy\legacy-app.asar")`
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { param([string]$$legacy) try { if(-not (Test-Path -LiteralPath $$legacy -PathType Leaf)){exit 1}; $$info=Get-Item -LiteralPath $$legacy -ErrorAction Stop; if($$info.Length -lt 268435456){exit 1}; $$stream=[IO.File]::OpenRead($$legacy); $$stream.Dispose(); exit 0 } catch { exit 1 } } $$env:NAI_PRESERVE_LEGACY" `
  Pop $0
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_LEGACY", "")`
  ${If} $0 == 0
    Goto preserveLegacyDone
  ${EndIf}
preserveLegacySource:
  IfFileExists "$INSTDIR\resources\app.asar" preserveLegacySourceExists preserveLegacyDone
preserveLegacySourceExists:
  ; Validate the source before staging it. Runtime performs the complete
  ; representative-root validation after activation. A thin or missing
  ; source is a normal skip for new installs, not a migration failure.
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\data\catalog"
  CreateDirectory "$INSTDIR\data\catalog\legacy"
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_SOURCE", "$INSTDIR\resources\app.asar")`
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_DEST", "$INSTDIR\data\catalog\legacy\legacy-app.asar")`
  ; Windows PowerShell 5 reads SystemRoot during startup. Preserve the
  ; inherited root for fsutil selection while supplying a known-valid root to
  ; the child process; this also makes a missing SystemRoot degrade to copy.
  ReadEnvStr $1 "SystemRoot"
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_SYSTEM_ROOT", "$1")`
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("SystemRoot", "$SYSDIR\..")`
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { param([string]$$src,[string]$$dst) $$ErrorActionPreference=[System.Management.Automation.ActionPreference]::Stop; $$partial=$$null; try { if(-not (Test-Path -LiteralPath $$src -PathType Leaf)){exit 10}; $$info=Get-Item -LiteralPath $$src -ErrorAction Stop; if($$info.Length -lt 268435456){exit 10}; $$stream=[IO.File]::OpenRead($$src); $$stream.Dispose(); $$partial=[string]::Concat($$dst,[char]46,[char]112,[char]97,[char]114,[char]116,[char]105,[char]97,[char]108); Remove-Item -LiteralPath $$partial -Force -ErrorAction SilentlyContinue; $$fsutil=$$null; $$fsutilRoot=$$env:NAI_PRESERVE_SYSTEM_ROOT; if(-not $$fsutilRoot){$$fsutilRoot=$$env:SystemRoot}; $$fsutilExit=1; if($$fsutilRoot){ $$fsutil=Join-Path $$fsutilRoot 'System32\fsutil.exe'; if(Test-Path -LiteralPath $$fsutil -PathType Leaf){ try { & $$fsutil hardlink create $$partial $$src; $$fsutilExit=$$LASTEXITCODE } catch { $$fsutilExit=1 } } }; $$linked=($$fsutilExit -eq 0 -and (Test-Path -LiteralPath $$partial -PathType Leaf)); if(-not $$linked){ Remove-Item -LiteralPath $$partial -Force -ErrorAction SilentlyContinue; Copy-Item -LiteralPath $$src -Destination $$partial -Force -ErrorAction Stop }; $$staged=Get-Item -LiteralPath $$partial -ErrorAction Stop; if($$staged.PSIsContainer -or ($$staged.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw}; $$hashFile={ param([string]$$path) $$sha512=[Security.Cryptography.SHA512]::Create(); $$hashStream=$$null; try { $$hashStream=[IO.File]::OpenRead($$path); return [BitConverter]::ToString($$sha512.ComputeHash($$hashStream)) } finally { if($$hashStream){$$hashStream.Dispose()}; $$sha512.Dispose() } }; $$srcHash=& $$hashFile $$src; $$partialHash=& $$hashFile $$partial; if($$info.Length -ne $$staged.Length -or $$srcHash -cne $$partialHash){throw}; if(Test-Path -LiteralPath $$dst -PathType Leaf){ [IO.File]::Replace($$partial,$$dst,$$null,$$true) } else { [IO.File]::Move($$partial,$$dst) }; exit 0 } catch { if($$partial){Remove-Item -LiteralPath $$partial -Force -ErrorAction SilentlyContinue}; exit 2 } } $$env:NAI_PRESERVE_SOURCE $$env:NAI_PRESERVE_DEST" `
  Pop $0
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("SystemRoot", "$1")`
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_SYSTEM_ROOT", "")`
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_SOURCE", "")`
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_PRESERVE_DEST", "")`
  ${If} $0 == 10
    DetailPrint "Legacy catalog preservation skipped: no fat v0.6.2 archive was found."
    Goto preserveLegacyDone
  ${EndIf}
  ${If} $0 != 0
    DetailPrint "Legacy catalog preservation failed before the previous application was removed (exit code $0)."
!ifndef NAI_INSTALLER_PROOF
    MessageBox MB_ICONSTOP "Cannot preserve the existing V0.6.2 catalog before updating. The old application was not removed; retry after checking the installation folder."
!endif
    Abort
  ${EndIf}
preserveLegacyDone:
FunctionEnd
!endif

!macro CloseExactStudioProcessBody
  ; Match only the canonical installed application image. The launcher and
  ; uninstaller never match this full path, and no broad process-name scan is used.
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_CLOSE_TARGET", "$INSTDIR\NAI Prompt Studio.exe")`
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { param([string]$$target) $$target=[IO.Path]::GetFullPath($$target); $$self=[Diagnostics.Process]::GetCurrentProcess().Id; $$p=@(Get-CimInstance Win32_Process | Where-Object { $$_.ProcessId -ne $$self -and $$_.ExecutablePath -and [IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target }); if(-not $$p.Count){exit 10}; $$closed=$$false; foreach($$x in $$p){try{$$q=[Diagnostics.Process]::GetProcessById($$x.ProcessId);if(-not $$q.HasExited -and $$q.CloseMainWindow()){$$closed=$$true}}catch{}}; Start-Sleep -Milliseconds 900; foreach($$x in $$p){try{$$q=[Diagnostics.Process]::GetProcessById($$x.ProcessId);if(-not $$q.HasExited){$$closed=$$true;$$q.Kill();$$q.WaitForExit(3000)}}catch{}}; if(@(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and [IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target }).Count){exit 2}; if($$closed){exit 11}; exit 10 } $$env:NAI_CLOSE_TARGET" `
  Pop $0
  System::Call `Kernel32::SetEnvironmentVariable(t,t)i("NAI_CLOSE_TARGET", "")`
  ${If} $0 == 2
    MessageBox MB_ICONSTOP "NAI Prompt Studio is still running from this installation. Close it and retry."
    Abort
  ${EndIf}
  ${If} $0 == 11
    DetailPrint "Closed the running NAI Prompt Studio application automatically."
  ${EndIf}
!macroend

!ifdef BUILD_UNINSTALLER
Function un.CloseExactStudioProcess
  !insertmacro CloseExactStudioProcessBody
FunctionEnd
!else
Function CloseExactStudioProcess
  !insertmacro CloseExactStudioProcessBody
FunctionEnd
!endif

!macro customInstall
  ; In silent mode the options page never runs. This is still the one-time
  ; post-directory initialization; an interactive Leave callback has already
  ; marked the same directory as loaded and cannot be overwritten here.
  Call LoadNAIShortcutPolicy
  ClearErrors
  FileOpen $9 "$INSTDIR\.nai-write-test" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "NAI Prompt Studio must be installed in a writable folder because all settings and caches stay beside the application. Choose another location."
    Abort
  ${EndIf}
  FileWrite $9 "ok"
  FileClose $9
  Delete "$INSTDIR\.nai-write-test"
  # The generated uninstaller is also large enough to require an explicit D-temp launcher.
  Delete "$INSTDIR\Uninstall NAI Prompt Studio.payload"
  Rename "$INSTDIR\${UNINSTALL_FILENAME}" "$INSTDIR\Uninstall NAI Prompt Studio.payload"
  File "/oname=$INSTDIR\${UNINSTALL_FILENAME}" "${PROJECT_DIR}\.local-cache\installer-launcher\NAI-Installer-Launcher.exe"
  ; Start Menu is on by default and Desktop is off by default. A prior choice
  ; lives beside user data and is deliberately retained by updates.
  CreateDirectory "$INSTDIR\data"
  WriteINIStr "$INSTDIR\data\installer-options.ini" "shortcuts" "startMenu" "$NAIStartMenuShortcut"
  WriteINIStr "$INSTDIR\data\installer-options.ini" "shortcuts" "desktop" "$NAIDesktopShortcut"
  ${If} $NAICatalogOptionsFresh == "1"
    WriteINIStr "$INSTDIR\data\installer-options.ini" "catalogs" "v5Artists" "$NAICatalogArtists"
    WriteINIStr "$INSTDIR\data\installer-options.ini" "catalogs" "builder" "$NAICatalogGuide"
    WriteINIStr "$INSTDIR\data\installer-options.ini" "catalogs" "v45Characters" "$NAICatalogCharacters"
  ${EndIf}
  ${If} $NAIStartMenuShortcut == "0"
    Delete "$SMPROGRAMS\NAI Prompt Studio.lnk"
  ${EndIf}
  ${If} $NAIDesktopShortcut == "1"
    CreateShortCut "$DESKTOP\NAI Prompt Studio.lnk" "$INSTDIR\NAI Prompt Studio.exe"
    WinShell::SetLnkAUMI "$DESKTOP\NAI Prompt Studio.lnk" "com.novelai.promptstudio"
  ${Else}
    Delete "$DESKTOP\NAI Prompt Studio.lnk"
  ${EndIf}
!macroend

!macro customInit
  ${GetParameters} $0
  ${GetOptions} $0 "/INSTALL_PARENT=" $1
  ${If} $1 != ""
    StrCpy $INSTDIR "$1\NAI Prompt Studio"
  ${EndIf}
  StrCpy $NAIShortcutPolicyLoaded "0"
  StrCpy $NAIShortcutPolicyDirectory ""
  StrCpy $NAICatalogOptionsFresh "0"
!macroend

!macro customUnInit
  # The launcher computes the authoritative install directory before moving
  # itself into app-local temp. This avoids relying only on NSIS' special _?=
  # parsing when the original path contains spaces.
  ReadEnvStr $7 "NAI_INSTALL_DIR"
  ${If} $7 != ""
    StrCpy $INSTDIR "$7"
  ${EndIf}
  StrCpy $NAIPreserveData "1"
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
  ${If} $NAIPreserveData != "1"
    RMDir /r "$INSTDIR\data"
  ${EndIf}
  ${endIf}
!macroend

!macro customRemoveFiles
  # App data lives inside the installation by design. Remove every top-level
  # application entry except data and the exact transient uninstaller cache.
  ; Never use a system-drive temporary location while replacing app files.
  SetOutPath "$INSTDIR\.nai-uninstaller-cache"
  FindFirst $8 $9 "$INSTDIR\*.*"

  removeNext:
    StrCmp $9 "" removeDone
    StrCmp $9 "." removeContinue
    StrCmp $9 ".." removeContinue
    StrCmp $9 "data" removeContinue
    StrCmp $9 ".nai-uninstaller-cache" removeContinue
    IfFileExists "$INSTDIR\$9\*.*" removeDirectory removeFile

  removeDirectory:
    ClearErrors
    RMDir /r "$INSTDIR\$9"
    IfErrors removeFailure removeContinue

  removeFile:
    ClearErrors
    Delete "$INSTDIR\$9"
    IfErrors removeFailure removeContinue

  removeContinue:
    FindNext $8 $9
    Goto removeNext

  removeFailure:
    FindClose $8
    MessageBox MB_ICONSTOP "Cannot remove $INSTDIR\$9. Close the application and retry."
    Abort

  removeDone:
    FindClose $8
    RMDir "$INSTDIR"
!macroend
