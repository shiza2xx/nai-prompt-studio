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

!macro CloseExactStudioProcessBody
  ; Match only the canonical installed application image. The launcher and
  ; uninstaller never match this full path, and no broad process-name scan is used.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$target=[IO.Path]::GetFullPath(''$INSTDIR\NAI Prompt Studio.exe''); $$self=[Diagnostics.Process]::GetCurrentProcess().Id; $$p=@(Get-CimInstance Win32_Process | Where-Object { $$_.ProcessId -ne $$self -and $$_.ExecutablePath -and [IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target }); if(!$$p.Count){exit 10}; $$closed=$$false; foreach($$x in $$p){try{$$q=[Diagnostics.Process]::GetProcessById($$x.ProcessId);if(!$$q.HasExited -and $$q.CloseMainWindow()){$$closed=$$true}}catch{}}; Start-Sleep -Milliseconds 900; foreach($$x in $$p){try{$$q=[Diagnostics.Process]::GetProcessById($$x.ProcessId);if(!$$q.HasExited){$$closed=$$true;$$q.Kill();$$q.WaitForExit(3000)}}catch{}}; if(@(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and [IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target }).Count){exit 2}; if($$closed){exit 11}; exit 10"'
  Pop $0
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
