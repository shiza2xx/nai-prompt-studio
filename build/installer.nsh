!macro customInstall
  # The generated uninstaller is also large enough to require an explicit D-temp launcher.
  Delete "$INSTDIR\Uninstall NAI Prompt Studio.payload"
  Rename "$INSTDIR\${UNINSTALL_FILENAME}" "$INSTDIR\Uninstall NAI Prompt Studio.payload"
  File "/oname=$INSTDIR\${UNINSTALL_FILENAME}" "${PROJECT_DIR}\.local-cache\installer-launcher\NAI-Installer-Launcher.exe"
!macroend
