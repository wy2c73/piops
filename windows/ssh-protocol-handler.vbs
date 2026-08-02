' Parses an "ssh://user@host:port" link -- what Settings -> "Open in
' local terminal" -> System default generates -- and opens it in Windows
' Terminal if installed (a new tab running ssh), or a classic Command
' Prompt window otherwise. Both use the OpenSSH client built into
' Windows 10 (1809+) and Windows 11, so nothing else needs installing.
'
' Without this registered, Windows has nothing configured to handle the
' "ssh:" scheme at all, so the browser just treats the link like a
' broken/unknown URL -- this is normal, out-of-the-box Windows behavior,
' not something specific to this dashboard.
'
' Setup:
'   1. Save this file somewhere permanent, e.g.
'      C:\Tools\pi-fleet-dashboard\ssh-protocol-handler.vbs
'   2. Open register-ssh-protocol.reg in a text editor and replace the
'      placeholder path with wherever you put this file in step 1.
'   3. Double-click the edited .reg file and confirm the prompt.
'
' If you use PuTTY or WinSCP instead (via the Settings dropdown), you
' don't need this file at all -- those have their own separate handler
' (see putty-protocol-handler.vbs) and registered scheme.

Dim uri, rest, atPos, colonPos, userPart, hostPart, hostPort, portPart, target

If WScript.Arguments.Count = 0 Then
  WScript.Quit
End If

uri = WScript.Arguments(0)
rest = Mid(uri, Len("ssh://") + 1)

' Some browsers add a trailing slash, e.g. "ssh://pi@host:22/"
If Right(rest, 1) = "/" Then rest = Left(rest, Len(rest) - 1)

atPos = InStrRev(rest, "@")
If atPos > 0 Then
  userPart = Left(rest, atPos - 1)
  hostPort = Mid(rest, atPos + 1)
Else
  userPart = ""
  hostPort = rest
End If

colonPos = InStrRev(hostPort, ":")
If colonPos > 0 Then
  hostPart = Left(hostPort, colonPos - 1)
  portPart = Mid(hostPort, colonPos + 1)
Else
  hostPart = hostPort
  portPart = "22"
End If

If userPart <> "" Then
  target = userPart & "@" & hostPart
Else
  target = hostPart
End If

Dim shell, sshCommand
Set shell = CreateObject("WScript.Shell")
sshCommand = "ssh " & target & " -p " & portPart

' Try Windows Terminal first (a new tab running the ssh command); if it's
' not installed/on PATH, Shell.Run raises an error that we catch here and
' fall back to a plain Command Prompt window, which every Windows install
' has.
On Error Resume Next
Err.Clear
shell.Run "wt.exe -- " & sshCommand, 1, False
If Err.Number <> 0 Then
  Err.Clear
  shell.Run "cmd.exe /k " & sshCommand, 1, False
End If
On Error Goto 0
