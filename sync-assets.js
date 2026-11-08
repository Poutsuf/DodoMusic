import fs from 'fs';
import path from 'path';

const root = 'C:\\Users\\Сергей\\.gemini\\antigravity\\scratch\\dodospoti';
const targets = [
    path.join(root, 'dist', 'DodoSpoti-win32-x64', 'resources', 'app'),
    'C:\\Users\\Сергей\\Desktop\\DodoSpoti_GitHub_Upload',
    path.join(root, 'android-app', 'app', 'src', 'main', 'assets', 'www')
];

function copyFolderRecursive(source, target) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }
    const files = fs.readdirSync(source);
    for (const file of files) {
        const curSource = path.join(source, file);
        const curTarget = path.join(target, file);
        if (fs.lstatSync(curSource).isDirectory()) {
            copyFolderRecursive(curSource, curTarget);
        } else {
            fs.copyFileSync(curSource, curTarget);
        }
    }
}

for (const target of targets) {
    console.log(`Syncing to ${target}...`);
    // Copy server.js
    if (fs.existsSync(target)) {
        fs.copyFileSync(path.join(root, 'server.js'), path.join(target, 'server.js'));
        
        // For android, public files go directly into www
        if (target.includes('assets\\www')) {
            copyFolderRecursive(path.join(root, 'public'), target);
        } else {
            copyFolderRecursive(path.join(root, 'public'), path.join(target, 'public'));
        }
    }
}

console.log('All targets successfully synchronized!');
