Unicode true
Name "NAI D-temp proof"
OutFile "D-temp-proof.payload"
RequestExecutionLevel user
SilentInstall silent

Section
  InitPluginsDir
  FileOpen $0 "$EXEDIR\proof-result.txt" w
  FileWrite $0 "TEMP=$TEMP$\r$\n"
  FileWrite $0 "PLUGINSDIR=$PLUGINSDIR$\r$\n"
  ReadEnvStr $1 "NAI_INSTALLER_CACHE"
  FileWrite $0 "NAI_INSTALLER_CACHE=$1$\r$\n"
  FileClose $0
SectionEnd
