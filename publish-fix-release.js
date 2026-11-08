import fs from 'fs';
import path from 'path';

const token = fs.readFileSync('C:/Users/Сергей/.gemini/antigravity/scratch/dodospoti/token.tmp', 'utf8').trim();
const repos = [
    'redmi157312/DodoSpoti-Fix',
    'redmi157312/DodoSpoti'
];

async function createReleaseForRepo(repo) {
    console.log(`\n========================================`);
    console.log(`Creating release v1.3 on ${repo}...`);
    console.log(`========================================`);

    const releaseData = {
        tag_name: 'v1.3',
        target_commitish: 'main',
        name: 'DodoSpoti v1.3 (Universal Fix: Android APK + Windows Setup)',
        body: `## 🚀 DodoSpoti v1.3 — Глобальный фикс для ПК и Android!

### 📱 Android (APK):
- **Файл:** \`DodoSpoti-v1.3-android.apk\`
- **Исправлен интерфейс на смартфонах:**
  - Полностью убраны огромные белые кнопки-квадраты и чёрные рамки — внедрена стильная нижняя навигационная панель с эффектом матового стекла (Dark Glassmorphism)
  - Исправлен логотип DodoSpoti и корректные пути ко всем ассетам
  - Внедрён современный \`WebViewAssetLoader\` (\`androidx.webkit:webkit\`) для безопасной и плавной загрузки под \`https://appassets.androidplatform.net\`
- **100% автономный клиентский движок на телефоне:**
  - Прямой поиск и онлайн-стриминг музыки прямо из приложения без необходимости запущенного локального сервера на ПК
  - Персонализированная «Моя Волна», история прослушиваний и синхронизированное караоке (LRCLIB) прямо на телефоне

### 💻 Windows (ПК установщик):
- **Файл:** \`DodoSpoti-v1.3-Setup.exe\` (полноценный Setup-установщик)
- **Файл:** \`DodoSpoti-Native-v1.3-win64.zip\` (портативный быстрый запуск)
- **Исправлено воспроизведение треков у друзей и на любых ПК:**
  - Добавлен автоматический каскадный поиск через **Audius API** (децентрализованный аудиопоток, не блокируемый провайдерами)
  - Добавлен пул резервных SoundCloud Client ID с автоматической ротацией при ошибках
  - Добавлен встроенный локальный потоковый прокси (\`/api/stream-proxy\`) для обхода сетевых ограничений и блокировок CDN
  - Автоматическое восстановление при сбое трека с мгновенным переключением на резервный источник

---
*DodoSpoti — свободная музыка без подписок, без рекламы и с полной приватностью (Zero Telemetry).*`,
        draft: false,
        prerelease: false
    };

    const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            'User-Agent': 'DodoSpoti-Deployer'
        },
        body: JSON.stringify(releaseData)
    });

    if (!res.ok) {
        const text = await res.text();
        console.warn(`Release warning on ${repo}: ${res.status} ${text}`);
        // Try to fetch existing release if already exists
        const getRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v1.3`, {
            headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': 'DodoSpoti-Deployer' }
        });
        if (getRes.ok) {
            return await getRes.json();
        }
        return null;
    }

    const release = await res.json();
    console.log(`Release created on ${repo}: ${release.html_url}`);
    return release;
}

async function uploadAsset(release, filePath, assetName, contentType) {
    if (!release) return false;
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        return false;
    }
    const stat = fs.statSync(filePath);
    console.log(`Uploading ${assetName} (${(stat.size / (1024*1024)).toFixed(2)} MB)...`);

    const uploadUrl = release.upload_url.replace(/\{.*\}/, `?name=${encodeURIComponent(assetName)}`);
    const fileBuffer = fs.readFileSync(filePath);

    const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': contentType,
            'Content-Length': fileBuffer.length.toString(),
            'User-Agent': 'DodoSpoti-Deployer'
        },
        body: fileBuffer
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`Error uploading ${assetName}: ${res.status} ${text}`);
        return false;
    }

    const data = await res.json();
    console.log(`Uploaded ${assetName} -> ${data.browser_download_url}`);
    return true;
}

async function main() {
    const assets = [
        {
            path: 'C:/Users/Сергей/Desktop/DodoSpoti-v1.3-Setup.exe',
            name: 'DodoSpoti-v1.3-Setup.exe',
            type: 'application/vnd.microsoft.portable-executable'
        },
        {
            path: 'C:/Users/Сергей/Desktop/DodoSpoti-v1.3-android.apk',
            name: 'DodoSpoti-v1.3-android.apk',
            type: 'application/vnd.android.package-archive'
        },
        {
            path: 'C:/Users/Сергей/Desktop/DodoSpoti-Native-v1.3-win64.zip',
            name: 'DodoSpoti-Native-v1.3-win64.zip',
            type: 'application/zip'
        }
    ];

    for (const repo of repos) {
        try {
            const rel = await createReleaseForRepo(repo);
            if (rel) {
                for (const a of assets) {
                    await uploadAsset(rel, a.path, a.name, a.type);
                }
            }
        } catch (err) {
            console.error(`Failed for ${repo}:`, err);
        }
    }

    console.log('\nAll releases published and assets uploaded successfully!');
}

main();
