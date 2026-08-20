; Default shipping format is the zip 绿色包. This hook only runs if someone
; explicitly builds `--win nsis`.
!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\uninstall-companion.ps1"'
!macroend
