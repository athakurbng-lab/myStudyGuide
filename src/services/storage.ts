import * as FileSystem from 'expo-file-system/legacy';

const BOOKS_DIR = FileSystem.documentDirectory + 'saved_books/';
const QUIZZES_DIR = FileSystem.documentDirectory + 'saved_quizzes/';
const SETTINGS_FILE = FileSystem.documentDirectory + 'user_settings.json';
const FOLDERS_FILE = FileSystem.documentDirectory + 'folders.json';

export interface ScriptItem {
    script: string;
    visual_prompt?: string;
    context_summary?: string;
    page_summary?: string;
    duration?: number;
}

export interface SavedBook {
    id: string;
    title: string;
    date: string;
    scripts: ScriptItem[];
    folder?: string; // Path string e.g., "Parent/Child"
    lastPosition?: {
        pageIndex: number;
        progress: number;
    };
}

export interface UserSettings {
    lastEstimatedCharRate: number;
    hasLaunched?: boolean;
}

export interface Folder {
    path: string;
    type: 'BOOK' | 'QUIZ';
}

export const initStorage = async () => {
    const dirInfo = await FileSystem.getInfoAsync(BOOKS_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
    }
    const qDir = await FileSystem.getInfoAsync(QUIZZES_DIR);
    if (!qDir.exists) {
        await FileSystem.makeDirectoryAsync(QUIZZES_DIR, { intermediates: true });
    }
};

export const updateUserSettings = async (updates: Partial<UserSettings>) => {
    try {
        const current = await getGlobalStats() || { lastEstimatedCharRate: 15 };
        const newSettings = { ...current, ...updates };
        await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(newSettings));
    } catch (e) {
        console.warn("Failed to update user settings", e);
    }
};

export const saveGlobalStats = async (rate: number) => {
    return updateUserSettings({ lastEstimatedCharRate: rate });
};

export const getGlobalStats = async (): Promise<UserSettings | null> => {
    try {
        const info = await FileSystem.getInfoAsync(SETTINGS_FILE);
        if (!info.exists) return null;
        const content = await FileSystem.readAsStringAsync(SETTINGS_FILE);
        return JSON.parse(content);
    } catch (e) {
        return null;
    }
};

// --- FOLDER MANAGEMENT ---

// Internal helper to get raw folders with migration
const getRawFolders = async (): Promise<Folder[]> => {
    try {
        const info = await FileSystem.getInfoAsync(FOLDERS_FILE);
        if (!info.exists) return [];
        const content = await FileSystem.readAsStringAsync(FOLDERS_FILE);
        const parsed = JSON.parse(content);

        // Migration: If string array, convert to BOOK folders
        if (parsed.length > 0 && typeof parsed[0] === 'string') {
            const migrated: Folder[] = parsed.map((p: string) => ({ path: p, type: 'BOOK' }));
            // Save immediately
            await FileSystem.writeAsStringAsync(FOLDERS_FILE, JSON.stringify(migrated));
            return migrated;
        }

        return parsed as Folder[];
    } catch (e) {
        return [];
    }
};

export const getFolders = async (type?: 'BOOK' | 'QUIZ'): Promise<string[]> => {
    const folders = await getRawFolders();
    if (!type) return folders.map(f => f.path); // Return all paths if no type specified (backward compat?)
    return folders.filter(f => f.type === type).map(f => f.path);
};

export const createFolder = async (folderPath: string, type: 'BOOK' | 'QUIZ') => {
    try {
        const folders = await getRawFolders();
        // Check for duplicate path AND type ?? Just path uniqueness within type?
        // Let's enforce global uniqueness for simplicity or per type?
        // Per type is better functionality "Math" in Books and "Math" in Quizzes.

        const exists = folders.some(f => f.path === folderPath && f.type === type);

        if (!exists) {
            folders.push({ path: folderPath, type });
            await FileSystem.writeAsStringAsync(FOLDERS_FILE, JSON.stringify(folders));
        }
    } catch (e) {
        console.error("Failed to create folder", e);
    }
};

export const deleteFolder = async (folderPath: string, type: 'BOOK' | 'QUIZ') => {
    try {
        const folders = await getRawFolders();
        // Delete the folder AND all subfolders of that type
        const newFolders = folders.filter(f => {
            const isTargetType = f.type === type;
            const isExact = f.path === folderPath;
            const isSub = f.path.startsWith(folderPath + "/");

            // Should removed if it matches type AND (exact or sub)
            if (isTargetType && (isExact || isSub)) return false;
            return true;
        });

        await FileSystem.writeAsStringAsync(FOLDERS_FILE, JSON.stringify(newFolders));

        // Cleanup Items: Move to Root
        if (type === 'BOOK') {
            const books = await getSavedBooks();
            const toMove = books.filter(b => b.folder === folderPath || b.folder?.startsWith(folderPath + "/"));
            for (const b of toMove) await moveBookToFolder(b.id, "");
        } else {
            const quizzes = await getSavedQuizzes();
            const toMove = quizzes.filter(q => q.folder === folderPath || q.folder?.startsWith(folderPath + "/"));
            for (const q of toMove) await moveQuizToFolder(q.id, "");
        }

    } catch (e) {
        console.error("Failed to delete folder", e);
    }
};

