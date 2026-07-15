' Parses a "putty:user@host:port" link (as passed by Windows when the
' registered "putty" protocol handler is invoked from a browser) and
' launches PuTTY with the equivalent -ssh / -P arguments.
'
' Setup:
'   1. Edit puttyPath below if PuTTY isn't installed at the default location.
'   2. Save this file somewhere permanent (it will be run every time you
'      click an "Open in PuTTY" link, so don't leave it in a temp folder).
'   3. Edit register-putty-protocol.reg to point at this file's actual path,
'      then double-click that .reg file to install the protocol handler.

Dim puttyPath
puttyPath = "C:\Program Files\PuTTY\putty.exe" ' <-- edit if needed

Dim uri, rest, atPos, colonPos, userPart, hostPort, hostPart, portPart, target

If WScript.Arguments.Count = 0 Then
  WScript.Quit
End If

uri = WScript.Arguments(0)
rest = Mid(uri, Len("putty:") + 1)

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

Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run """" & puttyPath & """ -ssh " & target & " -P " & portPart, 1, False
