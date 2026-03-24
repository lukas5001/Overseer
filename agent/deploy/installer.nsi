; Overseer Agent — Windows Installer (NSIS)
; Builds a setup wizard: Welcome → Server/Token → Install → Finish

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

; ── General ───────────────────────────────────────────────────────────────────

Name "Overseer Agent"
OutFile "..\bin\overseer-agent-setup.exe"
InstallDir "$PROGRAMFILES64\Overseer Agent"
RequestExecutionLevel admin
Unicode True

; ── Variables ─────────────────────────────────────────────────────────────────

Var ServerUrl
Var AgentToken
Var ServerUrlField
Var AgentTokenField
Var ConfigDir

; ── Interface Settings ────────────────────────────────────────────────────────

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Overseer Agent Setup"
!define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert den Overseer Monitoring Agent auf diesem Computer.$\r$\n$\r$\nDer Agent ueberwacht diesen Server und sendet Metriken (CPU, RAM, Festplatte, Services) an Ihren Overseer-Server.$\r$\n$\r$\nSie benoetigen:$\r$\n  - Die Server-URL Ihres Overseer-Servers$\r$\n  - Einen Agent-Token (aus der Overseer-Weboberflaeche)$\r$\n$\r$\nKlicken Sie auf Weiter, um fortzufahren."
!define MUI_FINISHPAGE_TITLE "Installation abgeschlossen"
!define MUI_FINISHPAGE_TEXT "Der Overseer Agent wurde erfolgreich installiert und gestartet.$\r$\n$\r$\nDer Agent laeuft jetzt als Windows-Dienst im Hintergrund und meldet sich automatisch beim Server an.$\r$\n$\r$\nSie koennen den Status in der Overseer-Weboberflaeche pruefen."

; ── Pages ─────────────────────────────────────────────────────────────────────

!insertmacro MUI_PAGE_WELCOME
Page custom ConfigPage ConfigPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ── Language ──────────────────────────────────────────────────────────────────

!insertmacro MUI_LANGUAGE "German"

; ── Config Page (Server URL + Token) ─────────────────────────────────────────

Function ConfigPage
    !insertmacro MUI_HEADER_TEXT "Verbindung konfigurieren" "Geben Sie die Verbindungsdaten fuer Ihren Overseer-Server ein."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
        Abort
    ${EndIf}

    ; Server URL
    ${NSD_CreateLabel} 0 0 100% 14u "Server-URL:"
    Pop $0

    ${NSD_CreateText} 0 16u 100% 14u "https://overseer.dailycrust.it"
    Pop $ServerUrlField

    ${NSD_CreateLabel} 0 36u 100% 10u "Die URL Ihres Overseer-Servers (mit https://)"
    Pop $0
    SetCtlColors $0 888888 transparent

    ; Token
    ${NSD_CreateLabel} 0 60u 100% 14u "Agent-Token:"
    Pop $0

    ${NSD_CreateText} 0 76u 100% 14u ""
    Pop $AgentTokenField

    ${NSD_CreateLabel} 0 96u 100% 20u "Den Token erhalten Sie in der Overseer-Weboberflaeche:$\r$\nHost oeffnen > Agent einrichten > Token kopieren"
    Pop $0
    SetCtlColors $0 888888 transparent

    nsDialogs::Show
FunctionEnd

Function ConfigPageLeave
    ${NSD_GetText} $ServerUrlField $ServerUrl
    ${NSD_GetText} $AgentTokenField $AgentToken

    ; Validate server URL
    ${If} $ServerUrl == ""
        MessageBox MB_ICONEXCLAMATION|MB_OK "Bitte geben Sie die Server-URL ein."
        Abort
    ${EndIf}

    ; Check URL starts with https://
    StrCpy $0 $ServerUrl 8
    ${If} $0 != "https://"
        StrCpy $0 $ServerUrl 7
        ${If} $0 != "http://"
            MessageBox MB_ICONEXCLAMATION|MB_OK "Die Server-URL muss mit https:// beginnen."
            Abort
        ${EndIf}
    ${EndIf}

    ; Validate token
    ${If} $AgentToken == ""
        MessageBox MB_ICONEXCLAMATION|MB_OK "Bitte geben Sie den Agent-Token ein."
        Abort
    ${EndIf}

    ; Check token format
    StrCpy $0 $AgentToken 15
    ${If} $0 != "overseer_agent_"
        MessageBox MB_ICONQUESTION|MB_YESNO "Der Token beginnt nicht mit 'overseer_agent_'. Trotzdem fortfahren?" IDYES +2
        Abort
    ${EndIf}
