import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { SavedBook, SavedQuiz, saveBook, saveQuiz, getSavedBooks, getSavedQuizzes, getFolders, createFolder } from './storage';
import { Alert } from 'react-native';

// --- Sanitize Data for Export ---

const sanitizeBook = (book: SavedBook): SavedBook => {
    // Remove user-specific data
    const { id, date, folder, lastPosition, ...rest } = book;
    return {
        ...rest,
        id: `imported_book_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // New ID for import
        date: new Date().toISOString(),
        folder: undefined, // Reset folder
        lastPosition: undefined
    } as SavedBook;
};

const sanitizeQuiz = (quiz: SavedQuiz): SavedQuiz => {
    // Remove user specific data
    const { id, date, folder, score, isSubmitted, userAnswers, committedAnswers, history, analysisReport, ...rest } = quiz;
    return {
        ...rest,
        id: `imported_quiz_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        date: new Date().toISOString(),
        folder: undefined,
        score: undefined,
        isSubmitted: false,
        userAnswers: {},
        committedAnswers: {},
        history: [],
        analysisReport: undefined
    } as SavedQuiz;
};

// --- Share Functions ---

export const shareBook = async (book: SavedBook) => {
    try {
        const cleanBook = sanitizeBook(book);
        const fileName = `${book.title.replace(/[^a-z0-9]/gi, '_')}.json`;
        const path = `${FileSystemLegacy.cacheDirectory}${fileName}`;
        await FileSystemLegacy.writeAsStringAsync(path, JSON.stringify({ type: 'BOOK', data: cleanBook }));
        await Sharing.shareAsync(path);
    } catch (error) {
        console.error("Error sharing book:", error);
        Alert.alert("Error", "Failed to share book.");
    }
};

export const shareQuiz = async (quiz: SavedQuiz) => {
    try {
        const cleanQuiz = sanitizeQuiz(quiz);
        const fileName = `${quiz.source.replace(/[^a-z0-9]/gi, '_')}.json`;
        const path = `${FileSystemLegacy.cacheDirectory}${fileName}`;
        await FileSystemLegacy.writeAsStringAsync(path, JSON.stringify({ type: 'QUIZ', data: cleanQuiz }));
        await Sharing.shareAsync(path);
    } catch (error) {
        console.error("Error sharing quiz:", error);
        Alert.alert("Error", "Failed to share quiz.");
    }
};

export const shareFolder = async (folderPath: string, type: 'BOOK' | 'QUIZ') => {
    try {
        const zip = new JSZip();
        const folderName = folderPath.split('/').pop() || 'folder';

        // 1. Get all items in this folder (and subfolders recursively)
        const allBooks = await getSavedBooks();
        const allQuizzes = await getSavedQuizzes();
        const allFolders = await getFolders(type);

        // Filter items that belong to this folder (or subfolders)
        // We will flatten the structure for simplicity in the zip, or keep structure?
        // Let's keep a flattened structure of JSONs for simplicity of import,
        // OR try to maintain folder structure.
        // For simplicity and robustness: We will zip all items as individual JSON files.
        // When importing, we just check each file.

        const targetBooks = allBooks.filter(b => b.folder === folderPath || b.folder?.startsWith(folderPath + '/'));
        const targetQuizzes = allQuizzes.filter(q => q.folder === folderPath || q.folder?.startsWith(folderPath + '/'));

        if (targetBooks.length === 0 && targetQuizzes.length === 0) {
            Alert.alert("Empty", "This folder is empty.");
            return;
        }

        // Add Books
        targetBooks.forEach(b => {
            const clean = sanitizeBook(b);
            zip.file(`book_${clean.title.replace(/[^a-z0-9]/gi, '_')}.json`, JSON.stringify({ type: 'BOOK', data: clean }));
        });

        // Add Quizzes
        targetQuizzes.forEach(q => {
            const clean = sanitizeQuiz(q);
            zip.file(`quiz_${clean.source.replace(/[^a-z0-9]/gi, '_')}.json`, JSON.stringify({ type: 'QUIZ', data: clean }));
        });

        const content = await zip.generateAsync({ type: 'base64' });
        const zipPath = `${FileSystemLegacy.cacheDirectory}${folderName}.zip`;
        await FileSystemLegacy.writeAsStringAsync(zipPath, content, { encoding: 'base64' });

        await Sharing.shareAsync(zipPath);

    } catch (error) {
        console.error("Error sharing folder:", error);
        Alert.alert("Error", "Failed to share folder.");
    }
};