export const moveBookToFolder = async (id: string, folder: string) => {
    try {
        const filename = BOOKS_DIR + id + '.json';
        const content = await FileSystem.readAsStringAsync(filename);
        const book: SavedBook = JSON.parse(content);
        if (folder === "") delete book.folder;
        else book.folder = folder;
        await FileSystem.writeAsStringAsync(filename, JSON.stringify(book));
    } catch (e) {
        console.error("Failed to move book", e);
    }
};

export const moveQuizToFolder = async (id: string, folder: string) => {
    try {
        const filename = QUIZZES_DIR + id + '.json';
        const content = await FileSystem.readAsStringAsync(filename);
        const quiz: SavedQuiz = JSON.parse(content);
        if (folder === "") delete quiz.folder;
        else quiz.folder = folder;
        await FileSystem.writeAsStringAsync(filename, JSON.stringify(quiz));
    } catch (e) {
        console.error("Failed to move quiz", e);
    }
};


// --- BOOK STORAGE ---

export const saveBook = async (title: string, scripts: ScriptItem[], existingId?: string): Promise<string> => {
    await initStorage();
    let id = existingId;
    if (!id) {
        const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        id = `${safeTitle}_${Date.now()}`;
    }
    const filename = BOOKS_DIR + id + '.json';
    const bookData: SavedBook = {
        id,
        title,
        date: new Date().toISOString(),
        scripts
    };
    await FileSystem.writeAsStringAsync(filename, JSON.stringify(bookData));
    return id;
};

export const getSavedBooks = async (): Promise<SavedBook[]> => {
    await initStorage();
    const files = await FileSystem.readDirectoryAsync(BOOKS_DIR);
    const books: SavedBook[] = [];
    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const content = await FileSystem.readAsStringAsync(BOOKS_DIR + file);
                books.push(JSON.parse(content));
            } catch (e) {
                console.warn("Failed to parse book file", file, e);
            }
        }
    }
    return books.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const deleteBook = async (id: string) => {
    await FileSystem.deleteAsync(BOOKS_DIR + id + '.json');
};

export const updateBookProgress = async (id: string, pageIndex: number, progress: number) => {
    try {
        const filename = BOOKS_DIR + id + '.json';
        const fileInfo = await FileSystem.getInfoAsync(filename);
        if (!fileInfo.exists) return;
        const content = await FileSystem.readAsStringAsync(filename);
        const book: SavedBook = JSON.parse(content);
        book.lastPosition = { pageIndex, progress };
        await FileSystem.writeAsStringAsync(filename, JSON.stringify(book));
    } catch (e) {
        console.warn("Failed to update book progress", e);
    }
};

export const renameBook = async (id: string, newTitle: string) => {
    try {
        const filename = BOOKS_DIR + id + '.json';
        const fileInfo = await FileSystem.getInfoAsync(filename);
        if (!fileInfo.exists) return; // Silent fail
        const content = await FileSystem.readAsStringAsync(filename);
        const book: SavedBook = JSON.parse(content);
        book.title = newTitle;
        await FileSystem.writeAsStringAsync(filename, JSON.stringify(book));
    } catch (e) {
        console.error("Failed to rename book", e);
    }
};

// --- QUIZ STORAGE ---

export interface QuizAttempt {
    id: string;
    date: string;
    score: number;
    totalQuestions: number;
    attempted: number;
    userAnswers: { [key: string]: string };
}

export interface SavedQuiz {
    id: string;
    source: string;
    mcqs: any[]; // Or import MCQItem if shared
    userAnswers: { [key: string]: string };
    isSubmitted: boolean;
    date: string;
    score?: number;
    history?: QuizAttempt[];
    shuffleOrder?: number[];
    shuffledOptions?: { [qId: string]: string[] };
    committedAnswers?: { [key: string]: string }; // Answers from previous partial submissions
    analysisReport?: string;
    analysisMeta?: { questionCount: number; timestamp?: number; analyzedQuestionIds?: string[] };
    folder?: string; // New
}

const initQuizStorage = async () => {
    const dirInfo = await FileSystem.getInfoAsync(QUIZZES_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(QUIZZES_DIR, { intermediates: true });
    }
};