FunctionEnd

; ── Install Section ───────────────────────────────────────────────────────────

Section "Overseer Agent" SecAgent
    SectionIn RO ; mandatory

    ; Use C:\ProgramData for config (SetShellVarContext all makes $APPDATA = ProgramData)
    SetShellVarContext all
    StrCpy $ConfigDir "$APPDATA\Overseer\Agent"

    ; Stop existing service (ignore errors)
    DetailPrint "Stoppe vorhandenen Service (falls vorhanden)..."
    nsExec::ExecToLog 'net stop OverseerAgent'

    ; Remove existing service (ignore errors)
    nsExec::ExecToLog '"$INSTDIR\overseer-agent.exe" uninstall'

    ; Copy binary
    SetOutPath $INSTDIR
    DetailPrint "Kopiere Agent-Binary..."
    File "..\bin\overseer-agent.exe"

    ; Create config directory
    DetailPrint "Erstelle Konfiguration..."
    CreateDirectory $ConfigDir

    ; Write config file
    FileOpen $0 "$ConfigDir\config.yaml" w
    FileWrite $0 "# Overseer Agent Configuration$\r$\n"
    FileWrite $0 "server: $\"$ServerUrl$\"$\r$\n"
    FileWrite $0 "token: $\"$AgentToken$\"$\r$\n"
    FileWrite $0 "log_level: $\"info$\"$\r$\n"
    FileClose $0
    DetailPrint "Config geschrieben: $ConfigDir\config.yaml"

    ; Register Windows service
    DetailPrint "Registriere Windows-Dienst..."
    nsExec::ExecToLog '"$INSTDIR\overseer-agent.exe" install --config "$ConfigDir\config.yaml"'
    Pop $0
    ${If} $0 != 0
        DetailPrint "Warnung: Service-Registrierung meldete Code $0"
    ${EndIf}

    ; Start service
    DetailPrint "Starte Overseer Agent..."
    nsExec::ExecToLog 'net start OverseerAgent'
    Pop $0
    ${If} $0 != 0
        DetailPrint "Warnung: Service konnte nicht gestartet werden (Code $0)"
        DetailPrint "Bitte pruefen Sie die Config und starten Sie manuell: net start OverseerAgent"
    ${Else}
        DetailPrint "Overseer Agent laeuft!"
    ${EndIf}

    ; Create uninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"

    ; Add to Programs and Features (Add/Remove Programs)
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "DisplayName" "Overseer Agent"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "DisplayVersion" "1.0.0"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "Publisher" "Overseer"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "UninstallString" '"$INSTDIR\uninstall.exe"'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "InstallLocation" "$INSTDIR"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "NoRepair" 1

    ; Get installed size
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent" "EstimatedSize" $0

SectionEnd

; ── Uninstall Section ─────────────────────────────────────────────────────────

Section "Uninstall"
    ; Stop and remove service
    DetailPrint "Stoppe und entferne Service..."
    nsExec::ExecToLog 'net stop OverseerAgent'
    nsExec::ExecToLog '"$INSTDIR\overseer-agent.exe" uninstall'

    ; Wait for service to fully stop
    Sleep 2000

    ; Remove files
    Delete "$INSTDIR\overseer-agent.exe"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"

    ; Remove config (ask user)
    SetShellVarContext all
    MessageBox MB_YESNO "Soll die Konfiguration (Token, Server-URL) ebenfalls geloescht werden?" IDNO skip_config
        Delete "$APPDATA\Overseer\Agent\config.yaml"
        RMDir "$APPDATA\Overseer\Agent"
        RMDir "$APPDATA\Overseer"
    skip_config:

    ; Remove registry
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OverseerAgent"
SectionEnd
