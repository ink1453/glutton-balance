' Start panel.exe hidden (no console window).
' Usage: wscript.exe //B //Nologo panel-hidden.vbs
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\panel.exe"
sh.Run """" & exe & """", 0, False