// --- Import Functions ---

export const importSharedFile = async (uri: string) => {
    try {
        const fileInfo = await FileSystemLegacy.getInfoAsync(uri);
        const isZip = uri.toLowerCase().endsWith('.zip') || (fileInfo.exists && fileInfo.uri.endsWith('.zip')); // crude check

        // Sometimes URI from intent does not end in .zip, check MIME or content?
        // Let's attempt to read as string first. If it looks like JSON, parse. If binary/zip, unzip.

        // Reading huge zip as string might fail.
        // Strategy: Try to Unzip first using JSZip.loadAsync. If fail, try JSON parse.

        // We need to read file content. For 'content://' URIs (Android), copy to cache first.
        const localUri = `${FileSystemLegacy.cacheDirectory}import_temp_${Date.now()}`;
        await FileSystemLegacy.copyAsync({ from: uri, to: localUri });

        // Try JSON first (simpler)
        try {
            const content = await FileSystemLegacy.readAsStringAsync(localUri);
            const json = JSON.parse(content);
            if (await handleImportJSON(json)) {
                await FileSystemLegacy.deleteAsync(localUri, { idempotent: true });
                return true;
            }
        } catch (e) {
            // Not a valid JSON, maybe Zip?
        }

        // Try Zip
        try {
            // Read as base64 for JSZip
            const b64 = await FileSystemLegacy.readAsStringAsync(localUri, { encoding: 'base64' });
            const zip = await JSZip.loadAsync(b64, { base64: true });

            let importCount = 0;
            const files = Object.keys(zip.files);
            for (const filename of files) {
                if (!zip.files[filename].dir) {
                    const fileContent = await zip.files[filename].async('string');
                    try {
                        const json = JSON.parse(fileContent);
                        if (await handleImportJSON(json)) importCount++;
                    } catch (ignored) { }
                }
            }

            // @ts-ignore
            await FileSystemLegacy.deleteAsync(localUri, { idempotent: true });
            if (importCount > 0) {
                Alert.alert("Import Success", `Successfully imported ${importCount} items.`);
                return true;
            }

        } catch (e) {
            console.log("Zip check failed", e);
        }

        Alert.alert("Import Error", "Could not recognize file format.");
        return false;

    } catch (error: any) {
        console.error("Import error", error);
        Alert.alert("Error", "Failed to import file: " + error.message);
        return false;
    }
};

const handleImportJSON = async (json: any): Promise<boolean> => {
    if (!json || !json.type || !json.data) return false;

    if (json.type === 'BOOK') {
        const book = json.data as SavedBook;
        if (!book.title || !book.scripts) return false;

        const books = await getSavedBooks();
        if (books.some(b => b.title === book.title)) {
            book.title = `${book.title} (Imported)`;
        }
        await saveBook(book.title, book.scripts); // saveBook signature is (title, scripts) - verify this too? Yes usually matches.
        return true;
    }

    if (json.type === 'QUIZ') {
        const quiz = json.data as SavedQuiz;
        if (!quiz.source || !quiz.mcqs) return false;

        const quizzes = await getSavedQuizzes();
        // Remove date to match Omit<SavedQuiz, 'date'> expectation if needed, 
        // but saveQuiz will overwrite date anyway.
        // We'll trust the ID from import (sanitized) or generate new?
        // Sanitization happened on export.

        if (quizzes.some(q => q.source === quiz.source)) {
            quiz.source = `${quiz.source} (Imported)`;
        }

        // saveQuiz expects Omit<SavedQuiz, 'date'>.
        const { date, ...quizData } = quiz;
        await saveQuiz(quizData as any);
        return true;
    }

    return false;
};
