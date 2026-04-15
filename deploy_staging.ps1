# Deployment Script for Staging Server (192.168.80.243)
# This script bundles the project and deploys it using Docker Compose on the remote server.

$SERVER_IP = "192.168.80.243"
$USER = "root"
$REMOTE_PATH = "/root/platform_template3"

Write-Host "--- Starting Deployment to Staging ($SERVER_IP) ---" -ForegroundColor Cyan

# 1. Clean up old build artifacts and compress the project
Write-Host "1. Packaging project..."
if (Test-Path "deploy_staging.tar.gz") { Remove-Item "deploy_staging.tar.gz" }
# Exclude node_modules, .git, and dist for faster transfer
# We use tar to preserve permissions
tar --exclude='node_modules' --exclude='.git' --exclude='dist' -czf deploy_staging.tar.gz .

# 2. Upload to staging server
Write-Host "2. Uploading files to staging..."
scp deploy_staging.tar.gz "$($USER)@$($SERVER_IP):/tmp/"

# 3. Remote execution
Write-Host "3. Configuring remote server..."
$RemoteCmds = @"
mkdir -p $REMOTE_PATH
tar -xzf /tmp/deploy_staging.tar.gz -C $REMOTE_PATH
cd $REMOTE_PATH
docker-compose down
docker-compose up --build -d
rm /tmp/deploy_staging.tar.gz
"@

ssh "$($USER)@$($SERVER_IP)" "$RemoteCmds"

Write-Host "--- Deployment Complete! ---" -ForegroundColor Green
Write-Host "App should be live at: http://$SERVER_IP:8080"
