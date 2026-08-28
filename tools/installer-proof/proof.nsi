Unicode true
!define NAI_INSTALLER_PROOF
!include "${PROJECT_ROOT}\build\installer.nsh"
Name "NAI D-temp proof"
OutFile "D-temp-proof.payload.exe"
RequestExecutionLevel user
SilentInstall silent
InstallDir "C:\\installer-proof-must-not-use-default"

Section
  ReadEnvStr $1 "NAI_PROOF_INSTALL"
  ${If} $1 != ""
    StrCpy $INSTDIR $1
  ${EndIf}
  Call PreserveLegacyCatalog
  InitPluginsDir
  ReadEnvStr $2 "NAI_PROOF_RESULT"
  FileOpen $0 "$2" w
  FileWrite $0 "TEMP=$TEMP$\r$\n"
  FileWrite $0 "PLUGINSDIR=$PLUGINSDIR$\r$\n"
  ReadEnvStr $1 "NAI_INSTALLER_CACHE"
  FileWrite $0 "NAI_INSTALLER_CACHE=$1$\r$\n"
  FileWrite $0 "CMDLINE=$CMDLINE$\r$\n"
  FileWrite $0 "INSTALL_DIR=$INSTDIR$\r$\n"
  FileClose $0
SectionEnd
