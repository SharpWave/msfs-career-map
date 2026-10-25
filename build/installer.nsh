; MSFS Career Map — the NSIS include: electron-builder's hooks (m3 contract §4.1, §4.3, §4.4;
; distribution-design, Installer and Uninstaller). The steps they call are in installer-steps.nsh,
; which the include's tests (`npm run test:installer`) build into programs of their own.
;
; electron-builder 26.18.0 includes this file in the header of both of its compiles — the uninstaller
; (BUILD_UNINSTALLER defined) and then the installer — before its own templates, and inserts each
; hook where its templates test for it. makensis runs with -WX: a function or variable a compile does
; not use fails the build, so each compile defines only its own steps and variables.
;
; @spec DESK-DIST-INST-003, DESK-DIST-INST-004, DESK-DIST-INST-005, DESK-DIST-INST-007
; @spec DESK-DIST-INST-009, DESK-DIST-INST-010, DESK-DIST-INST-011, DESK-DIST-INST-012
; @spec DESK-DIST-INST-013, DESK-DIST-INST-014, DESK-DIST-INST-015, DESK-DIST-INST-016
; @spec DESK-DIST-INST-018, DESK-DIST-INST-019, DESK-DIST-INST-022, DESK-DIST-INST-024
; @spec DESK-DIST-INST-025, DESK-DIST-INST-026, DESK-DIST-INST-027, DESK-DIST-INST-029
; @spec DESK-DIST-UNINST-001, DESK-DIST-UNINST-002, DESK-DIST-UNINST-003, DESK-DIST-UNINST-005
; @spec DESK-DIST-UNINST-006, DESK-DIST-UNINST-008, DESK-DIST-UNINST-009, DESK-DIST-UNINST-010
; @spec DESK-DIST-UNINST-013, DESK-DIST-UNINST-014, DESK-DIST-UNINST-015

!include "${BUILD_RESOURCES_DIR}\installer-steps.nsh"

; The install folder, electron-updater's download folder and the install-under-way mark in it
; (always the current user's: the installer and uninstaller never run for all users).
!define CAREER_MAP_INSTALL_FOLDER "$LOCALAPPDATA\Programs\MSFS Career Map"
!define CAREER_MAP_PROGRAM "$LOCALAPPDATA\Programs\MSFS Career Map\MSFS Career Map.exe"
!define CAREER_MAP_DOWNLOADS "$LOCALAPPDATA\msfs-career-map-updater"
!define CAREER_MAP_MARK "$LOCALAPPDATA\msfs-career-map-updater\install-under-way"
!define CAREER_MAP_DESKTOP_LINK "$DESKTOP\MSFS Career Map.lnk"
!define CAREER_MAP_QUIT_WAIT_MS 90000
!define CAREER_MAP_UNREGISTER_WAIT_MS 30000
!define CAREER_MAP_SESSION_END_REASON "Installing an update to MSFS Career Map"

; The hooks' variables, declared here — before electron-builder's templates declare the pages, whose
; functions use them — and only in the compile that uses them.
!ifdef BUILD_UNINSTALLER
  Var careerMapUpdated      ; 1: run with --updated by an install over the installed copy
  Var careerMapUnResult     ; --unregister's result
  Var careerMapUnText       ; the last page's text
!else
  Var careerMapOver         ; 1: an install over an installed copy, 0: a first install
  Var careerMapMarkPending  ; 1: the install-under-way mark is written and not yet taken up
  Var careerMapInstalled    ; 1: the install section ran to its end
!endif

!ifdef BUILD_UNINSTALLER
  !insertmacro CAREER_MAP_STEP FindRunning "un."
  !insertmacro CAREER_MAP_STEP CloseRunning "un."
  !insertmacro CAREER_MAP_STEP RunUnregister "un."
  !insertmacro CAREER_MAP_STEP UnregisterText "un."
!else
  !insertmacro CAREER_MAP_STEP FolderRefused ""
  !insertmacro CAREER_MAP_STEP FindRunning ""
  !insertmacro CAREER_MAP_STEP CloseRunning ""
  !insertmacro CAREER_MAP_STEP MarkInstall ""
  !insertmacro CAREER_MAP_STEP TakeUpMark ""
  !insertmacro CAREER_MAP_STEP HoldSessionEnd ""
  !insertmacro CAREER_MAP_STEP ReleaseSessionEnd ""
!endif

; ---------------------------------------------------------------------------------------------
; Both compiles

; Inserted after the pages are declared: the Finished pages' functions, which use MUI's page variables.
!macro customHeader
  !ifdef BUILD_UNINSTALLER
    ; The last page's text can run longer than MUI's label holds: it is shown in a read-only text box
    ; in the label's place, reaching to the foot of the page and scrolling.
    Function un.careerMapUnFinishShow
      Push $0
      Push $1
      Push $2
      Push $3
      Push $4
      Push $5
      System::Alloc 16
      Pop $0
      System::Call "user32::GetWindowRect(p $mui.FinishPage.Text, p r0) i"
      System::Call "user32::MapWindowPoints(p 0, p $mui.FinishPage, p r0, i 2) i"
      System::Call "*$0(i .r1, i .r2, i .r3, i .r4)"
      System::Call "user32::GetClientRect(p $mui.FinishPage, p r0) i"
      System::Call "*$0(i .r5, i .r5, i .r5, i .r4)"
      System::Free $0
      IntOp $3 $3 - $1
      IntOp $4 $4 - $2
      IntOp $4 $4 - 12
      IntOp $5 ${WS_CHILD} | ${WS_VISIBLE}
      IntOp $5 $5 | ${WS_VSCROLL}
      IntOp $5 $5 | ${ES_MULTILINE}
      IntOp $5 $5 | ${ES_READONLY}
      nsDialogs::CreateControl EDIT $5 0 $1 $2 $3 $4 "$careerMapUnText"
      Pop $0
      ${If} $0 <> 0
      ${AndIf} $0 != "error"
        SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"
        ShowWindow $mui.FinishPage.Text ${SW_HIDE}
      ${EndIf}
      Pop $5
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd
  !else
    ; The Finished page over an installed copy: no shortcut box (DESK-DIST-INST-018).
    Function careerMapFinishShow
      ${If} $careerMapOver = 1
        SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} ${BST_UNCHECKED} 0
        ShowWindow $mui.FinishPage.ShowReadme ${SW_HIDE}
      ${EndIf}
    FunctionEnd

    ; Leaving the Finished page (DESK-DIST-INST-005, 019, 026). Runs before MUI's own box handling,
    ; whose functions do nothing.
    Function careerMapFinishLeave
      Push $0
      Push $1
      Push $2
      SendMessage $mui.FinishPage.Run ${BM_GETCHECK} 0 0 $0
      ${If} $0 = ${BST_CHECKED}
        StrCpy $0 1
      ${Else}
        StrCpy $0 0
      ${EndIf}
      ${If} $careerMapOver = 1
        ${CareerMapTakeUpMark} $1 "${CAREER_MAP_MARK}"
        StrCpy $careerMapMarkPending 0
        ${CareerMapChooseStart} $2 "$1" "$0"
        ${CareerMapStartApp} "$appExe" "$2"
      ${Else}
        SendMessage $mui.FinishPage.ShowReadme ${BM_GETCHECK} 0 0 $1
        ${If} $1 = ${BST_CHECKED}
          !insertmacro careerMapDesktopShortcut
        ${EndIf}
        ${If} $0 = 1
          ${CareerMapStartApp} "$appExe" "window"
        ${EndIf}
      ${EndIf}
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    Function careerMapFinishBox
    FunctionEnd

    ; A mark not taken up when the wizard closes or the install fails — the install went no further —
    ; is taken up all the same, starting nothing, so no later installer inherits what it asked.
    Function .onGUIEnd
      !insertmacro careerMapTakeUpLeftMark
    FunctionEnd

    Function .onInstFailed
      !insertmacro careerMapTakeUpLeftMark
    FunctionEnd
  !endif