export const saveQuiz = async (quiz: Omit<SavedQuiz, 'date'>): Promise<string> => {
    await initQuizStorage();
    const fullQuiz: SavedQuiz = {
        ...quiz,
        date: new Date().toISOString()
    };
    const filename = QUIZZES_DIR + quiz.id + '.json';
    await FileSystem.writeAsStringAsync(filename, JSON.stringify(fullQuiz));
    return quiz.id;
};

export const getSavedQuizzes = async (): Promise<SavedQuiz[]> => {
    await initQuizStorage();
    const files = await FileSystem.readDirectoryAsync(QUIZZES_DIR);
    const quizzes: SavedQuiz[] = [];
    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const content = await FileSystem.readAsStringAsync(QUIZZES_DIR + file);
                quizzes.push(JSON.parse(content));
            } catch (e) {
                console.warn("Failed to parse quiz file", file, e);
            }
        }
    }
    return quizzes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const updateQuizProgress = async (id: string, answers: { [key: string]: string }, isSubmitted: boolean, score?: number, newCommitted?: { [key: string]: string }, analysisReport?: string, analysisMeta?: { questionCount: number; analyzedQuestionIds?: string[] }) => {
    try {
        const filename = QUIZZES_DIR + id + '.json';
        const content = await FileSystem.readAsStringAsync(filename);
        const quiz: SavedQuiz = JSON.parse(content);

        quiz.userAnswers = answers;
        quiz.isSubmitted = isSubmitted;
        if (score !== undefined) quiz.score = score;

        if (newCommitted) {
            quiz.committedAnswers = { ...(quiz.committedAnswers || {}), ...newCommitted };
        }

        if (analysisReport) {
            quiz.analysisReport = analysisReport;
        }
        if (analysisMeta) {
            quiz.analysisMeta = { ...analysisMeta, timestamp: Date.now() };
        }

        await FileSystem.writeAsStringAsync(filename, JSON.stringify(quiz));
    } catch (e) {
        console.error("Failed to update quiz progress", e);
    }
};

export const renameQuiz = async (id: string, newTitle: string) => {
    try {
        const filename = QUIZZES_DIR + id + '.json';
        const content = await FileSystem.readAsStringAsync(filename);
        const quiz: SavedQuiz = JSON.parse(content);
        quiz.source = newTitle; // Resetting source as title? Wait, SavedQuiz doesn't have a separate title field. 'source' is used as title.

        await FileSystem.writeAsStringAsync(filename, JSON.stringify(quiz));
    } catch (e) {
        console.error("Failed to rename quiz", e);
    }
};

export const deleteQuiz = async (id: string) => {
    await FileSystem.deleteAsync(QUIZZES_DIR + id + '.json');
}

export const saveQuizAttempt = async (quizId: string, attempt: QuizAttempt) => {
    try {
        const filename = QUIZZES_DIR + quizId + '.json';
        const content = await FileSystem.readAsStringAsync(filename);
        const quiz: SavedQuiz = JSON.parse(content);

        // Add to history
        if (!quiz.history) quiz.history = [];
        quiz.history.unshift(attempt); // Newest first

        await FileSystem.writeAsStringAsync(filename, JSON.stringify(quiz));
    } catch (e) {
        console.error("Failed to save quiz attempt", e);
    }
};

export const resetQuiz = async (id: string) => {
    try {
        const filename = QUIZZES_DIR + id + '.json';
        const content = await FileSystem.readAsStringAsync(filename);
        const quiz: SavedQuiz = JSON.parse(content);

        quiz.userAnswers = {};
        quiz.isSubmitted = false;
        quiz.score = undefined;
        quiz.history = []; // Clear history
        quiz.committedAnswers = undefined; // Clear committed answers
        quiz.analysisReport = undefined; // Clear analysis
        quiz.analysisMeta = undefined; // Clear analysis meta

        // Clear shuffle to get new order on next load
        quiz.shuffleOrder = undefined;
        quiz.shuffledOptions = undefined;

        await FileSystem.writeAsStringAsync(filename, JSON.stringify(quiz));

    } catch (e) {
        console.error("Failed to reset quiz", e);
    }
};

export const retakeQuiz = async (id: string) => {
    try {
        const filename = QUIZZES_DIR + id + '.json';
        const content = await FileSystem.readAsStringAsync(filename);
        const quiz: SavedQuiz = JSON.parse(content);

        quiz.userAnswers = {};
        quiz.isSubmitted = false;
        quiz.score = undefined;
        // Keep History
        quiz.committedAnswers = undefined;
        quiz.analysisReport = undefined;
        quiz.analysisMeta = undefined;

        // Clear shuffle
        quiz.shuffleOrder = undefined;
        quiz.shuffledOptions = undefined;

        await FileSystem.writeAsStringAsync(filename, JSON.stringify(quiz));
    } catch (e) {
        console.error("Failed to retake quiz", e);
    }
};
