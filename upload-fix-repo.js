import fs from 'fs';
import { execSync } from 'child_process';

const token = fs.readFileSync('C:/Users/Сергей/.gemini/antigravity/scratch/dodospoti/token.tmp', 'utf8').trim();

async function run() {
    const relRes = await fetch('https://api.github.com/repos/redmi157312/DodoSpoti-Fix/releases/tags/v1.3', {
        headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': 'DodoSpoti' }
    });
    const rel = await relRes.json();
    console.log('Found release on DodoSpoti-Fix:', rel.id);

    const assets = [
        { path: 'C:/Users/Сергей/Desktop/DodoSpoti-v1.3-Setup.exe', name: 'DodoSpoti-v1.3-Setup.exe', mime: 'application/vnd.microsoft.portable-executable' },
        { path: 'C:/Users/Сергей/Desktop/DodoSpoti-v1.3-android.apk', name: 'DodoSpoti-v1.3-android.apk', mime: 'application/vnd.android.package-archive' },
        { path: 'C:/Users/Сергей/Desktop/DodoSpoti-Native-v1.3-win64.zip', name: 'DodoSpoti-Native-v1.3-win64.zip', mime: 'application/zip' }
    ];

    for (const a of assets) {
        console.log(`Uploading ${a.name} with curl...`);
        const uploadUrl = `https://uploads.github.com/repos/redmi157312/DodoSpoti-Fix/releases/${rel.id}/assets?name=${a.name}`;
        const cmd = `curl.exe -L -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: ${a.mime}" --data-binary @"${a.path}" "${uploadUrl}"`;
        try {
            execSync(cmd, { stdio: 'inherit' });
            console.log(`\nSuccessfully uploaded: ${a.name}`);
        } catch (e) {
            console.error(`Error uploading ${a.name}:`, e.message);
        }
    }
    console.log('\nAll assets uploaded to DodoSpoti-Fix successfully!');
}

run();