!macroend

!macro careerMapTakeUpLeftMark
  ${If} $careerMapMarkPending = 1
    Push $0
    ${CareerMapTakeUpMark} $0 "${CAREER_MAP_MARK}"
    StrCpy $careerMapMarkPending 0
    Pop $0
  ${EndIf}
!macroend

; electron-builder's install-mode page is skipped: always the current user (DESK-DIST-INST-003).
; electron-builder 26.18.0 tests `!ifmacrodef customInstallmode` and inserts `customInstallMode`;
; NSIS macro names ignore case (makensis 3.0.4.1 finds one by the other), so one macro serves both,
; and the second is defined only should a makensis ever tell them apart.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
!ifmacrondef customInstallmode
  !macro customInstallmode
    StrCpy $isForceCurrentInstall "1"
  !macroend
!endif

; Closing a running copy (§4.3; DESK-DIST-INST-011..016, 022, 029; DESK-DIST-UNINST-001), in place of
; electron-builder's own check: the installer's install section, the uninstaller's
; un.checkAppRunning (un.onInit when silent, the uninstall section with the wizard).
!macro customCheckAppRunning
  Push $0
  Push $1
  ${CareerMapFindRunning} $0 "${CAREER_MAP_INSTALL_FOLDER}"
  ${If} $0 > 0
  ${AndIfNot} ${Silent}
    !ifdef __UNINSTALL__
      ${If} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONINFORMATION "MSFS Career Map will be closed." IDCANCEL`
        SetErrorLevel 1
        Quit
      ${EndIf}
    !else
      ${If} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONINFORMATION "MSFS Career Map will be closed to install. It records nothing until it starts again." IDCANCEL`
        SetErrorLevel 1
        Quit
      ${EndIf}
    !endif
  ${EndIf}
  !ifndef __UNINSTALL__
    ${If} $careerMapOver = 1
      System::Call "kernel32::GetCurrentProcessId() i .r1"
      ${CareerMapMarkInstall} "${CAREER_MAP_MARK}" "${CAREER_MAP_DOWNLOADS}" "$1" "$EXEPATH"
      StrCpy $careerMapMarkPending 1
      ${CareerMapHoldSessionEnd} "${CAREER_MAP_SESSION_END_REASON}"
    ${EndIf}
  !endif
  ${If} $0 > 0
    ${CareerMapCloseRunning} $1 "${CAREER_MAP_INSTALL_FOLDER}" "${CAREER_MAP_PROGRAM}" ${CAREER_MAP_QUIT_WAIT_MS}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

