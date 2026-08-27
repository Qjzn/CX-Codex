Option Explicit

Const ExitMissingCommandArgument = 2
Const ExitCommandNotFound = 3

Dim arguments
Dim fileSystem
Dim shell
Dim commandPath
Dim command
Dim index

Set arguments = WScript.Arguments
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

If arguments.Count < 1 Then
  WScript.Quit ExitMissingCommandArgument
End If

commandPath = fileSystem.GetAbsolutePathName(arguments.Item(0))
If Not fileSystem.FileExists(commandPath) Then
  WScript.Quit ExitCommandNotFound
End If

command = QuoteArgument(commandPath)
For index = 1 To arguments.Count - 1
  command = command & " " & QuoteArgument(arguments.Item(index))
Next

WScript.Quit shell.Run(command, 0, True)

Function QuoteArgument(ByVal value)
  Dim result
  Dim backslashCount
  Dim position
  Dim character

  result = Chr(34)
  backslashCount = 0
  For position = 1 To Len(value)
    character = Mid(value, position, 1)
    If character = "\" Then
      backslashCount = backslashCount + 1
    ElseIf character = Chr(34) Then
      result = result & String((backslashCount * 2) + 1, "\") & Chr(34)
      backslashCount = 0
    Else
      If backslashCount > 0 Then
        result = result & String(backslashCount, "\")
        backslashCount = 0
      End If
      result = result & character
    End If
  Next
  If backslashCount > 0 Then
    result = result & String(backslashCount * 2, "\")
  End If
  QuoteArgument = result & Chr(34)
End Function
