!macro customInstall
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
!macroend

!macro customInit
  ${GetParameters} $0
  ${GetOptions} $0 "/INSTALL_PARENT=" $1
  ${If} $1 != ""
    StrCpy $INSTDIR "$1\NAI Prompt Studio"
  ${EndIf}
!macroend

!macro customUnInit
  # The launcher computes the authoritative install directory before moving
  # itself into app-local temp. This avoids relying only on NSIS' special _?=
  # parsing when the original path contains spaces.
  ReadEnvStr $7 "NAI_INSTALL_DIR"
  ${If} $7 != ""
    StrCpy $INSTDIR "$7"
  ${EndIf}
!macroend

!macro customUnInstall
  IfSilent keepData
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_DEFBUTTON2 "Remove settings, custom cards, catalogs and caches in $INSTDIR\data?" IDNO keepData
    RMDir /r "$INSTDIR\data"
    keepData:
  ${endIf}
!macroend

!macro customRemoveFiles
  # App data lives inside the installation by design. Remove every top-level
  # application entry except data, so an updater may itself run from
  # data\updates without locking a directory that has to be renamed.
  SetOutPath $TEMP
  FindFirst $8 $9 "$INSTDIR\*.*"

  removeNext:
    StrCmp $9 "" removeDone
    StrCmp $9 "." removeContinue
    StrCmp $9 ".." removeContinue
    StrCmp $9 "data" removeContinue
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
