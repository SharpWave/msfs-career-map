; MSFS Career Map — the NSIS include's steps (m3 contract §4.2; distribution-design, Installer and
; Uninstaller). build/installer.nsh, electron-builder's hooks, calls them; the include's tests
; (`npm run test:installer`, tests/installer/) build small programs from this file alone.
;
; Plain NSIS 3 (Unicode): only NSIS's own LogicLib, FileFunc, WordFunc and WinMessages and the
; System plugin, nothing of electron-builder's, so a test program can include this file by itself.
;
; Every step is a `${...}` wrapper usable in the installer and in the uninstaller: arguments are
; pushed, the matching function called — the `un.` one when the wrapper sits in uninstaller code
; (`__UNINSTALL__`) — and the result popped. Functions leave $0-$9 and $R0-$R9 as they found them.
;
; The functions are defined by
;   !insertmacro CAREER_MAP_STEPS ""        every step, for the installer (the test programs)
;   !insertmacro CAREER_MAP_STEPS "un."     every step, for the uninstaller
;   !insertmacro CAREER_MAP_STEP <Name> ""  one step and the steps it calls, defined once
; electron-builder runs makensis with -WX, where a function or variable nothing uses is an error, so
; build/installer.nsh defines in each of its two compiles only the steps that compile calls.

!ifndef CAREER_MAP_INSTALLER_STEPS_NSH
!define CAREER_MAP_INSTALLER_STEPS_NSH

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "WinMessages.nsh"

; ---------------------------------------------------------------------------------------------
; The wrappers

; OUT := 1 when GIVEN (a /D= value, "" for none) is not "" and names another folder than EXPECTED,
; both made absolute (GetFullPathNameW) and any trailing \ trimmed, compared ignoring case; else 0.
!define CareerMapFolderRefused "!insertmacro _CareerMapFolderRefused"
!macro _CareerMapFolderRefused OUT GIVEN EXPECTED
  Push "${GIVEN}"
  Push "${EXPECTED}"
  !insertmacro _CareerMapCall FolderRefused
  Pop ${OUT}
!macroend

; OUT := the number of processes this Windows user may query whose program lies inside FOLDER
; (prefix FOLDER\, ignoring case); the calling process itself is never counted.
!define CareerMapFindRunning "!insertmacro _CareerMapFindRunning"
!macro _CareerMapFindRunning OUT FOLDER
  Push "${FOLDER}"
  Push 0
  !insertmacro _CareerMapCall Scan
  Pop ${OUT}
!macroend

; Ends (TerminateProcess) each process FindRunning would count for FOLDER.
!define CareerMapEndRunning "!insertmacro _CareerMapEndRunning"
!macro _CareerMapEndRunning FOLDER
  Push "${FOLDER}"
  Push 1
  !insertmacro _CareerMapCall Scan
  !insertmacro _CareerMapDrop
!macroend

; Runs `"PROGRAM" --quit` without waiting, checks every 250 ms until no process is inside FOLDER or
; WAITMS pass, then ends any left. OUT := quit (all ended by themselves), ended (some had to be ended)
; or none (none ran at the start; nothing run).
!define CareerMapCloseRunning "!insertmacro _CareerMapCloseRunning"
!macro _CareerMapCloseRunning OUT FOLDER PROGRAM WAITMS
  Push "${FOLDER}"
  Push "${PROGRAM}"
  Push "${WAITMS}"
  !insertmacro _CareerMapCall CloseRunning
  Pop ${OUT}
!macroend

; Marks an install as under way (DESK-DIST-INST-029): when MARK exists and PATH lies inside
; DOWNLOADS, appends `process PID PATH`; otherwise writes a new MARK (BOM + that line), replacing any,
; creating DOWNLOADS when missing.
!define CareerMapMarkInstall "!insertmacro _CareerMapMarkInstall"
!macro _CareerMapMarkInstall MARK DOWNLOADS PID PATH
  Push "${MARK}"
  Push "${DOWNLOADS}"
  Push "${PID}"
  Push "${PATH}"
  !insertmacro _CareerMapCall MarkInstall
