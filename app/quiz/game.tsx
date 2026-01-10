import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Alert, SafeAreaView, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { getSavedQuizzes, updateQuizProgress, SavedQuiz, saveQuizAttempt, QuizAttempt } from '../../src/services/storage';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const QUIZZES_DIR = FileSystem.documentDirectory + 'saved_quizzes/';

declare var global: any;

interface MCQItem {
    id: number | string;
    question: string;
    options: { [key: string]: string };
    answer: string;
    explanation?: string;
}

export default function QuizGameScreen() {
    const { colors, isDark } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // State
    const [quizData, setQuizData] = useState<SavedQuiz | null>(null);
    const [shuffledIndices, setShuffledIndices] = useState<number[]>([]);
    const [shuffledOptionsMap, setShuffledOptionsMap] = useState<{ [qId: string]: string[] }>({});
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<{ [key: string]: string }>({});
    const [showJumpModal, setShowJumpModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    // Derived history from quizData
    const history = quizData?.history || [];

    useEffect(() => {
        loadQuiz();
    }, []);

    const loadQuiz = async () => {
        const id = (global as any).currentQuizId;
        if (!id) {
            router.back();
            return;
        }

        // Fetch fresh from storage
        const all = await getSavedQuizzes();
        const found = all.find(q => q.id === id);

        if (found) {
            setQuizData(found);
            setAnswers(found.userAnswers || {});

            let indices: number[] = [];
            let optionsMap: { [qId: string]: string[] } = {};

            if (found.shuffleOrder && found.shuffledOptions && found.shuffleOrder.length === found.mcqs.length) {
                // Resume from persisted shuffle
                indices = found.shuffleOrder;
                optionsMap = found.shuffledOptions;
            } else {
                // Generate NEW Shuffle
                indices = Array.from({ length: found.mcqs.length }, (_, i) => i);
                for (let i = indices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [indices[i], indices[j]] = [indices[j], indices[i]];
                }

                // Shuffle Options
                found.mcqs.forEach((q: any) => {
                    const keys = Object.keys(q.options);
                    for (let i = keys.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [keys[i], keys[j]] = [keys[j], keys[i]];
                    }
                    optionsMap[q.id] = keys;
                });

                // Persist
                try {
                    const updatedQuiz = { ...found, shuffleOrder: indices, shuffledOptions: optionsMap };
                    const filename = QUIZZES_DIR + found.id + '.json';
                    await FileSystem.writeAsStringAsync(filename, JSON.stringify(updatedQuiz));
                } catch (e) {
                    console.warn("Failed to persist shuffle", e);
                }
            }

            // Find first non-committed question based on SHUFFLED order
            const committed = found.committedAnswers || {};
            let firstOpenIndex = 0;

            for (let i = 0; i < indices.length; i++) {
                const realIdx = indices[i];
                const qId = found.mcqs[realIdx].id;
                if (!committed[qId]) {
                    firstOpenIndex = i;
                    break;
                }
            }

            setShuffledIndices(indices);
            setShuffledOptionsMap(optionsMap);
            setCurrentIndex(firstOpenIndex);

            // Check if ALL questions are committed
            const committedCount = Object.keys(committed).length;
            if (committedCount === found.mcqs.length) {
                (global as any).quizResults = {
                    data: found,
                    userAnswers: committed
                };
                router.replace('/quiz/result');
            }

        } else {
            Alert.alert("Error", "Quiz not found.");
            router.back();
        }
    };

    if (!quizData) return <View style={[styles.container, { backgroundColor: colors.background }]} />;

    // Guard against race condition where indices aren't ready
    if (shuffledIndices.length === 0 || !quizData) return <View style={[styles.container, { backgroundColor: colors.background }]} />;

    // Use shuffled index
    const realQuestionIndex = shuffledIndices[currentIndex];
    // Double guard
    if (realQuestionIndex === undefined) return <View style={[styles.container, { backgroundColor: colors.background }]} />;

    const currentQ = quizData.mcqs[realQuestionIndex];
    const totalQ = quizData.mcqs.length;

    // Helper to get option label (A, B, C, D) using SHUFFLED MAP
    const optionKeys = shuffledOptionsMap[currentQ.id] || Object.keys(currentQ.options).sort();

    const handleSelectOption = (key: string) => {
        const currentQ = quizData.mcqs[realQuestionIndex];

        // Locking Logic
        if (quizData?.committedAnswers && quizData.committedAnswers[currentQ.id]) {
            return; // Locked
        }

        const newAnswers = {
            ...answers
        };

        // Toggle logic: If already selected, remove it. Else, set it.
        if (newAnswers[currentQ.id] === key) {
            delete newAnswers[currentQ.id];
        } else {
            newAnswers[currentQ.id] = key;
        }

        setAnswers(newAnswers);
        // Save progress immediately (auto-save)
        updateQuizProgress(quizData.id, newAnswers, false);
    };

    const handleShareQuestion = async () => {
        try {
            const currentQ = quizData.mcqs[realQuestionIndex];
            const options = shuffledOptionsMap[currentQ.id] || Object.keys(currentQ.options).sort();

            let message = `Explain the question:\n\n"${currentQ.question}"\n\nOptions:\n`;
            options.forEach(key => {
                message += `${key}. ${currentQ.options[key]}\n`;
            });

            await Share.share({
                message: message
            });
        } catch (error: any) {
            Alert.alert("Error", error.message);
        }
    };

    const handleSubmit = () => {
        Alert.alert(
            "Submit Current Progress?",
            "This will submit your current answers and save them. You can continue the rest later.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Submit",
                    style: "default",
                    onPress: async () => {
                        // Calculate Score on CURRENT SESSION ONLY
                        let sessionCorrect = 0;
                        let sessionWrong = 0;
                        const committed = quizData.committedAnswers || {};

                        // We iterate only over keys in current 'answers' state
                        Object.keys(answers).forEach((qId) => {
                            // Find Q to check answer
                            const q = quizData.mcqs.find((m: any) => m.id === qId);
                            if (q) {
                                if (answers[qId] === q.answer) sessionCorrect++;
                                else sessionWrong++;
                            }
                        });


                        const sessionScore = parseFloat(((sessionCorrect * 2) - (sessionWrong * (2 / 3))).toFixed(2));
                        const sessionTotal = Object.keys(answers).length; // Only counting attempted

                        // Move current answers to committed
                        const newCommitted = { ...committed, ...answers };

                        // Update History with "Session Attempt"
                        const attempt: QuizAttempt = {
                            id: Date.now().toString(),
                            date: new Date().toISOString(),
                            score: sessionScore,
                            totalQuestions: sessionTotal, // "10/20 solved" -> reporting on the 10 solved
                            attempted: sessionTotal,
                            userAnswers: answers // Only show what we just did? Or cumulative? Request implies "see result of those 10"
                        };

                        await updateQuizProgress(quizData.id, {}, false, undefined, answers); // Clear session answers, add to committed
                        await saveQuizAttempt(quizData.id, attempt);

                        // Update local object to have fresh history for result screen
                        const updatedHistory = quizData.history ? [attempt, ...quizData.history] : [attempt];

                        // For result view, we probably want to show result of THIS session. which is 'answers'.
                        // But we also updated committedAnswers.
                        // Let's pass the attempt data specifically.
                        const updatedQuizData = { ...quizData, history: updatedHistory, committedAnswers: newCommitted };

                        // Pass results to global
                        (global as any).quizResults = {
                            data: updatedQuizData,
                            userAnswers: newCommitted, // Show result for ALL committed answers (merged)
                            isSessionResult: true
                        };
                        router.replace('/quiz/result');
                    }
                }
            ]
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: colors.card, paddingTop: insets.top + 10, height: 60 + insets.top }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowJumpModal(true)} style={{ padding: 8 }}>
                        <Ionicons name="grid-outline" size={24} color={colors.text} />
                    </TouchableOpacity>
                </View>
                <Text style={[styles.headerTitle, { color: colors.text, maxWidth: 120 }]} numberOfLines={1}>
                    Q {currentIndex + 1} / {totalQ}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={handleShareQuestion} style={{ padding: 8 }}>
                        <Ionicons name="share-social-outline" size={24} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowHistoryModal(true)} style={{ padding: 8 }}>
                        <Ionicons name="time-outline" size={24} color={colors.text} />
                    </TouchableOpacity>
                    {(quizData?.committedAnswers && Object.keys(quizData.committedAnswers).length > 0) && (
                        <TouchableOpacity
                            style={{ padding: 8 }}
                            onPress={() => {
                                (global as any).quizResults = {
                                    data: quizData,
                                    userAnswers: quizData.committedAnswers,
                                    isInterim: true
                                };
                                router.push('/quiz/result');
                            }}
                        >
                            <Ionicons name="stats-chart-outline" size={24} color={colors.primary} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={handleSubmit} style={{ padding: 8, flexDirection: 'row', gap: 5 }}>
                        <Text style={{ color: colors.primary, fontWeight: 'bold' }}>End</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Question Area */}
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.sourceText, { color: colors.subtext }]}>{quizData.source}</Text>

                <View style={[styles.questionCard, { backgroundColor: isDark ? '#1E1E1E' : '#FFF', borderColor: colors.border }]}>
                    <Text style={[styles.questionText, { color: colors.text }]}>
                        {currentQ.question}
                    </Text>
                </View>

                <View style={styles.optionsContainer}>
                    {/* Locked Banner */}
                    {(quizData.committedAnswers && quizData.committedAnswers[currentQ.id]) && (
                        <View style={{ backgroundColor: isDark ? '#333' : '#E0E0E0', padding: 8, borderRadius: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="lock-closed" size={16} color={colors.subtext} />
                            <Text style={{ color: colors.subtext, fontSize: 12 }}>This question is locked because it was submitted previously.</Text>
                        </View>
                    )}

                    {optionKeys.map((key) => {
                        const committedAnswer = quizData.committedAnswers ? quizData.committedAnswers[currentQ.id] : null;
                        const sessionAnswer = answers[currentQ.id];
                        const isSelected = (committedAnswer === key) || (sessionAnswer === key);
                        const isLocked = !!committedAnswer;

                        return (
                            <TouchableOpacity
                                key={key}
                                disabled={isLocked}
                                style={[
                                    styles.optionButton,
                                    {
                                        backgroundColor: isSelected ? colors.primary : (isDark ? '#2C2C2C' : '#F5F5F5'),
                                        borderColor: isSelected ? colors.primary : colors.border,
                                        opacity: (isLocked && !isSelected) ? 0.5 : 1
                                    }
                                ]}
                                onPress={() => handleSelectOption(key)}
                            >
                                <View style={[styles.optionCircle, { borderColor: isSelected ? '#FFF' : colors.text }]}>
                                    {isSelected && <View style={styles.optionDot} />}
                                </View>
                                <Text style={[
                                    styles.optionText,
                                    { color: isSelected ? '#FFF' : colors.text }
                                ]}>
                                    {currentQ.options[key]}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                    {/* Explicit Skip Button (Hide if locked) */}
                    {(!quizData.committedAnswers || !quizData.committedAnswers[currentQ.id]) && (
                        <TouchableOpacity
                            style={[styles.optionButton, { borderColor: colors.border, marginTop: 10, justifyContent: 'center' }]}
                            onPress={() => {
                                const newAns = { ...answers };
                                newAns[currentQ.id] = 'SKIPPED';
                                setAnswers(newAns);
                                updateQuizProgress(quizData.id, newAns, false); // Persist skip immediately
                                if (currentIndex < totalQ - 1) setCurrentIndex(prev => prev + 1);
                            }}
                        >
                            <Text style={{ color: colors.subtext, textAlign: 'center' }}>Skip this Question</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </ScrollView>

            {/* Navigation Footer */}
            <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <TouchableOpacity
                    style={[styles.navButton, { opacity: currentIndex === 0 ? 0.3 : 1 }]}
                    disabled={currentIndex === 0}
                    onPress={() => setCurrentIndex(prev => prev - 1)}
                >
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                    <Text style={[styles.navText, { color: colors.text }]}>Prev</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, { opacity: currentIndex === totalQ - 1 ? 0.3 : 1 }]}
                    disabled={currentIndex === totalQ - 1}
                    onPress={() => setCurrentIndex(prev => prev + 1)}
                >
                    <Text style={[styles.navText, { color: colors.text }]}>Next</Text>
                    <Ionicons name="arrow-forward" size={24} color={colors.text} />
                </TouchableOpacity>
            </View>

            {/* Jump Modal */}
            <Modal
                visible={showJumpModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowJumpModal(false)}
            >
                <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>Go to Question</Text>
                            <TouchableOpacity onPress={() => setShowJumpModal(false)} style={{ padding: 5 }}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={{ maxHeight: 400 }}>
                            <View style={styles.gridContainer}>
                                {shuffledIndices.map((realIndex, uiIdx) => {
                                    const q = quizData.mcqs[realIndex];
                                    const isSessionAnswered = answers[q.id] !== undefined;
                                    const isCommitted = quizData.committedAnswers && quizData.committedAnswers[q.id];
                                    const isCurrent = uiIdx === currentIndex;

                                    return (
                                        <TouchableOpacity
                                            key={q.id}
                                            // disabled={!!isCommitted} // Allow jumping to locked questions to see them, but read-only
                                            style={[
                                                styles.gridItem,
                                                {
                                                    backgroundColor: isCurrent ? colors.primary : (isCommitted ? (isDark ? '#555' : '#CCC') : (isSessionAnswered ? (isDark ? '#2C2C2C' : '#E0E0E0') : 'transparent')),
                                                    borderColor: colors.border
                                                }
                                            ]}
                                            onPress={() => {
                                                setCurrentIndex(uiIdx);
                                                setShowJumpModal(false);
                                            }}
                                        >
                                            <Text style={{
                                                color: isCurrent ? '#FFF' : (isCommitted ? colors.subtext : (isSessionAnswered ? colors.text : colors.subtext)),
                                                fontWeight: isCurrent ? 'bold' : 'normal'
                                            }}>
                                                {uiIdx + 1}
                                            </Text>
                                            {/* Show if answered in small dot */}
                                            {isSessionAnswered && (
                                                <View style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }} />
                                            )}
                                            {isCommitted && (
                                                <View style={{ position: 'absolute', bottom: -2, right: -2 }}>
                                                    <Ionicons name="lock-closed" size={10} color={colors.subtext} />
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </ScrollView>
                    </View>
                </View>
            </Modal >
            {/* History Modal */}
            <Modal
                visible={showHistoryModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowHistoryModal(false)}
            >
                <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>Quiz History</Text>
                            <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView>
                            {history.length === 0 ? (
                                <Text style={{ color: colors.subtext, textAlign: 'center', padding: 20 }}>No previous attempts.</Text>
                            ) : (
                                history.map((attempt, idx) => (
                                    <View key={idx} style={{ padding: 15, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Score: {attempt.score}</Text>
                                            <Text style={{ color: colors.subtext }}>{new Date(attempt.date).toLocaleDateString()}</Text>
                                        </View>
                                        <Text style={{ color: colors.subtext, fontSize: 12 }}>
                                            Attempted: {attempt.attempted}/{attempt.totalQuestions}
                                        </Text>
                                        <Text style={{ color: colors.subtext, fontSize: 10, marginTop: 2 }}>ID: {attempt.id}</Text>
                                    </View>
                                ))
                            )}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        // height: 60, // Fixed height removed to allow dynamic expansion
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 5,
        elevation: 2,
        shadowOpacity: 0.1,
        shadowRadius: 3,
        paddingBottom: 10 // Add bottom padding for balance
    },
    headerTitle: { fontSize: 16, fontWeight: 'bold' },
    sourceText: { fontSize: 12, marginBottom: 10, textAlign: 'center', marginHorizontal: 20 },
    scrollContent: { padding: 20, paddingBottom: 100 },
    questionCard: {
        borderRadius: 12,
        padding: 20,
        marginBottom: 25,
        borderWidth: 1,
    },
    questionText: { fontSize: 18, lineHeight: 28, fontWeight: '600' },
    optionsContainer: { gap: 12 },
    optionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    optionCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        marginRight: 12,
        alignItems: 'center',
        justifyContent: 'center'
    },
    optionDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#FFF'
    },
    optionText: { fontSize: 16, flex: 1 },
    footer: {
        flexDirection: 'row',
        padding: 15,
        borderTopWidth: 1,
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        justifyContent: 'space-between'
    },
    navButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 10
    },
    navText: { fontSize: 16, fontWeight: 'bold' },

    // Modal
    modalOverlay: { flex: 1, justifyContent: 'center', padding: 20 },
    modalContent: { borderRadius: 16, padding: 20, maxHeight: '80%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 18, fontWeight: 'bold' },
    gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
    gridItem: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center'
    }
});
