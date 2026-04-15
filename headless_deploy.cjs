const { spawn } = require('child_process');

async function runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        console.log(`Running: ${cmd} ${args.join(' ')}`);
        const proc = spawn(cmd, args, { shell: true });

        proc.stdout.on('data', (data) => process.stdout.write(data));
        proc.stderr.on('data', (data) => {
            const output = data.toString();
            process.stderr.write(output);
            if (output.toLowerCase().includes('password:')) {
                proc.stdin.write('nexus.rdom\n');
            }
            if (output.toLowerCase().includes('(yes/no')) {
                proc.stdin.write('yes\n');
            }
        });

        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Exit code ${code}`));
        });
    });
}

async function deploy() {
    try {
        const dest = 'root@192.168.50.227:/var/www/html/analytics';
        // 1. Create dir
        await runCommand('ssh', ['-o', 'StrictHostKeyChecking=no', 'root@192.168.50.227', '"mkdir -p /var/www/html/analytics"']);
        // 2. Upload dist contents (simplified as individual files to be safe with globbing)
        await runCommand('scp', ['-r', 'dist/*', dest + '/']);
        await runCommand('scp', ['.htaccess', '.env', 'migrate_db.php', 'db_update.php', dest + '/']);
        // 3. Permissions
        await runCommand('ssh', ['root@192.168.50.227', '"chmod -R 755 /var/www/html/analytics && chown -R www-data:www-data /var/www/html/analytics"']);
        console.log('DEPLOYMENT SUCCESS');
    } catch (err) {
        console.error('DEPLOYMENT FAILED:', err.message);
        process.exit(1);
    }
}

deploy();
