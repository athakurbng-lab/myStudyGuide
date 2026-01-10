import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Modal, TextInput, Alert, Image, BackHandler } from 'react-native';

// ... (existing imports) 



import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { processPdfAndGenerateScript, addMultipleKeys, getKeyCount, getAllKeys, deleteKey } from '../src/services/gemini';
import { useRouter, useFocusEffect } from 'expo-router';
import {
    saveBook, getSavedBooks, SavedBook, deleteBook,
    getSavedQuizzes, SavedQuiz, deleteQuiz,
    renameBook, renameQuiz,
    getFolders, createFolder, deleteFolder, moveBookToFolder, moveQuizToFolder
} from '../src/services/storage';
import { useTheme } from '../src/context/ThemeContext';
import { useAuth } from '../src/context/AuthContext';

declare var global: any;

import { shareBook, shareQuiz, shareFolder, importSharedFile } from '../src/services/sharing';
import * as Linking from 'expo-linking';

export default function Dashboard() {
    const { colors, toggleTheme, isDark } = useTheme();
    const { logout } = useAuth();
    const router = useRouter();

    // Data State
    const [savedBooks, setSavedBooks] = useState<SavedBook[]>([]);
    const [savedQuizzes, setSavedQuizzes] = useState<SavedQuiz[]>([]);

    // Split folders by type
    const [bookFolders, setBookFolders] = useState<string[]>([]);
    const [quizFolders, setQuizFolders] = useState<string[]>([]);

    // UI State
    const [currentFolder, setCurrentFolder] = useState<string | null>(null); // Current navigation path
    const [viewMode, setViewMode] = useState<'BOOKS' | 'QUIZZES'>('BOOKS');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState("");
    const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);

    // Key Management State
    const [showKeyModal, setShowKeyModal] = useState(false);
    const [keyInput, setKeyInput] = useState("");
    const [keyCount, setKeyCount] = useState(0);
    const [keyList, setKeyList] = useState<string[]>([]);

    // Rename State
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [renameText, setRenameText] = useState("");
    const [renameTarget, setRenameTarget] = useState<{ type: 'BOOK' | 'QUIZ', id: string } | null>(null);

    // Move & Create Folder State
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [moveTarget, setMoveTarget] = useState<{ type: 'BOOK' | 'QUIZ', id: string } | null>(null);
    const [moveModalFolder, setMoveModalFolder] = useState<string | null>(null); // Navigation inside Modal
    const [creatingFolderInModal, setCreatingFolderInModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    // Options Modal State
    const [showOptionsModal, setShowOptionsModal] = useState(false);
    const [optionsTarget, setOptionsTarget] = useState<{ id: string, title?: string, type: 'BOOK' | 'QUIZ' | 'FOLDER' } | null>(null);

    useFocusEffect(
        useCallback(() => {
            loadData();
            refreshKeyData();
        }, [currentFolder, viewMode])
    );

    const refreshKeyData = () => {
        setKeyCount(getKeyCount());
        setKeyList(getAllKeys());
    };

    const loadData = async () => {
        try {
            const [books, quizzes, bFolders, qFolders] = await Promise.all([
                getSavedBooks(),
                getSavedQuizzes(),
                getFolders('BOOK'),
                getFolders('QUIZ')
            ]);
            setSavedBooks(books);
            setSavedQuizzes(quizzes);
            setBookFolders(bFolders.sort());
            setQuizFolders(qFolders.sort());
        } catch (e) {
            console.error("Failed to load data", e);
        }
    };

    // --- Helpers for Nested Folders ---

    // Get direct subfolders of a given parent path
    const getSubFolders = (parentPath: string | null, sourceFolders: string[]) => {
        return sourceFolders.filter(f => {
            if (parentPath === null) {
                return !f.includes('/'); // Root folders have no slashes
            }
            return f.startsWith(parentPath + '/') && f.split('/').length === parentPath.split('/').length + 1;
        });
    };

    // Derived States
    const filteredBooks = useMemo(() => savedBooks.filter(b => b.folder === (currentFolder || undefined)), [savedBooks, currentFolder]);
    const filteredQuizzes = useMemo(() => savedQuizzes.filter(q => q.folder === (currentFolder || undefined)), [savedQuizzes, currentFolder]);

    // Choose which folders to show based on View Mode
    const activeFolders = viewMode === 'BOOKS' ? bookFolders : quizFolders;
    const currentSubFolders = useMemo(() => getSubFolders(currentFolder, activeFolders), [currentFolder, activeFolders]);


    // --- File & Book Handlers ---
    const pickDocument = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
            if (result.assets && result.assets.length > 0) {
                setFile(result.assets[0]);
                // Auto-process or let user confirm? Original flow likely auto-processed or had a button.
                // Assuming "Import PDF" button triggers pick, then we process.
                // Actually, let's just pick and then immediately process if valid.
                processFile(result.assets[0]);
            }
        } catch (err) {
            console.log(err);
        }
    };

    const processFile = async (pickedFile: DocumentPicker.DocumentPickerAsset) => {
        if (!pickedFile) return;
        if (getKeyCount() === 0) { Alert.alert("No API Keys", "Please add at least one Gemini API Key first."); setShowKeyModal(true); return; }

        setLoading(true);
        setProgress("Parsing PDF...");

        try {
            // Read file as Base64
            const base64 = await FileSystem.readAsStringAsync(pickedFile.uri, { encoding: 'base64' });
            const scripts = await processPdfAndGenerateScript(base64, (current, total) => setProgress(`Processing Page ${current}/${total}`));
            // Save Book
            const bookId = await saveBook(pickedFile.name.replace('.pdf', ''), scripts);
            setLoading(false);
            setFile(null);
            loadData();
            Alert.alert("Success", "Book processed and added to library!");
        } catch (error: any) {
            setLoading(false);
            Alert.alert("Error", "Failed to process PDF: " + error.message);
        }
    };
    const openSavedBook = (book: SavedBook) => {
        (global as any).currentScripts = book.scripts;
        (global as any).currentBookTitle = book.title;
        (global as any).currentBookId = book.id;
        if (book.lastPosition) { (global as any).currentInitialPage = book.lastPosition.pageIndex; (global as any).currentInitialProgress = book.lastPosition.progress; }
        else { (global as any).currentInitialPage = 0; (global as any).currentInitialProgress = 0; }
        router.push('/player');
    };
    const handleDelete = async (id: string) => { await deleteBook(id); loadData(); };

    // --- Quiz Handlers --- (Same as before)
    const getQuizScore = (quiz: SavedQuiz) => {
        if (quiz.score !== undefined) return quiz.score;
        const committedCount = Object.keys(quiz.committedAnswers || {}).length;
        const totalQ = quiz.mcqs.length;
        if (quiz.isSubmitted || committedCount === totalQ) {
            let correct = 0, wrong = 0;
            const answersToCheck = quiz.committedAnswers || quiz.userAnswers || {};
            quiz.mcqs.forEach((q: any) => { const userAns = answersToCheck[q.id]; if (userAns) { if (userAns === q.answer) correct++; else wrong++; } });
            return parseFloat(((correct * 2) - (wrong * (2 / 3))).toFixed(2));
        }
        return null;
    };
    const openQuiz = (quiz: SavedQuiz) => { (global as any).currentQuizId = quiz.id; router.push('/quiz/game'); };
    const handleDeleteQuiz = async (id: string) => { await deleteQuiz(id); loadData(); };

    // --- Folder Handlers ---

    // Main View Navigation
    const enterFolder = (folderName: string) => {
        setCurrentFolder(folderName);
    };

    const goBack = () => {
        if (!currentFolder) return;
        const parts = currentFolder.split('/');
        if (parts.length === 1) setCurrentFolder(null); // Back to root
        else setCurrentFolder(parts.slice(0, -1).join('/')); // Up one level
    };

    useFocusEffect(
        useCallback(() => {
            const onBackPress = () => {
                if (currentFolder) {
                    goBack();
                    return true;
                }
                BackHandler.exitApp();
                return true;
            };

            const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);

            return () => subscription.remove();
        }, [currentFolder])
    );

    const handleDeleteFolder = async (folderPath: string) => {
        // Determine type based on current view mode
        const type = viewMode === 'BOOKS' ? 'BOOK' : 'QUIZ';

        Alert.alert(
            "Delete Folder",
            `Are you sure you want to delete "${folderPath}"?\nItems inside will be moved to Home.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete", style: "destructive", onPress: async () => {
                        await deleteFolder(folderPath, type);
                        loadData();
                        // If we were inside that folder, go up
                        if (currentFolder === folderPath || currentFolder?.startsWith(folderPath + "/")) {
                            setCurrentFolder(null);
                        }
                    }
                }
            ]
        );
    };


    // --- Move Modal & Creation Logic ---
    const promptMove = (type: 'BOOK' | 'QUIZ', id: string) => {
        setMoveTarget({ type, id });
        setMoveModalFolder(null); // Start at root
        setCreatingFolderInModal(false);
        setNewFolderName("");
        setShowMoveModal(true);
    };

    const handleCreateFolderInModal = async () => {
        if (!newFolderName.trim() || !moveTarget) return;

        // Construct Path
        const path = moveModalFolder ? `${moveModalFolder}/${newFolderName.trim()}` : newFolderName.trim();
        const type = moveTarget.type; // 'BOOK' or 'QUIZ'

        await createFolder(path, type);
        await loadData();
        setNewFolderName("");
        setCreatingFolderInModal(false);
    };

    const handleMoveConfirm = async () => {
        if (!moveTarget) return;
        const targetFolder = moveModalFolder || ""; // empty for root

        if (moveTarget.type === 'BOOK') await moveBookToFolder(moveTarget.id, targetFolder);
        else await moveQuizToFolder(moveTarget.id, targetFolder);

        setShowMoveModal(false);
        setMoveTarget(null);
        loadData();
    };

    // --- Rename Handlers ---
    const promptRename = (type: 'BOOK' | 'QUIZ', id: string, currentTitle: string) => { setRenameTarget({ type, id }); setRenameText(currentTitle); setShowRenameModal(true); };
    const confirmRename = async () => { /* ... existing ... */
        if (!renameTarget || !renameText.trim()) return;
        if (renameTarget.type === 'BOOK') await renameBook(renameTarget.id, renameText.trim());
        else await renameQuiz(renameTarget.id, renameText.trim());
        setShowRenameModal(false); setRenameTarget(null); setRenameText(""); loadData();
    };

    // Key Handlers
    const handleAddKeys = async () => {
        if (!keyInput.trim()) { Alert.alert("Error", "Please enter at least one API key."); return; }
        // Split by newline OR comma
        const keys = keyInput.trim().split(/[\n,]+/).map(k => k.trim()).filter(k => k);
        try {
            await addMultipleKeys(keys);
            refreshKeyData();
            setKeyInput("");
            Alert.alert("Success", `${keys.length} keys added.`);
            setShowKeyModal(false);
        } catch (e: any) {
            Alert.alert("Error", "Failed to add keys: " + e.message);
        }
    };

    const handleDeleteKey = async (key?: string) => {
        if (key) {
            await deleteKey(key);
        } else {
            // If no key is passed, assume delete all
            const allKeys = getAllKeys();
            for (const k of allKeys) {
                await deleteKey(k);
            }
        }
        refreshKeyData();
    };

    // URL Handler for Imports
    useFocusEffect(
        useCallback(() => {
            const handleDeepLink = async (event: { url: string }) => {
                if (event.url) {
                    // Ignore Expo Go development URLs
                    if (event.url.startsWith('exp://')) return;

                    console.log("Deep link received:", event.url);
                    setLoading(true);
                    setProgress("Importing...");
                    try {
                        await importSharedFile(event.url);
                        loadData();
                        Alert.alert("Success", "Import completed successfully.");
                    } catch (e: any) {
                        console.error("Import error", e);
                        Alert.alert("Error", "Import failed: " + e.message);
                    } finally {
                        setLoading(false);
                    }
                }
            };
            Linking.addEventListener('url', handleDeepLink);
            Linking.getInitialURL().then((url) => { if (url) handleDeepLink({ url }); });
        }, [])
    );

    const handleLongPress = (target: { id: string, title?: string, type: 'BOOK' | 'QUIZ' | 'FOLDER' }) => {
        setOptionsTarget(target);
        setShowOptionsModal(true);
    };

    const handleOptionAction = (action: 'RENAME' | 'SHARE' | 'MOVE' | 'DELETE') => {
        setShowOptionsModal(false);
        if (!optionsTarget) return;

        setTimeout(() => { // Small delay to allow modal to close smoothly
            switch (action) {
                case 'RENAME':
                    if (optionsTarget.type === 'FOLDER') promptRename(viewMode === 'BOOKS' ? 'BOOK' : 'QUIZ', optionsTarget.id, optionsTarget.title || "");
                    else promptRename(optionsTarget.type as any, optionsTarget.id, optionsTarget.title || "");
                    break;
                case 'SHARE':
                    if (optionsTarget.type === 'FOLDER') shareFolder(optionsTarget.id, viewMode === 'BOOKS' ? 'BOOK' : 'QUIZ');
                    else if (optionsTarget.type === 'BOOK') {
                        // finding book is expensive? Pass object? 
                        // We need full object for share.
                        const b = filteredBooks.find(b => b.id === optionsTarget.id);
                        if (b) shareBook(b);
                    } else if (optionsTarget.type === 'QUIZ') {
                        const q = filteredQuizzes.find(q => q.id === optionsTarget.id);
                        if (q) shareQuiz(q);
                    }
                    break;
                case 'MOVE':
                    if (optionsTarget.type === 'FOLDER') Alert.alert("Cannot move folders yet.");
                    else promptMove(optionsTarget.type as 'BOOK' | 'QUIZ', optionsTarget.id);
                    break;
                case 'DELETE':
                    if (optionsTarget.type === 'FOLDER') handleDeleteFolder(optionsTarget.id);
                    else if (optionsTarget.type === 'BOOK') handleDelete(optionsTarget.id);
                    else handleDeleteQuiz(optionsTarget.id);
                    break;
            }
        }, 300);
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header: Icons Top, Title Below */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                {/* Icons Row: Centered floating card */}
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <View style={{
                        flexDirection: 'row',
                        backgroundColor: colors.card,
                        paddingVertical: 12,
                        paddingHorizontal: 30,
                        borderRadius: 30,
                        gap: 30,
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.1,
                        shadowRadius: 8,
                        elevation: 4,
                        borderWidth: 1,
                        borderColor: isDark ? '#444' : '#eee'
                    }}>
                        <TouchableOpacity onPress={() => setShowKeyModal(true)} style={{ padding: 5 }}>
                            <Ionicons name="key-outline" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={toggleTheme} style={{ padding: 5 }}>
                            <Ionicons name={isDark ? "moon" : "sunny"} size={26} color={colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={logout} style={{ padding: 5 }}>
                            <Ionicons name="log-out-outline" size={24} color={colors.error} />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Title */}
                <View>
                    <Text style={[styles.title, { color: colors.text }]}>My Study Guide</Text>
                    <Text style={{ color: colors.subtext }}>Your AI Companion</Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>

                {/* Action Buttons */}
                <View style={{ flexDirection: 'row', gap: 15, marginBottom: 25 }}>
                    <TouchableOpacity style={[styles.actionCard, { backgroundColor: colors.card }]} onPress={pickDocument}>
                        <View style={[styles.actionIcon, { backgroundColor: '#E3F2FD' }]}>
                            <Ionicons name="cloud-upload" size={24} color="#2196F3" />
                        </View>
                        <Text style={[styles.actionText, { color: colors.text }]}>Import PDF</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.actionCard, { backgroundColor: colors.card }]} onPress={() => router.push('/quiz/input')}>
                        <View style={[styles.actionIcon, { backgroundColor: '#FFF3E0' }]}>
                            <Ionicons name="school" size={24} color="#FF9800" />
                        </View>
                        <Text style={[styles.actionText, { color: colors.text }]}>Take Quiz</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.actionCard, { backgroundColor: colors.card }]} onPress={() => router.push('/chat')}>
                        <View style={[styles.actionIcon, { backgroundColor: '#E8F5E9' }]}>
                            <Ionicons name="chatbubbles" size={24} color="#4CAF50" />
                        </View>
                        <Text style={[styles.actionText, { color: colors.text }]}>Chat</Text>
                    </TouchableOpacity>
                </View>

                {/* Navigation/Breadcrumbs */}
                {currentFolder && (
                    <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
                        <Ionicons name="arrow-back" size={24} color={colors.primary} />
                        <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.primary, marginLeft: 5 }}>
                            {currentFolder.split('/').pop()}
                        </Text>
                    </TouchableOpacity>
                )}

                {/* Files Tabs */}
                <View style={{ flexDirection: 'row', backgroundColor: isDark ? '#2C2C2C' : '#E0E0E0', borderRadius: 12, padding: 4, marginBottom: 20 }}>
                    <TouchableOpacity
                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: viewMode === 'BOOKS' ? (isDark ? '#404040' : '#FFF') : 'transparent', alignItems: 'center' }}
                        onPress={() => { setViewMode('BOOKS'); setCurrentFolder(null); }}
                    >
                        <Text style={{ fontWeight: 'bold', color: viewMode === 'BOOKS' ? colors.text : colors.subtext }}>Saved Books</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: viewMode === 'QUIZZES' ? (isDark ? '#404040' : '#FFF') : 'transparent', alignItems: 'center' }}
                        onPress={() => { setViewMode('QUIZZES'); setCurrentFolder(null); }}
                    >
                        <Text style={{ fontWeight: 'bold', color: viewMode === 'QUIZZES' ? colors.text : colors.subtext }}>Saved Quizzes</Text>
                    </TouchableOpacity>
                </View>

                {/* Content List: Folders on TOP, then Files */}
                <View style={styles.savedSection}>
                    {/* Folders (Rendered as Rows) */}
                    {currentSubFolders.map(folderPath => {
                        const displayName = folderPath.split('/').pop();
                        return (
                            <View key={folderPath} style={[styles.bookCard, { backgroundColor: colors.card, borderLeftWidth: 4, borderLeftColor: '#FFCA28' }]}>
                                <TouchableOpacity
                                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 15 }}
                                    onPress={() => enterFolder(folderPath)}
                                    onLongPress={() => handleLongPress({ id: folderPath, title: displayName, type: 'FOLDER' })}
                                >
                                    <View style={[styles.bookIcon, { backgroundColor: 'transparent', width: 32 }]}>
                                        <Ionicons name="folder" size={32} color="#FFCA28" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.bookTitle, { color: colors.text }]}>{displayName}</Text>
                                        <Text style={{ color: colors.subtext, fontSize: 12 }}>Folder</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={24} color={colors.subtext} />
                                </TouchableOpacity>
                            </View>
                        );
                    })}


                    {viewMode === 'BOOKS' ? (
                        filteredBooks.length === 0 && currentSubFolders.length === 0 ? (
                            <Text style={styles.emptyText}>No books in this folder.</Text>
                        ) :
                            filteredBooks.map((book) => (
                                <View key={book.id} style={[styles.bookCard, { backgroundColor: colors.card }]}>
                                    <TouchableOpacity
                                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 15 }}
                                        onPress={() => openSavedBook(book)}
                                        delayLongPress={500}
                                        onLongPress={() => handleLongPress({ id: book.id, title: book.title, type: 'BOOK' })}
                                    >
                                        <View style={styles.bookIcon}>
                                            <Ionicons name="book" size={24} color="#fff" />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.bookTitle, { color: colors.text }]}>{book.title}</Text>
                                            <Text style={[styles.bookDate, { color: colors.subtext }]}>{new Date(book.date).toLocaleDateString()} - {book.scripts.length} Pages</Text>
                                        </View>
                                        <Ionicons name="play-circle" size={32} color={colors.primary} />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => handleDelete(book.id)} style={{ padding: 10 }}>
                                        <Ionicons name="trash-outline" size={24} color={colors.error} />
                                    </TouchableOpacity>
                                </View>
                            ))
                    ) : (
                        filteredQuizzes.length === 0 && currentSubFolders.length === 0 ? (
                            <Text style={styles.emptyText}>No quizzes in this folder.</Text>
                        ) :
                            filteredQuizzes.map((quiz) => {
                                const displayScore = getQuizScore(quiz);
                                const answeredCount = Object.keys(quiz.committedAnswers || quiz.userAnswers || {}).length;
                                const totalQ = quiz.mcqs.length;
                                const isCompleted = quiz.isSubmitted || (answeredCount === totalQ);
                                let statusText = isCompleted ? `Score: ${displayScore ?? 'Err'}` : (answeredCount > 0 ? `Resume • ${answeredCount}/${totalQ}` : "Unattempted");
                                let iconColor = isCompleted ? '#FF9800' : (answeredCount > 0 ? '#FFC107' : colors.primary);

                                return (
                                    <View key={quiz.id} style={[styles.bookCard, { backgroundColor: colors.card }]}>
                                        <TouchableOpacity
                                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 15 }}
                                            onPress={() => openQuiz(quiz)}
                                            delayLongPress={500}
                                            onLongPress={() => handleLongPress({ id: quiz.id, title: quiz.source, type: 'QUIZ' })}
                                        >
                                            <View style={[styles.bookIcon, { backgroundColor: iconColor }]}>
                                                <Ionicons name={isCompleted ? "school" : "school-outline"} size={24} color="#fff" />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.bookTitle, { color: colors.text }]} numberOfLines={1}>{quiz.source}</Text>
                                                <Text style={[styles.bookDate, { color: colors.subtext }]}>{new Date(quiz.date).toLocaleDateString()} • {statusText}</Text>
                                            </View>
                                            <Ionicons name={isCompleted ? "ribbon-outline" : "play-circle"} size={32} color={iconColor} />
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => handleDeleteQuiz(quiz.id)} style={{ padding: 10 }}>
                                            <Ionicons name="trash-outline" size={24} color={colors.error} />
                                        </TouchableOpacity>
                                    </View>
                                );
                            })
                    )}
                </View >
            </ScrollView >

            {/* Options Modal containing Rename, Move, Share, Delete */}
            <Modal visible={showOptionsModal} transparent animationType="fade">
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOptionsModal(false)}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card, padding: 20, margin: 40 }]}>
                        <Text style={[styles.modalTitle, { color: colors.text, textAlign: 'center' }]}>{optionsTarget?.title || "Options"}</Text>

                        <TouchableOpacity onPress={() => handleOptionAction('RENAME')} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                            <Text style={{ fontSize: 16, color: colors.text, textAlign: 'center' }}>Rename</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => handleOptionAction('MOVE')} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                            <Text style={{ fontSize: 16, color: colors.text, textAlign: 'center' }}>Move to Folder</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => handleOptionAction('SHARE')} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                            <Text style={{ fontSize: 16, color: colors.text, textAlign: 'center' }}>Share {optionsTarget?.type === 'FOLDER' ? 'Folder' : ''}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => handleOptionAction('DELETE')} style={{ paddingVertical: 12 }}>
                            <Text style={{ fontSize: 16, color: colors.error, textAlign: 'center' }}>Delete</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => setShowOptionsModal(false)} style={{ marginTop: 10, paddingVertical: 10, backgroundColor: colors.border, borderRadius: 8 }}>
                            <Text style={{ textAlign: 'center', fontWeight: 'bold', color: colors.text }}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>


            {/* Move & Create Folder Modal */}
            < Modal visible={showMoveModal} transparent animationType="slide" >
                <View style={[styles.modalOverlay, { justifyContent: 'flex-end', padding: 0 }]}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', padding: 0 }]}>
                        {/* Header */}
                        <View style={{ padding: 15, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <TouchableOpacity onPress={() => {
                                if (!moveModalFolder) setShowMoveModal(false);
                                else {
                                    // Go back logic
                                    const parts = moveModalFolder.split('/');
                                    parts.pop();
                                    setMoveModalFolder(parts.length > 0 ? parts.join('/') : null);
                                }
                            }}>
                                <Ionicons name={moveModalFolder ? "arrow-back" : "close"} size={24} color={colors.text} />
                            </TouchableOpacity>
                            <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.text }}>
                                {moveModalFolder ? moveModalFolder.split('/').pop() : "Move to..."}
                            </Text>
                            <TouchableOpacity onPress={() => setCreatingFolderInModal(prev => !prev)}>
                                <Ionicons name={creatingFolderInModal ? "close-circle" : "add-circle"} size={28} color={colors.primary} />
                            </TouchableOpacity>
                        </View>

                        {/* Create Folder Input (Inline) */}
                        {creatingFolderInModal && (
                            <View style={{ padding: 15, backgroundColor: isDark ? '#333' : '#f9f9f9', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                                <TextInput
                                    style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: colors.background }]}
                                    value={newFolderName}
                                    onChangeText={setNewFolderName}
                                    placeholder="New Folder Name"
                                    autoFocus
                                />
                                <TouchableOpacity onPress={handleCreateFolderInModal} style={{ padding: 10, backgroundColor: colors.primary, borderRadius: 8 }}>
                                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>Create</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        <ScrollView contentContainerStyle={{ padding: 10 }}>
                            {/* Current Folder Indicator */}
                            {moveModalFolder && (
                                <Text style={{ color: colors.subtext, marginBottom: 10 }}>Location: /{moveModalFolder}</Text>
                            )}

                            {/* "Move Here" Button */}
                            <TouchableOpacity
                                onPress={handleMoveConfirm}
                                style={{ backgroundColor: colors.primary, padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 20 }}
                            >
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Move Here</Text>
                            </TouchableOpacity>

                            <Text style={{ color: colors.subtext, marginBottom: 10 }}>Sub-folders:</Text>
                            {/* Filter folders in modal based on TARGET TYPE */}
                            {getSubFolders(moveModalFolder, moveTarget?.type === 'BOOK' ? bookFolders : quizFolders).map(f => (
                                <TouchableOpacity key={f} onPress={() => setMoveModalFolder(f)} style={{ padding: 15, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                    <Ionicons name="folder" size={20} color="#FFCA28" />
                                    <Text style={{ color: colors.text }}>{f.split('/').pop()}</Text>
                                    <Ionicons name="chevron-forward" size={16} color={colors.subtext} style={{ marginLeft: 'auto' }} />
                                </TouchableOpacity>
                            ))}
                            {getSubFolders(moveModalFolder, moveTarget?.type === 'BOOK' ? bookFolders : quizFolders).length === 0 && (
                                <Text style={{ textAlign: 'center', color: colors.subtext, fontStyle: 'italic', padding: 20 }}>No sub-folders</Text>
                            )}
                        </ScrollView>
                    </View>
                </View>
            </Modal >

            {/* Rename Modal (Existing) */}
            < Modal visible={showRenameModal} transparent animationType="fade" >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card, margin: 20 }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Rename</Text>
                        <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#333' : '#f9f9f9' }]} value={renameText} onChangeText={setRenameText} autoFocus />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity onPress={() => setShowRenameModal(false)} style={styles.cancelBtn}><Text style={{ color: colors.subtext }}>Cancel</Text></TouchableOpacity>
                            <TouchableOpacity onPress={confirmRename} style={[styles.confirmBtn, { backgroundColor: colors.primary }]}><Text style={{ color: '#fff' }}>Save</Text></TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* KEY MODAL - UPDATED */}
            < Modal visible={showKeyModal} transparent animationType="slide" >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card, maxHeight: '80%', margin: 20 }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Manage API Keys</Text>
                        <TextInput
                            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#333' : '#f9f9f9', height: 100, textAlignVertical: 'top' }]}
                            value={keyInput}
                            onChangeText={setKeyInput}
                            multiline
                            numberOfLines={4}
                            placeholder="Enters keys separated by commas or newlines"
                            placeholderTextColor={colors.subtext}
                        />
                        <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.primary }]} onPress={handleAddKeys}>
                            <Text style={styles.modalButtonText}>Add Keys</Text>
                        </TouchableOpacity>

                        <Text style={{ marginTop: 20, marginBottom: 10, fontWeight: 'bold', color: colors.text }}>Current Keys ({keyCount}):</Text>
                        <ScrollView style={{ maxHeight: 150, backgroundColor: isDark ? '#333' : '#f5f5f5', borderRadius: 8, padding: 10 }}>
                            {keyList.length === 0 ? (
                                <Text style={{ color: colors.subtext, fontStyle: 'italic' }}>No keys added.</Text>
                            ) : (
                                keyList.map((k, i) => (
                                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                        <Text style={{ color: colors.text, fontFamily: 'monospace' }}>
                                            {k.length > 8 ? k.substring(0, 8) + '...' + k.substring(k.length - 4) : k}
                                        </Text>
                                        <TouchableOpacity onPress={() => handleDeleteKey(k)}>
                                            <Ionicons name="trash-outline" size={16} color={colors.error} />
                                        </TouchableOpacity>
                                    </View>
                                ))
                            )}
                        </ScrollView>

                        <TouchableOpacity onPress={() => handleDeleteKey()} style={{ marginTop: 15, padding: 10, alignItems: 'center' }}><Text style={{ color: colors.error }}>Remove All Keys</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => setShowKeyModal(false)} style={{ marginTop: 10, alignItems: 'center' }}><Text style={{ color: colors.primary }}>Close</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal >
        </View >
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 24, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: 'transparent' },
    title: { fontSize: 28, fontWeight: '800', marginBottom: 5 },
    welcomeText: { fontSize: 28, fontWeight: '800' },
    scrollContent: { padding: 20 },
    savedSection: {},
    emptyText: { fontStyle: 'italic', textAlign: 'center', marginTop: 20, color: '#999' },
    bookCard: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 12, marginBottom: 10, shadowOpacity: 0.05, shadowRadius: 5 },
    bookIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#FF7043', alignItems: 'center', justifyContent: 'center' },
    bookTitle: { fontSize: 16, fontWeight: '600' },
    bookDate: { fontSize: 12, marginTop: 2 },
    modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
    modalContent: { width: '100%', borderRadius: 16, elevation: 5 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
    input: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 20 },
    modalButton: { paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
    modalButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 15, alignItems: 'center' },
    cancelBtn: { padding: 10 },
    confirmBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
    actionCard: { flex: 1, padding: 15, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
    actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    actionText: { fontWeight: '600', fontSize: 13 },
});
