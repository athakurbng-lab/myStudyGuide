export async function uploadToDrive(accessToken: string, fileName: string, content: string, mimeType: string) {
    const metadata = {
        name: fileName,
        mimeType: mimeType,
        parents: ['root'] // TODO: Search for or create 'myAudioApp' folder first
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: mimeType }));

    try {
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            body: form,
        });

        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Drive Upload Error:", error);
        throw error;
    }
}