!macroend

; Appends LINE + CR LF as UTF-16LE in one WriteFile to MARK, opened with FILE_APPEND_DATA and
; OPEN_EXISTING (never created). OUT := 1 written, 0 no mark.
!define CareerMapAppendMark "!insertmacro _CareerMapAppendMark"
!macro _CareerMapAppendMark OUT MARK LINE
  Push "${MARK}"
  Push "${LINE}"
  !insertmacro _CareerMapCall AppendMark
  Pop ${OUT}
!macroend

; Takes up MARK: renames it to MARK.<own pid>.taken, reads it, deletes it. OUT := the start it asks
; for — window, --updated, --background or "" (none) — the one that shows the most among the last
; `request` line (`none` asking nothing) and every `start` line (no switches: window); "" when MARK
; is missing.
!define CareerMapTakeUpMark "!insertmacro _CareerMapTakeUpMark"
!macro _CareerMapTakeUpMark OUT MARK
  Push "${MARK}"
  !insertmacro _CareerMapCall TakeUpMark
  Pop ${OUT}
!macroend

; OUT := window when LAUNCH is 1 (the wizard's Launch box ticked), else MARKSTART.
!define CareerMapChooseStart "!insertmacro _CareerMapChooseStart"
!macro _CareerMapChooseStart OUT MARKSTART LAUNCH
  ${If} "${LAUNCH}" == "1"
    StrCpy ${OUT} "window"
  ${Else}
    StrCpy ${OUT} "${MARKSTART}"
  ${EndIf}
!macroend

; Starts PROGRAM without waiting: window → "PROGRAM"; --updated or --background → "PROGRAM" <switch>;
; anything else ("" among them) → nothing.
!define CareerMapStartApp "!insertmacro _CareerMapStartApp"
!macro _CareerMapStartApp PROGRAM START
  ${If} "${START}" S== "window"
    Exec '"${PROGRAM}"'
  ${ElseIf} "${START}" S== "--updated"
    Exec '"${PROGRAM}" --updated'
  ${ElseIf} "${START}" S== "--background"
    Exec '"${PROGRAM}" --background'
  ${EndIf}
  ClearErrors
!macroend

; Runs `"PROGRAM" --unregister` and waits up to WAITMS. OUT := its exit code, timeout (it is then
; left running) or error (it could not be started).
!define CareerMapRunUnregister "!insertmacro _CareerMapRunUnregister"
!macro _CareerMapRunUnregister OUT PROGRAM WAITMS
  Push "${PROGRAM}"
  Push "${WAITMS}"
  !insertmacro _CareerMapCall RunUnregister
  Pop ${OUT}
!macroend

; OUT := the uninstaller's last page for --unregister's RESULT (m3 contract §4.4).
!define CareerMapUnregisterText "!insertmacro _CareerMapUnregisterText"
!macro _CareerMapUnregisterText OUT RESULT
  Push "${RESULT}"
  !insertmacro _CareerMapCall UnregisterText
  Pop ${OUT}
!macroend

; Holds the end of the Windows session: a hidden top-level window of this process's own, made on
; the calling thread, carrying ShutdownBlockReasonCreate(REASON). Released (the window destroyed) by
; CareerMapReleaseSessionEnd, which must run on the same thread.
!define CareerMapHoldSessionEnd "!insertmacro _CareerMapHoldSessionEnd"
!macro _CareerMapHoldSessionEnd REASON
  Push "${REASON}"
  !insertmacro _CareerMapCall HoldSessionEnd
!macroend

!define CareerMapReleaseSessionEnd "!insertmacro _CareerMapReleaseSessionEnd"
!macro _CareerMapReleaseSessionEnd
  !insertmacro _CareerMapCall ReleaseSessionEnd
!macroend

; ---------------------------------------------------------------------------------------------
; Plumbing

; Calls the step's installer or uninstaller function, by where the wrapper sits.
!macro _CareerMapCall NAME
  !ifdef __UNINSTALL__
    Call un.CareerMap_${NAME}
  !else
    Call CareerMap_${NAME}
  !endif
!macroend

; Drops the top of the stack, leaving every register as it was.
!macro _CareerMapDrop
  Exch $0
  Pop $0
!macroend

; A function's start with N arguments (pushed in order): the arguments in $0..$(N-1), every other
; register saved. Its end, _CareerMapLeave N with the result in $0 (or _CareerMapLeaveNone N),
; restores every register and leaves the result on the stack.
!macro _CareerMapSaveFrom FIRST
  !if ${FIRST} <= 1
    Push $1
  !endif
  !if ${FIRST} <= 2
    Push $2
  !endif
  !if ${FIRST} <= 3
    Push $3
  !endif
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
!macroend

!macro _CareerMapRestoreFrom FIRST
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  !if ${FIRST} <= 3
    Pop $3
  !endif
  !if ${FIRST} <= 2
    Pop $2
  !endif
  !if ${FIRST} <= 1
    Pop $1
  !endif
!macroend

!macro _CareerMapEnter N
  !if ${N} == 0
    Push $0
  !else if ${N} == 1
    ; ... A
    Exch $0          ; ... o0
  !else if ${N} == 2
    ; ... A B
    Exch $1          ; ... A o1
    Exch             ; ... o1 A
    Exch $0          ; ... o1 o0
  !else if ${N} == 3
    ; ... A B C
    Exch $2          ; ... A B o2
    Exch             ; ... A o2 B
    Exch $1          ; ... A o2 o1
    Exch 2           ; ... o1 o2 A
    Exch $0          ; ... o1 o2 o0
  !else if ${N} == 4
    ; ... A B C D
    Exch $3          ; ... A B C o3
    Exch             ; ... A B o3 C
    Exch $2          ; ... A B o3 o2
    Exch 2           ; ... A o2 o3 B
    Exch $1          ; ... A o2 o3 o1
    Exch 3           ; ... o1 o2 o3 A
    Exch $0          ; ... o1 o2 o3 o0
  !else
    !error "_CareerMapEnter takes 0 to 4 arguments"
  !endif
  !if ${N} == 0
    !insertmacro _CareerMapSaveFrom 1
  !else
    !insertmacro _CareerMapSaveFrom ${N}
  !endif
!macroend

; The result is in $0.
!macro _CareerMapLeave N
  !if ${N} == 0
    !insertmacro _CareerMapRestoreFrom 1
    Exch $0          ; ... R, $0 restored
  !else
    !insertmacro _CareerMapRestoreFrom ${N}
    !if ${N} == 1
      Exch $0        ; ... R
    !else if ${N} == 2
      Exch $0        ; ... o1 R
      Exch           ; ... R o1
      Pop $1         ; ... R
    !else if ${N} == 3
      Exch $0        ; ... o1 o2 R
      Exch 2         ; ... R o2 o1
      Pop $1
      Pop $2         ; ... R
    !else
      !error "_CareerMapLeave: no step gives a result from 4 arguments"
    !endif
  !endif
!macroend

!macro _CareerMapLeaveNone N
  !if ${N} == 0
    !insertmacro _CareerMapRestoreFrom 1
    Pop $0
  !else
    !insertmacro _CareerMapRestoreFrom ${N}
    !if ${N} == 1
      Pop $0
    !else if ${N} == 2
      Pop $0
      Pop $1
    !else if ${N} == 3
      Pop $0
      Pop $2
      Pop $1
    !else if ${N} == 4
      Pop $0
      Pop $3
      Pop $2
      Pop $1
    !endif
  !endif
!macroend

; VAR := VAR without any trailing \ (uses nothing else).
!macro _CareerMapTrimSlashes VAR TMP
  ${Do}
    StrCpy ${TMP} ${VAR} 1 -1
    ${If} ${TMP} != "\"
      ${Break}
    ${EndIf}
    StrCpy ${VAR} ${VAR} -1
  ${Loop}
!macroend

; ---------------------------------------------------------------------------------------------
; The functions, each defined once per prefix ("" or "un.") with the functions it calls.

!macro CAREER_MAP_STEP NAME UN
  !ifndef CAREER_MAP_STEP_DEFINED_${UN}${NAME}
    !define CAREER_MAP_STEP_DEFINED_${UN}${NAME}
    !insertmacro _CareerMapStep_${NAME} "${UN}"
  !endif
!macroend

!macro CAREER_MAP_STEPS UN
  !insertmacro CAREER_MAP_STEP FolderRefused "${UN}"
  !insertmacro CAREER_MAP_STEP Scan "${UN}"
  !insertmacro CAREER_MAP_STEP CloseRunning "${UN}"
  !insertmacro CAREER_MAP_STEP MarkInstall "${UN}"
  !insertmacro CAREER_MAP_STEP AppendMark "${UN}"
  !insertmacro CAREER_MAP_STEP TakeUpMark "${UN}"
  !insertmacro CAREER_MAP_STEP RunUnregister "${UN}"
  !insertmacro CAREER_MAP_STEP UnregisterText "${UN}"
  !insertmacro CAREER_MAP_STEP HoldSessionEnd "${UN}"
  !insertmacro CAREER_MAP_STEP ReleaseSessionEnd "${UN}"
!macroend

; Wrapper names whose function has another name.
!macro _CareerMapStep_FindRunning UN
  !insertmacro CAREER_MAP_STEP Scan "${UN}"
!macroend
!macro _CareerMapStep_EndRunning UN
  !insertmacro CAREER_MAP_STEP Scan "${UN}"
!macroend
!macro _CareerMapStep_ChooseStart UN
!macroend
!macro _CareerMapStep_StartApp UN
!macroend

; Inside(PATH, FOLDER) → 1 when PATH lies inside FOLDER (prefix FOLDER\, ordinal, ignoring case).
!macro _CareerMapStep_Inside UN
  Function ${UN}CareerMap_Inside
    !insertmacro _CareerMapEnter 2
    !insertmacro _CareerMapTrimSlashes $1 $2
    StrCpy $4 0
    ${If} $1 != ""
      StrCpy $1 "$1\"
      StrLen $2 $1
      StrLen $3 $0
      ${If} $3 > $2
        StrCpy $5 $0 $2
        System::Call "kernel32::CompareStringOrdinal(w r5, i -1, w r1, i -1, i 1) i .r6"
        ${If} $6 = 2
          StrCpy $4 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
    StrCpy $0 $4
    !insertmacro _CareerMapLeave 2
  FunctionEnd
!macroend

; FolderRefused(GIVEN, EXPECTED) → 1 or 0.
!macro _CareerMapStep_FolderRefused UN
  Function ${UN}CareerMap_FolderRefused
    !insertmacro _CareerMapEnter 2
    ${If} $0 == ""
      StrCpy $0 0
    ${Else}
      System::Call "kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r2, p 0) i .r3"
      System::Call "kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r4, p 0) i .r5"
      ${If} $5 = 0
        StrCpy $4 $1
      ${EndIf}
      ${If} $3 = 0
        ; A /D= value Windows cannot make a path of is no install folder.
        StrCpy $0 1
      ${Else}
        !insertmacro _CareerMapTrimSlashes $2 $6
        !insertmacro _CareerMapTrimSlashes $4 $6
        System::Call "kernel32::CompareStringOrdinal(w r2, i -1, w r4, i -1, i 1) i .r7"
        ${If} $7 = 2
          StrCpy $0 0
        ${Else}
          StrCpy $0 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
    !insertmacro _CareerMapLeave 2
  FunctionEnd
!macroend

; Scan(FOLDER, END) → the number of processes this user may query whose program lies inside FOLDER,
; never the calling process; with END 1 each is ended (TerminateProcess) through the very handle its
; path was read from, so FindRunning and EndRunning match exactly the same processes.
!macro _CareerMapStep_Scan UN
  !insertmacro CAREER_MAP_STEP Inside "${UN}"
  Function ${UN}CareerMap_Scan
    !insertmacro _CareerMapEnter 2
    StrCpy $2 0
    ${If} $1 = 1
      StrCpy $R0 4097 ; PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
    ${Else}
      StrCpy $R0 4096 ; PROCESS_QUERY_LIMITED_INFORMATION
    ${EndIf}
    System::Call "kernel32::GetCurrentProcessId() i .r3"
    System::Call "kernel32::CreateToolhelp32Snapshot(i 2, i 0) p .r4" ; TH32CS_SNAPPROCESS
    ${If} $4 <> -1
    ${AndIf} $4 <> 0
      ; PROCESSENTRY32W, 556 bytes in a 32-bit process; th32ProcessID is its third field.
      System::Alloc 556
      Pop $5
      System::Call "*$5(i 556)"
      System::Call "kernel32::Process32FirstW(p r4, p r5) i .r6"
      ${DoWhile} $6 <> 0
        System::Call "*$5(i .R3, i .R3, i .r7)"
        ${If} $7 <> $3
        ${AndIf} $7 <> 0
          System::Call "kernel32::OpenProcess(i R0, i 0, i r7) p .r8"
          ${If} $8 <> 0
            System::Call "kernel32::QueryFullProcessImageNameW(p r8, i 0, w .r9, *i ${NSIS_MAX_STRLEN}) i .R1"
            ${If} $R1 <> 0
              Push $9
              Push $0
              Call ${UN}CareerMap_Inside
              Pop $R2
              ${If} $R2 = 1
                IntOp $2 $2 + 1
                ${If} $1 = 1
                  System::Call "kernel32::TerminateProcess(p r8, i 1) i"
                ${EndIf}
              ${EndIf}
            ${EndIf}
            System::Call "kernel32::CloseHandle(p r8) i"
          ${EndIf}
        ${EndIf}
        System::Call "kernel32::Process32NextW(p r4, p r5) i .r6"
      ${Loop}
      System::Free $5
      System::Call "kernel32::CloseHandle(p r4) i"
    ${EndIf}
    StrCpy $0 $2
    !insertmacro _CareerMapLeave 2
  FunctionEnd
!macroend

; CloseRunning(FOLDER, PROGRAM, WAITMS) → quit, ended or none.
!macro _CareerMapStep_CloseRunning UN
  !insertmacro CAREER_MAP_STEP Scan "${UN}"
  Function ${UN}CareerMap_CloseRunning
    !insertmacro _CareerMapEnter 3
    Push $0
    Push 0
    Call ${UN}CareerMap_Scan
    Pop $3
    ${If} $3 = 0
      StrCpy $0 "none"
    ${Else}
      ClearErrors
      Exec '"$1" --quit'
      ClearErrors
      System::Call "kernel32::GetTickCount() i .r4"
      StrCpy $5 "ended"
      ${Do}
        Sleep 250
        Push $0
        Push 0
        Call ${UN}CareerMap_Scan
        Pop $3
        ${If} $3 = 0
          StrCpy $5 "quit"
          ${Break}
        ${EndIf}
        System::Call "kernel32::GetTickCount() i .r6"
        IntOp $6 $6 - $4
      ${LoopUntil} $6 >= $2
      ${If} $5 == "ended"
        ; End what is left, and look again until it is gone (a process ended a moment ago can
        ; still be listed); one that cannot be ended is given up on after about 10 s.
        StrCpy $7 0
        ${Do}
          Push $0
          Push 1
          Call ${UN}CareerMap_Scan
          Pop $3
          ${If} $3 = 0
            ${Break}
          ${EndIf}
          Sleep 100
          IntOp $7 $7 + 1
        ${LoopUntil} $7 >= 100
      ${EndIf}
      StrCpy $0 $5
    ${EndIf}
    !insertmacro _CareerMapLeave 3
  FunctionEnd
!macroend

; AppendMark(MARK, LINE) → 1 or 0.
!macro _CareerMapStep_AppendMark UN
  Function ${UN}CareerMap_AppendMark
    !insertmacro _CareerMapEnter 2
    StrCpy $2 "$1$\r$\n"
    StrLen $3 $2
    IntOp $3 $3 * 2
    StrCpy $6 0
    ; FILE_APPEND_DATA, shared read/write/delete, OPEN_EXISTING: appends only, never creates.
    System::Call "kernel32::CreateFileW(w r0, i 4, i 7, p 0, i 3, i 0x80, p 0) p .r4"
    ${If} $4 <> -1
    ${AndIf} $4 <> 0
      System::Call "kernel32::WriteFile(p r4, w r2, i r3, *i .r5, p 0) i .r7"
      ${If} $7 <> 0
      ${AndIf} $5 = $3
        StrCpy $6 1
      ${EndIf}
      System::Call "kernel32::CloseHandle(p r4) i"
    ${EndIf}
    StrCpy $0 $6
    !insertmacro _CareerMapLeave 2
  FunctionEnd
!macroend

; MarkInstall(MARK, DOWNLOADS, PID, PATH).
!macro _CareerMapStep_MarkInstall UN
  !insertmacro CAREER_MAP_STEP Inside "${UN}"
  !insertmacro CAREER_MAP_STEP AppendMark "${UN}"
  Function ${UN}CareerMap_MarkInstall
    !insertmacro _CareerMapEnter 4
    StrCpy $4 "process $2 $3"
    StrCpy $5 0
    ${If} ${FileExists} "$0"
      Push $3
      Push $1
      Call ${UN}CareerMap_Inside
      Pop $6
      ${If} $6 = 1
        Push $0
        Push $4
        Call ${UN}CareerMap_AppendMark
        Pop $5
      ${EndIf}
    ${EndIf}
    ${If} $5 <> 1
      ; A new mark, written whole in one WriteFile: BOM + the line + CR LF, UTF-16LE.
      CreateDirectory "$1"
      ClearErrors
      IntFmt $6 "%c" 0xFEFF
      StrCpy $6 "$6$4$\r$\n"
      StrLen $7 $6
      IntOp $7 $7 * 2
      ; GENERIC_WRITE, shared read/write/delete, CREATE_ALWAYS.
      System::Call "kernel32::CreateFileW(w r0, i 0x40000000, i 7, p 0, i 2, i 0x80, p 0) p .r8"
      ${If} $8 <> -1
      ${AndIf} $8 <> 0
        System::Call "kernel32::WriteFile(p r8, w r6, i r7, *i .r9, p 0) i"
        System::Call "kernel32::CloseHandle(p r8) i"
      ${EndIf}
    ${EndIf}
    !insertmacro _CareerMapLeaveNone 4
  FunctionEnd
!macroend

; TakeUpMark(MARK) → window, --updated, --background or "".
!macro _CareerMapStep_TakeUpMark UN
  Function ${UN}CareerMap_TakeUpMark
    !insertmacro _CareerMapEnter 1
    System::Call "kernel32::GetCurrentProcessId() i .r1"
    StrCpy $1 "$0.$1.taken"
    StrCpy $2 0 ; the best start among the `start` lines: 3 window, 2 --updated, 1 --background, 0 none
    StrCpy $3 0 ; the last `request`, ranked the same
    Delete "$1"
    ClearErrors
    Rename "$0" "$1"
    ${IfNot} ${Errors}
      IntFmt $4 "%c" 0xFEFF
      ClearErrors
      FileOpen $5 "$1" r
      ${IfNot} ${Errors}
        StrCpy $6 1
        ${Do}
          ClearErrors
          FileReadUTF16LE $5 $7
          ${If} ${Errors}
            ${Break}
          ${EndIf}
          ${If} $6 = 1
            StrCpy $6 0
            StrCpy $8 $7 1
            ${If} $8 S== $4
              StrCpy $7 $7 "" 1
            ${EndIf}
          ${EndIf}
          ${Do}
            StrCpy $8 $7 1 -1
            ${If} $8 S== "$\r"
            ${OrIf} $8 S== "$\n"
              StrCpy $7 $7 -1
            ${Else}
              ${Break}
            ${EndIf}
          ${Loop}
          ${If} $7 S== "request none"
            StrCpy $3 0
          ${ElseIf} $7 S== "request --background"
            StrCpy $3 1
          ${ElseIf} $7 S== "request --updated"
            StrCpy $3 2
          ${ElseIf} $7 S== "start "
            StrCpy $9 3
          ${ElseIf} $7 S== "start --updated"
            StrCpy $9 2
          ${ElseIf} $7 S== "start --background"
            StrCpy $9 1
          ${Else}
            StrCpy $9 0
          ${EndIf}
          ${If} $9 > $2
            StrCpy $2 $9
          ${EndIf}
          StrCpy $9 0
        ${Loop}
        FileClose $5
      ${EndIf}
      Delete "$1"
    ${EndIf}
    ClearErrors
    ${If} $3 > $2
      StrCpy $2 $3
    ${EndIf}
    ${If} $2 = 3
      StrCpy $0 "window"
    ${ElseIf} $2 = 2
      StrCpy $0 "--updated"
    ${ElseIf} $2 = 1
      StrCpy $0 "--background"
    ${Else}
      StrCpy $0 ""
    ${EndIf}
    !insertmacro _CareerMapLeave 1
  FunctionEnd
!macroend

; RunUnregister(PROGRAM, WAITMS) → the exit code, timeout or error. ExecWait has no timeout, so the
; program is started with CreateProcessW and waited for with WaitForSingleObject.
!macro _CareerMapStep_RunUnregister UN
  Function ${UN}CareerMap_RunUnregister
    !insertmacro _CareerMapEnter 2
    StrCpy $2 '"$0" --unregister'
    ; STARTUPINFOW (68 bytes) and PROCESS_INFORMATION (16 bytes) in a 32-bit process.
    System::Alloc 68
    Pop $3
    System::Call "*$3(i 68)"
    System::Alloc 16
    Pop $4
    System::Call "kernel32::CreateProcessW(p 0, w r2, p 0, p 0, i 0, i 0, p 0, p 0, p r3, p r4) i .r5"
    ${If} $5 = 0
      StrCpy $0 "error"
    ${Else}
      System::Call "*$4(p .r6, p .r7)"
      System::Call "kernel32::CloseHandle(p r7) i"
      System::Call "kernel32::WaitForSingleObject(p r6, i r1) i .r8"
      ${If} $8 = 0
        System::Call "kernel32::GetExitCodeProcess(p r6, *i .r9) i .r5"
        ${If} $5 <> 0
          StrCpy $0 $9
        ${Else}
          StrCpy $0 "error"
        ${EndIf}
      ${ElseIf} $8 = 258 ; WAIT_TIMEOUT
        StrCpy $0 "timeout"
      ${Else}
        StrCpy $0 "error"
      ${EndIf}
      System::Call "kernel32::CloseHandle(p r6) i"
    ${EndIf}
    System::Free $3
    System::Free $4
    !insertmacro _CareerMapLeave 2
  FunctionEnd
!macroend

; UnregisterText(RESULT) → the uninstaller's last page (m3 contract §4.4).
!macro _CareerMapStep_UnregisterText UN
  Function ${UN}CareerMap_UnregisterText
    !insertmacro _CareerMapEnter 1
    StrCpy $1 "MSFS Career Map has been uninstalled.$\r$\n$\r$\nYour logbook and settings were kept and can be deleted by hand:$\r$\n- the data folder, %LOCALAPPDATA%\MSFS Career Map$\r$\n- the backups folder, MSFS Career Map\Backups in Documents$\r$\n- Electron's own folder, %APPDATA%\MSFS Career Map (settings, logs, caches and start-up list backups)"
    StrCpy $2 "MSFS's start list (EXE.xml) still holds MSFS Career Map's entry, or could not be checked. Remove the entry named $\"MSFS Career Map$\" by hand from EXE.xml in %LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache (Microsoft Store) and %APPDATA%\Microsoft Flight Simulator 2024 (Steam)."
    StrCpy $3 "Windows' start-up list still holds MSFS Career Map, or could not be checked. Remove the value named $\"MSFS Career Map$\" by hand from HKCU\Software\Microsoft\Windows\CurrentVersion\Run."
    ${If} $0 S== "0"
      StrCpy $0 $1
    ${ElseIf} $0 S== "1"
      StrCpy $0 "$1$\r$\n$\r$\n$2"
    ${ElseIf} $0 S== "2"
      StrCpy $0 "$1$\r$\n$\r$\n$3"
    ${ElseIf} $0 S== "3"
      StrCpy $0 "$1$\r$\n$\r$\n$2$\r$\n$\r$\n$3"
    ${Else}
      StrCpy $0 "$1$\r$\n$\r$\nThe start lists could not be checked. An entry named $\"MSFS Career Map$\" may need deleting by hand from EXE.xml in %LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache (Microsoft Store) and %APPDATA%\Microsoft Flight Simulator 2024 (Steam), and from HKCU\Software\Microsoft\Windows\CurrentVersion\Run."
    ${EndIf}
    !insertmacro _CareerMapLeave 1
  FunctionEnd
!macroend

; The session-end hold's window, shared by both prefixes' functions (one variable per compile).
!macro _CareerMapSessionWindowVar
  !ifndef CAREER_MAP_SESSION_WINDOW_VAR
    !define CAREER_MAP_SESSION_WINDOW_VAR
    Var careerMapSessionWindow
  !endif
!macroend

; HoldSessionEnd(REASON).
!macro _CareerMapStep_HoldSessionEnd UN
  !insertmacro _CareerMapSessionWindowVar
  Function ${UN}CareerMap_HoldSessionEnd
    !insertmacro _CareerMapEnter 1
    StrCpy $1 $careerMapSessionWindow
    ${If} $1 == ""
    ${OrIf} $1 = 0
      ; A hidden (no WS_VISIBLE) top-level WS_POPUP window of the system's STATIC class.
      System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "MSFS Career Map Setup", i 0x80000000, i 0, i 0, i 0, i 0, p 0, p 0, p 0, p 0) p .r1'
      StrCpy $careerMapSessionWindow $1
    ${EndIf}
    ${If} $1 <> 0
      System::Call "user32::ShutdownBlockReasonCreate(p r1, w r0) i"
    ${EndIf}
    !insertmacro _CareerMapLeaveNone 1
  FunctionEnd
!macroend

; ReleaseSessionEnd().
!macro _CareerMapStep_ReleaseSessionEnd UN
  !insertmacro _CareerMapSessionWindowVar
  Function ${UN}CareerMap_ReleaseSessionEnd
    !insertmacro _CareerMapEnter 0
    StrCpy $1 $careerMapSessionWindow
    ${If} $1 != ""
    ${AndIf} $1 <> 0
      System::Call "user32::ShutdownBlockReasonDestroy(p r1) i"
      System::Call "user32::DestroyWindow(p r1) i"
    ${EndIf}
    StrCpy $careerMapSessionWindow ""
    !insertmacro _CareerMapLeaveNone 0
  FunctionEnd
!macroend

!endif ; CAREER_MAP_INSTALLER_STEPS_NSH
