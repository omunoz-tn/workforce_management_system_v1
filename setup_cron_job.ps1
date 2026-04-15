# Setup Scheduled Task for DeskTime Background Sync
# This script will create a Windows Scheduled Task that runs every morning at 6:00 AM
# to ensure the DeskTime data is synced even if the app is not opened.

$PhpPath = "C:\php\php.exe"
$ScriptFolder = "c:\proyectos\platform_template3\public\api"
$ScriptPath = "$ScriptFolder\sync_auto_background.php"
$LogPath = "$ScriptFolder\cron_log.txt"

$TaskName = "Platform_DeskTime_Sync"
$ActionScript = "$PhpPath"
$ActionArgs = "-f $ScriptPath"

# Create a BAT file as a wrapper for easier manual testing and task execution
$BatContent = @"
@echo off
echo Starting Sync: %date% %time% >> "$LogPath"
"$PhpPath" -f "$ScriptPath" >> "$LogPath" 2>&1
echo Finished Sync: %date% %time% >> "$LogPath"
"@
$BatPath = "c:\proyectos\platform_template3\sync_cron.bat"
Set-Content -Path $BatPath -Value $BatContent

# Schedule the task (Runs daily at 6:00 AM)
# Note: Requires Administrator privileges to create scheduled tasks.
Write-Host "Registering Scheduled Task: $TaskName..."
schtasks /create /tn "$TaskName" /tr "$BatPath" /sc daily /st 06:00 /f

Write-Host "--------------------------------------------------------"
Write-Host "Success! The sync is now scheduled to run daily."
Write-Host "You can check the execution log at: $LogPath"
Write-Host "To run it manually now, use: .\sync_cron.bat"
Write-Host "--------------------------------------------------------"
