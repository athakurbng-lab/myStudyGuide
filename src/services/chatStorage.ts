import * as FileSystem from 'expo-file-system/legacy';

const CHATS_DIR = FileSystem.documentDirectory + 'saved_chats/';

const ensureDir = async () => {
    const dirInfo = await FileSystem.getInfoAsync(CHATS_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CHATS_DIR, { intermediates: true });
    }
};

export const saveLocalMessages = async (chatId: string, messages: any[]) => {
    try {
        await ensureDir();
        const fileUri = CHATS_DIR + chatId + '.json';
        await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(messages));
    } catch (e) {
        console.error("Failed to save local messages", e);
    }
};

export const getLocalMessages = async (chatId: string): Promise<any[]> => {
    try {
        await ensureDir();
        const fileUri = CHATS_DIR + chatId + '.json';
        const fileInfo = await FileSystem.getInfoAsync(fileUri);
        if (!fileInfo.exists) return [];

        const content = await FileSystem.readAsStringAsync(fileUri);
        return JSON.parse(content);
    } catch (e) {
        console.error("Failed to load local messages", e);
        return [];
    }
};
