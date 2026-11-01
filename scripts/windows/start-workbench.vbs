' Start the workbench server in the background (no window): http://127.0.0.1:8000
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")

' Prefer the standard Node.js install location, so it works even if PATH has not refreshed yet.
node = "node"
candidates = Array(shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", _
                   shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe")
For Each candidate In candidates
  If fso.FileExists(candidate) Then node = """" & candidate & """"
Next

shell.CurrentDirectory = root
shell.Run "cmd /c " & node & " scripts\serve.mjs >> data\server.log 2>&1", 0, False
