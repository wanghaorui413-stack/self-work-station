' Start the workbench server in the background (no window): http://127.0.0.1:8000
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = root
shell.Run "cmd /c node scripts\serve.mjs >> data\server.log 2>&1", 0, False
