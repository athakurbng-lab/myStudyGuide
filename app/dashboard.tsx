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


    // --- File & Book Handlers --- (Same as before)
    const pickDocument = async () => { /* ... */ };
    const processFile = async () => { /* ... */ };
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

    // Key Handlers (Existing)
    const handleAddKeys = async () => { /* ... */ };
    const handleDeleteKey = async (key: string) => { /* ... */ };


    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { backgroundColor: colors.card, paddingHorizontal: 16 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={[styles.welcomeText, { color: colors.text }]} numberOfLines={1}>My Study Guide</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <TouchableOpacity onPress={() => setShowKeyModal(true)} style={{ padding: 6 }}>
                            <Ionicons name="key-outline" size={22} color={colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={toggleTheme} style={{ padding: 6 }}>
                            <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={22} color={colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={logout} style={{ padding: 6 }}>
                            <Ionicons name="log-out-outline" size={22} color={colors.error} />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Navigation/Breadcrumbs */}
                {currentFolder && (
                    <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                        <Text style={{ color: colors.text, fontWeight: 'bold', marginLeft: 5 }}>
                            {currentFolder.split('/').length > 1 ? 'Back' : 'Home'}
                        </Text>
                        <Text style={{ color: colors.subtext, marginLeft: 10 }}>/ {currentFolder}</Text>
                    </TouchableOpacity>
                )}

                {/* Files Tabs */}
                <View style={{ flexDirection: 'row', backgroundColor: isDark ? '#2C2C2C' : '#E0E0E0', borderRadius: 12, padding: 4, marginBottom: 20 }}>
                    <TouchableOpacity
                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: viewMode === 'BOOKS' ? (isDark ? '#404040' : '#FFF') : 'transparent', alignItems: 'center' }}
                        onPress={() => { setViewMode('BOOKS'); setCurrentFolder(null); }} // Reset folder on tab switch
                    >
                        <Text style={{ fontWeight: 'bold', color: viewMode === 'BOOKS' ? colors.text : colors.subtext }}>Saved Books</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: viewMode === 'QUIZZES' ? (isDark ? '#404040' : '#FFF') : 'transparent', alignItems: 'center' }}
                        onPress={() => { setViewMode('QUIZZES'); setCurrentFolder(null); }} // Reset folder on tab switch
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
                                    // delayLongPress={500}
                                    onLongPress={() => handleDeleteFolder(folderPath)}
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
                                        onLongPress={() => {
                                            Alert.alert("Options", book.title, [
                                                { text: "Rename", onPress: () => promptRename('BOOK', book.id, book.title) },
                                                { text: "Move to Folder", onPress: () => promptMove('BOOK', book.id) },
                                                { text: "Cancel", style: "cancel" }
                                            ])
                                        }}
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
                                            onLongPress={() => {
                                                Alert.alert("Options", quiz.source, [
                                                    { text: "Rename", onPress: () => promptRename('QUIZ', quiz.id, quiz.source) },
                                                    { text: "Move to Folder", onPress: () => promptMove('QUIZ', quiz.id) },
                                                    { text: "Cancel", style: "cancel" }
                                                ])
                                            }}
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
                </View>
            </ScrollView>

            {/* Move & Create Folder Modal */}
            <Modal visible={showMoveModal} transparent animationType="slide">
                <View style={[styles.modalOverlay, { justifyContent: 'flex-end', padding: 0 }]}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', padding: 0 }]}>
                        {/* Header */}
                        <View style={{ padding: 15, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <TouchableOpacity onPress={() => {
                                if (!moveModalFolder) setShowMoveModal(false);
                                else {
                                    // Go back logic
                                    const parts = moveModalFolder.split('/');
                                    if (parts.length === 1) setMoveModalFolder(null);
                                    else setMoveModalFolder(parts.slice(0, -1).join('/'));
                                }
                            }}>
                                <Ionicons name={moveModalFolder ? "arrow-back" : "close"} size={24} color={colors.text} />
                            </TouchableOpacity>
                            <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 0 }]}>
                                {moveModalFolder ? moveModalFolder.split('/').pop() : "Home (Root)"}
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

                        <ScrollView style={{ padding: 15 }}>
                            <TouchableOpacity onPress={handleMoveConfirm} style={{ padding: 15, marginBottom: 10, backgroundColor: colors.primary + '20', borderRadius: 12, alignItems: 'center' }}>
                                <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Move Here</Text>
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
            </Modal>

            {/* Rename Modal (Existing) */}
            <Modal visible={showRenameModal} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card, margin: 20 }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Rename</Text>
                        <TextInput
                            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#333' : '#f9f9f9' }]}
                            value={renameText}
                            onChangeText={setRenameText}
                            autoFocus
                        />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity onPress={() => setShowRenameModal(false)} style={styles.cancelBtn}>
                                <Text style={{ color: colors.subtext }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={confirmRename} style={[styles.confirmBtn, { backgroundColor: colors.primary }]}>
                                <Text style={{ color: '#fff' }}>Save</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Key Modal (Existing) ... */}
            <Modal visible={showKeyModal} transparent animationType="slide">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card, maxHeight: '80%', margin: 20 }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Manage API Keys</Text>
                        <TextInput
                            style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: isDark ? '#333' : '#f9f9f9', height: 100, textAlignVertical: 'top' }]}
                            value={keyInput} onChangeText={setKeyInput} multiline numberOfLines={4}
                        />
                        <TouchableOpacity style={[styles.modalButton, { backgroundColor: colors.primary }]} onPress={handleAddKeys}><Text style={styles.modalButtonText}>Add Keys</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => setShowKeyModal(false)} style={{ marginTop: 20, alignItems: 'center' }}><Text style={{ color: colors.primary }}>Close</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View >
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 24, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: 'transparent' },
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
});
