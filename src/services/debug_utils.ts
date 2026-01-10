export const dumpHtml = async (html: string) => {
    const fs = require('expo-file-system/legacy');
    const path = fs.documentDirectory + 'debug_youtube.html';
    await fs.writeAsStringAsync(path, html);
    console.log(`[YouTube] HTML dumped to: ${path}`);
};
