const AppInfoParser = require('app-info-parser');
const path = require('path');

async function test() {
    try {
        const apkPath = 'F:\\Devesh\\AI Essentials\\TestMate_AI\\projects\\idle_World\\apks\\Idle world V130.apk';
        const parser = new AppInfoParser(apkPath);
        const result = await parser.parse();
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error(e);
    }
}

test();