; ---------------------------------------------------------------------------------------------
; The installer

; .onInit, after electron-builder's initMultiUser (DESK-DIST-INST-009, 010).
!macro customInit
  StrCpy $careerMapMarkPending 0
  StrCpy $careerMapInstalled 0
  Push $0
  Push $1
  !insertmacro GetDParameter $0
  ${CareerMapFolderRefused} $1 "$0" "${CAREER_MAP_INSTALL_FOLDER}"
  ${If} $1 = 1
    ; electron-builder's .onInit has already made the folder given (SetOutPath $INSTDIR) before any hook
    ; runs: leave it, then take it away again while it is empty.
    SetOutPath $TEMP
    RMDir "$0"
    MessageBox MB_OK|MB_ICONSTOP "MSFS Career Map installs only in ${CAREER_MAP_INSTALL_FOLDER}." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  Pop $1
  Pop $0
  StrCpy $INSTDIR "${CAREER_MAP_INSTALL_FOLDER}"
  ; Over an installed copy when electron-builder's install key names an install location.
  ReadRegStr $careerMapOver HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $careerMapOver == ""
    StrCpy $careerMapOver 0
  ${Else}
    StrCpy $careerMapOver 1
  ${EndIf}
  ClearErrors
!macroend

; The desktop shortcut, carrying the AppUserModelID as electron-builder's Start-menu entry does.
!macro careerMapDesktopShortcut
  !ifdef APP_DESCRIPTION
    CreateShortCut "${CAREER_MAP_DESKTOP_LINK}" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  !else
    CreateShortCut "${CAREER_MAP_DESKTOP_LINK}" "$appExe" "" "$appExe" 0
  !endif
  ClearErrors
  WinShell::SetLnkAUMI "${CAREER_MAP_DESKTOP_LINK}" "${APP_ID}"
  System::Call "shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)"
!macroend

; The end of the install section (DESK-DIST-INST-007, 024, 026, 027).
!macro customInstall
  StrCpy $careerMapInstalled 1
  ${If} ${Silent}
    ${If} $careerMapOver = 1
      Push $0
      ${CareerMapTakeUpMark} $0 "${CAREER_MAP_MARK}"
      StrCpy $careerMapMarkPending 0
      ${CareerMapStartApp} "$appExe" "$0"
      Pop $0
    ${Else}
      !insertmacro careerMapDesktopShortcut
    ${EndIf}
  ${EndIf}
  ${CareerMapReleaseSessionEnd}
!macroend

; The Finished page (DESK-DIST-INST-004, 005, 018, 019, 026): "Launch MSFS Career Map now", ticked,
; and on a first install "Create a desktop shortcut", ticked (MUI's show-readme box). Its functions are
; in customHeader, inserted after this page.
!macro customFinishPage
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Launch MSFS Career Map now"
  !define MUI_FINISHPAGE_RUN_FUNCTION careerMapFinishBox
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION careerMapFinishBox
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW careerMapFinishShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE careerMapFinishLeave
  !insertmacro MUI_PAGE_FINISH
!macroend

; ---------------------------------------------------------------------------------------------
; The uninstaller

; un.onInit, after initMultiUser (DESK-DIST-UNINST-015). electron-builder's own flag test reads
; --updated and clobbers $R9.
!macro customUnInit
  Push $R9
  ${If} ${isUpdated}
    StrCpy $careerMapUpdated 1
  ${Else}
    StrCpy $careerMapUpdated 0
  ${EndIf}
  Pop $R9
  StrCpy $careerMapUnResult ""
  StrCpy $careerMapUnText "MSFS Career Map has been uninstalled."
!macroend

; The uninstall section, after closing a running copy and before the files go
; (DESK-DIST-UNINST-002, 003, 005, 006, 013, 014). electron-builder then removes the install folder,
; the Apps entry and, without --keep-shortcuts, the Start-menu entry.
!macro customUnInstall
  ${If} $careerMapUpdated != 1
    ${CareerMapRunUnregister} $careerMapUnResult "${CAREER_MAP_PROGRAM}" ${CAREER_MAP_UNREGISTER_WAIT_MS}
    ${CareerMapUnregisterText} $careerMapUnText "$careerMapUnResult"
    WinShell::UninstShortcut "${CAREER_MAP_DESKTOP_LINK}"
    Delete "${CAREER_MAP_DESKTOP_LINK}"
    ${If} $LOCALAPPDATA != ""
      RMDir /r "${CAREER_MAP_DOWNLOADS}"
    ${EndIf}
    ClearErrors
  ${EndIf}
!macroend

; Just before MUI's uninstall Finished page (DESK-DIST-UNINST-008..010).
!macro customUninstallPage
  !define MUI_FINISHPAGE_TEXT "$careerMapUnText"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.careerMapUnFinishShow
!macroend
