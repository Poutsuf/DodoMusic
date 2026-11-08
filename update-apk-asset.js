import fs from 'fs';
import { execSync } from 'child_process';

const token = fs.readFileSync('C:/Users/Сергей/.gemini/antigravity/scratch/dodospoti/token.tmp', 'utf8').trim();

async function updateReleaseApk(repo) {
    const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v1.3`, {
        headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': 'DodoSpoti' }
    });
    if (!relRes.ok) return;
    const rel = await relRes.json();
    const oldApk = (rel.assets || []).find(a => a.name === 'DodoSpoti-v1.3-android.apk');
    if (oldApk) {
        console.log(`Deleting old APK from ${repo} (ID: ${oldApk.id})...`);
        await fetch(`https://api.github.com/repos/${repo}/releases/assets/${oldApk.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': 'DodoSpoti' }
        });
    }

    const apkPath = 'C:/Users/Сергей/Desktop/DodoSpoti-v1.3-android.apk';
    const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=DodoSpoti-v1.3-android.apk`;
    console.log(`Uploading new APK to ${repo}...`);
    const cmd = `curl.exe -L -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/vnd.android.package-archive" --data-binary @"${apkPath}" "${uploadUrl}"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log(`Successfully updated APK on ${repo}!\n`);
}

async function main() {
    await updateReleaseApk('redmi157312/DodoSpoti-Fix');
    await updateReleaseApk('redmi157312/DodoSpoti');
    console.log('All APK assets updated on GitHub!');
}

main();
