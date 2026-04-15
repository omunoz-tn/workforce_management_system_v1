# Deployment script for Workforce Platform
# Target: 192.168.50.227

$Server = "192.168.50.227"
$User = "root"
$DestPath = "/var/www/html/analytics"

Write-Host "--- Deployment Started ---" -ForegroundColor Cyan

# 1. Ensure target directory exists
Write-Host "Ensuring target directory exists on server..." -ForegroundColor Yellow
ssh ${User}@${Server} "mkdir -p ${DestPath}"

# 2. Upload dist contents
Write-Host "Uploading project files..." -ForegroundColor Yellow
scp -r dist/* ${User}@${Server}:${DestPath}/
scp .htaccess ${User}@${Server}:${DestPath}/
scp .env ${User}@${Server}:${DestPath}/
scp migrate_db.php ${User}@${Server}:${DestPath}/
scp db_update.php ${User}@${Server}:${DestPath}/

# 3. Set Permissions
Write-Host "Setting file permissions on server..." -ForegroundColor Yellow
ssh ${User}@${Server} "chmod -R 755 ${DestPath} && chown -R www-data:www-data ${DestPath}"

Write-Host "--- Deployment Complete! ---" -ForegroundColor Green
Write-Host "Access the app at: http://$Server/analytics" -ForegroundColor Cyan
