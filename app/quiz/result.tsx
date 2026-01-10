import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { resetQuiz, retakeQuiz, getSavedQuizzes, updateQuizProgress } from '../../src/services/storage';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { analyzeQuizWeakness, updateRollingAnalysis } from '../../src/services/gemini';

declare var global: any;

interface MCQItem {
    id: number | string;
    question: string;
    options: { [key: string]: string };
    answer: string;
    explanation?: string;
}

export default function QuizResultScreen() {
    const { colors, isDark } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [results, setResults] = useState<{
        score: number, correct: number, wrong: number, unattempted: number, total: number,
        data: any, userAnswers: { [key: string]: string }
    } | null>(null);

    // For History Review Mode
    const [originalResults, setOriginalResults] = useState<any>(null);
    const [isReviewMode, setIsReviewMode] = useState(false);
    const [reviewDate, setReviewDate] = useState<string>("");

    const [filter, setFilter] = useState<'ALL' | 'CORRECT' | 'WRONG' | 'UNATTEMPTED'>('ALL');
    const [expandedIds, setExpandedIds] = useState<Set<string | number>>(new Set());
    const [activeTab, setActiveTab] = useState<'RESULTS' | 'HISTORY'>('RESULTS');
    const [isInterim, setIsInterim] = useState(false);

    // Analysis State
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<string | null>(null);
    const [showAnalysisModal, setShowAnalysisModal] = useState(false);

    // Double Tap Ref
    const lastTapRef = useRef<number>(0);

    useEffect(() => { loadResults(); }, []);

    const loadResults = async () => {
        let data, userAnswers;
        const rawResults = (global as any).quizResults;

        if (rawResults) {
            data = rawResults.data;
            userAnswers = rawResults.userAnswers;
            if (rawResults.isInterim) setIsInterim(true);
        } else {
            const id = (global as any).currentQuizId;
            if (id) {
                const all = await getSavedQuizzes();
                const found = all.find(q => q.id === id);
                if (found) { data = found; userAnswers = found.userAnswers || {}; }
            }
        }

        if (!data) { router.replace('/dashboard'); return; }

        calculateAndSetResults(data, userAnswers);
    };

    const calculateAndSetResults = (data: any, userAnswers: any) => {
        const total = data.mcqs.length;
        let correct = 0, wrong = 0, unattempted = 0;

        data.mcqs.forEach((q: MCQItem) => {
            const userAns = userAnswers[q.id];
            if (!userAns || userAns === 'SKIPPED') unattempted++;
            else if (userAns === q.answer) correct++;
            else wrong++;
        });

        const score = (correct * 2) - (wrong * (2 / 3));
        setResults({ score: parseFloat(score.toFixed(2)), correct, wrong, unattempted, total, data, userAnswers });
    };

    const toggleExpand = (id: string | number) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setExpandedIds(newSet);
    };

    const handleHistoryPress = (attempt: any) => {
        const now = Date.now();
        const DOUBLE_PRESS_DELAY = 300;

        if (now - lastTapRef.current < DOUBLE_PRESS_DELAY) {
            // Double Tap Detected
            if (!isReviewMode) {
                setOriginalResults(results); // Save current state
            }

            // Switch to review this attempt
            setIsReviewMode(true);
            setReviewDate(attempt.date);
            setActiveTab('RESULTS'); // Switch tab to show questions

            // Recalculate stats for THIS attempt without modifying the underlying 'data' object structure too much
            // We just overlay the userAnswers from the attempt
            calculateAndSetResults(results!.data, attempt.userAnswers);
        }

        lastTapRef.current = now;
    };

    const exitReviewMode = () => {
        if (originalResults) {
            setResults(originalResults);
            setOriginalResults(null);
        }
        setIsReviewMode(false);
        setReviewDate("");
        setActiveTab('HISTORY');
    };

    // --- SMART FEATURES ---

    const handleSmartAnalysis = async () => {
        if (!results) return;

        // 1. Identify Answered Questions (IDs)
        const currentAnsweredIds = Object.keys(results.userAnswers).filter(k => results.userAnswers[k] !== undefined);
        const savedMeta = results.data.analysisMeta || {};
        const previouslyAnalyzedIds = new Set(savedMeta.analyzedQuestionIds || []);

        // 2. Find NEW Questions (Diff)
        const newIds = currentAnsweredIds.filter(id => !previouslyAnalyzedIds.has(id));

        // 3. Check Staleness
        // If NO new IDs and we have a report, use cache.
        if (newIds.length === 0 && results.data.analysisReport) {
            console.log("Using Cached Analysis (No new answers)");
            setAnalysisResult(results.data.analysisReport);
            setShowAnalysisModal(true);
            return;
        }

        setAnalyzing(true);
        try {
            // 4. Identify Problem Questions in the NEW batch
            const newProblemQuestions = results.data.mcqs.filter((q: MCQItem) => {
                // Must be in newIds AND (Wrong or Skipped)
                if (!newIds.includes(q.id.toString())) return false;
                const ans = results.userAnswers[q.id];
                return !ans || ans === 'SKIPPED' || ans !== q.answer;
            });

            let feedback = "";
            const oldReport = results.data.analysisReport;

            if (oldReport && previouslyAnalyzedIds.size > 0 && newProblemQuestions.length > 0) {
                // MERGE STRATEGY
                console.log(`Merging: Old(${previouslyAnalyzedIds.size}) + New(${newProblemQuestions.length})`);
                feedback = await updateRollingAnalysis(
                    oldReport,
                    previouslyAnalyzedIds.size,
                    newProblemQuestions,
                    results.userAnswers
                );
            } else if (newProblemQuestions.length > 0) {
                // FRESH STRATEGY
                console.log("Fresh Analysis");
                feedback = await analyzeQuizWeakness(newProblemQuestions, results.userAnswers);
            } else {
                // IMPROVEMENT STRATEGY (New answers exist, but no new problems)
                // Just append a positive note to old report?
                feedback = oldReport
                    ? `${oldReport}\n\n[Update]: You answered ${newIds.length} more questions perfectly! Keep it up.`
                    : "Great job! You answered these questions correctly. No analysis needed yet.";
            }

            // 5. Persist


            // We save ALL currentAnsweredIds as processed
            await updateQuizProgress(results.data.id,
                results.data.userAnswers,
                results.data.isSubmitted,
                results.data.score,
                undefined,
                feedback,
                {
                    questionCount: currentAnsweredIds.length,
                    analyzedQuestionIds: currentAnsweredIds
                }
            );

            // Update Local
            results.data.analysisReport = feedback;
            results.data.analysisMeta = {
                questionCount: currentAnsweredIds.length,
                analyzedQuestionIds: currentAnsweredIds,
                timestamp: Date.now()
            };

            setAnalysisResult(feedback);
            setShowAnalysisModal(true);
        } catch (e: any) {
            Alert.alert("Analysis Failed", e.message);
        } finally {
            setAnalyzing(false);
        }
    };

    const handleExportPdf = async () => {
        if (!results) return;
        try {
            const html = `
            <html>
                <head>
                    <style>
                        body { font-family: Helvetica, sans-serif; padding: 20px; }
                        h1 { color: #333; }
                        .score { font-size: 24px; color: ${results.score >= 0 ? 'green' : 'red'}; margin-bottom: 20px; }
                        .q-block { margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; }
                        .correct { color: green; font-weight: bold; }
                        .wrong { color: red; font-weight: bold; }
                        .skipped { color: gray; font-style: italic; }
                    </style>
                </head>
                <body>
                    <h1>Quiz Results: ${results.data.source}</h1>
                    <div class="score">Score: ${results.score} / ${results.total * 2}</div>
                    
                    ${results.data.mcqs.map((q: any, i: number) => {
                const ua = results.userAnswers[q.id];
                const isCorrect = ua === q.answer;
                const statusClass = !ua ? 'skipped' : (isCorrect ? 'correct' : 'wrong');
                const statusText = !ua ? 'Skipped' : (isCorrect ? 'Correct' : 'Wrong');

                return `
                        <div class="q-block">
                            <p><strong>Q${i + 1}: ${q.question}</strong></p>
                            <p>Your Answer: <span class="${statusClass}">${ua || 'None'} (${statusText})</span></p>
                            <p>Correct Answer: <span class="correct">${q.answer}</span></p>
                            <p><em>${q.explanation || ''}</em></p>
                        </div>
                        `;
            }).join('')}
                </body>
            </html>
            `;

            const { uri } = await Print.printToFileAsync({ html });
            await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } catch (e: any) {
            Alert.alert("Export Failed", "Could not generate PDF: " + e.message);
        }
    };

    // --- RENDER HELPERS ---

    const filteredQuestions = useMemo(() => {
        if (!results) return [];
        return results.data.mcqs.filter((q: MCQItem) => {
            const userAns = results.userAnswers[q.id];
            const isCorrect = userAns === q.answer;
            const isSkipped = !userAns || userAns === 'SKIPPED';
            const isWrong = userAns && userAns !== 'SKIPPED' && !isCorrect;

            if (filter === 'CORRECT') return isCorrect;
            if (filter === 'WRONG') return isWrong;
            if (filter === 'UNATTEMPTED') return isSkipped;
            return true;
        });
    }, [results, filter]);

    if (!results) return <View style={[styles.container, { backgroundColor: colors.background }]} />;

    const getStatusColor = (userAns: string | undefined, correctAns: string) => {
        if (!userAns || userAns === 'SKIPPED') return colors.subtext;
        if (userAns === correctAns) return '#4CAF50';
        return '#F44336';
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border, paddingTop: insets.top + 10 }]}>
                {/* Header Top Row */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                    {isInterim ? (
                        <TouchableOpacity onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <Ionicons name="arrow-back" size={24} color={colors.text} />
                            <Text style={{ color: colors.text, fontWeight: 'bold' }}>Resume</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity onPress={() => router.push('/dashboard')}>
                            <Ionicons name="home-outline" size={24} color={colors.text} />
                        </TouchableOpacity>
                    )}

                    {/* Review Mode Banner or Tabs */}
                    {isReviewMode ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Reviewing: {new Date(reviewDate).toLocaleDateString()}</Text>
                            <TouchableOpacity onPress={exitReviewMode} style={{ padding: 5, backgroundColor: colors.subtext + '20', borderRadius: 10 }}>
                                <Ionicons name="close" size={16} color={colors.text} />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={{ flexDirection: 'row', backgroundColor: isDark ? '#333' : '#F0F0F0', borderRadius: 20, padding: 4 }}>
                            <TouchableOpacity onPress={() => setActiveTab('RESULTS')} style={[styles.tabBtn, activeTab === 'RESULTS' && { backgroundColor: colors.primary }]}>
                                <Text style={[styles.tabText, { color: activeTab === 'RESULTS' ? '#FFF' : colors.subtext }]}>Results</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setActiveTab('HISTORY')} style={[styles.tabBtn, activeTab === 'HISTORY' && { backgroundColor: colors.primary }]}>
                                <Text style={[styles.tabText, { color: activeTab === 'HISTORY' ? '#FFF' : colors.subtext }]}>History</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {!isInterim && !isReviewMode && (
                        <TouchableOpacity onPress={() => {
                            Alert.alert("Reset Options", "Retake or Reset?", [
                                { text: "Cancel", style: "cancel" },
                                { text: "Retake", onPress: async () => { await retakeQuiz(results.data.id); router.replace('/quiz/game'); } },
                                { text: "Reset Fully", style: 'destructive', onPress: async () => { await resetQuiz(results.data.id); router.replace('/quiz/game'); } }
                            ]);
                        }}>
                            <Ionicons name="refresh" size={24} color={colors.primary} />
                        </TouchableOpacity>
                    )}
                    {(isInterim || isReviewMode) && <View style={{ width: 24 }} />}
                </View>

                {activeTab === 'RESULTS' && (
                    <>
                        <View style={{ alignItems: 'center' }}>
                            <Text style={[styles.scoreTitle, { color: colors.subtext }]}>Total Score</Text>
                            <Text style={[styles.scoreValue, { color: results.score >= 0 ? colors.primary : colors.error }]}>{results.score}</Text>

                            {!isReviewMode && (
                                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
                                    <TouchableOpacity
                                        onPress={handleSmartAnalysis}
                                        disabled={analyzing}
                                        style={{ backgroundColor: isDark ? '#333' : '#E8F5E9', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                                    >
                                        {analyzing ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="sparkles" size={16} color={colors.primary} />}
                                        <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 12 }}>Analyze Weakness</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={handleExportPdf}
                                        style={{ backgroundColor: isDark ? '#333' : '#E3F2FD', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                                    >
                                        <Ionicons name="download-outline" size={16} color="#2196F3" />
                                        <Text style={{ color: "#2196F3", fontWeight: 'bold', fontSize: 12 }}>PDF</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>

                        <View style={styles.statsRow}>
                            <TouchableOpacity onPress={() => setFilter('CORRECT')} style={styles.statItem}>
                                <Text style={[styles.statValue, { color: '#4CAF50' }]}>{results.correct}</Text>
                                <Text style={styles.statLabel}>Correct</Text>
                            </TouchableOpacity>
                            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                            <TouchableOpacity onPress={() => setFilter('WRONG')} style={styles.statItem}>
                                <Text style={[styles.statValue, { color: '#F44336' }]}>{results.wrong}</Text>
                                <Text style={styles.statLabel}>Wrong</Text>
                            </TouchableOpacity>
                            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                            <TouchableOpacity onPress={() => setFilter('UNATTEMPTED')} style={styles.statItem}>
                                <Text style={[styles.statValue, { color: colors.text }]}>{results.unattempted}</Text>
                                <Text style={styles.statLabel}>Skipped</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                )}
            </View>

            {activeTab === 'RESULTS' ? (
                <ScrollView contentContainerStyle={styles.listContent}>
                    {filteredQuestions.map((q: MCQItem, idx: number) => {
                        const userAns = results.userAnswers[q.id];
                        const isCorrect = userAns === q.answer;
                        const isExpanded = expandedIds.has(q.id);
                        const statusColor = getStatusColor(userAns, q.answer);

                        return (
                            <TouchableOpacity
                                key={q.id}
                                style={[styles.resultCard, { backgroundColor: colors.card, borderColor: isExpanded ? statusColor : 'transparent', borderWidth: isExpanded ? 1 : 0 }]}
                                onPress={() => toggleExpand(q.id)}
                                activeOpacity={0.9}
                            >
                                <View style={styles.cardHeader}>
                                    <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={isExpanded ? undefined : 2}>
                                            <Text style={{ fontWeight: 'bold' }}>Q{idx + 1}: </Text>{q.question}
                                        </Text>
                                    </View>
                                    <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color={colors.subtext} />
                                </View>
                                {isExpanded && (
                                    <View style={styles.cardBody}>
                                        <Text style={[styles.label, { color: colors.subtext }]}>Your Answer: <Text style={{ color: statusColor, fontWeight: 'bold' }}>{userAns === 'SKIPPED' ? 'Skipped' : (userAns || 'None')}</Text></Text>
                                        <Text style={[styles.label, { color: colors.subtext, marginTop: 4 }]}>Correct: <Text style={{ color: '#4CAF50', fontWeight: 'bold' }}>{q.answer}</Text></Text>
                                        {q.explanation && <View style={[styles.explanationBox, { backgroundColor: isDark ? '#222' : '#F5F5F5' }]}><Text style={{ color: colors.text, fontSize: 13 }}>{q.explanation}</Text></View>}
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            ) : (
                <ScrollView contentContainerStyle={styles.listContent}>
                    <Text style={{ textAlign: 'center', color: colors.subtext, marginBottom: 10, fontSize: 12 }}>Double-tap a tile to review</Text>
                    {results.data.history?.map((att: any, i: number) => (
                        <TouchableOpacity
                            key={i}
                            style={[styles.resultCard, { backgroundColor: colors.card, padding: 15 }]}
                            onPress={() => handleHistoryPress(att)}
                            activeOpacity={0.7}
                        >
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Score: {att.score}</Text>
                                <Text style={{ color: colors.subtext }}>{new Date(att.date).toLocaleString()}</Text>
                            </View>
                            <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 4 }}>
                                Attempted: {att.attempted}/{att.totalQuestions}
                            </Text>
                        </TouchableOpacity>
                    ))}
                    {!results.data.history?.length && <Text style={{ padding: 20, textAlign: 'center', color: colors.subtext }}>No history found.</Text>}
                </ScrollView>
            )}

            {/* Analysis Modal */}
            <Modal visible={showAnalysisModal} animationType="slide" presentationStyle="pageSheet">
                <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>AI Weakness Analysis</Text>
                        <TouchableOpacity onPress={() => setShowAnalysisModal(false)} style={{ padding: 5 }}>
                            <Ionicons name="close-circle" size={30} color={colors.primary} />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={{ padding: 20 }}>
                        <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24, paddingBottom: 50 }}>{analysisResult}</Text>
                    </ScrollView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 20, paddingBottom: 10, borderBottomWidth: 1 },
    scoreTitle: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
    scoreValue: { fontSize: 40, fontWeight: 'bold', marginVertical: 5 },
    statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 10 },
    statItem: { alignItems: 'center', minWidth: 60 },
    statValue: { fontSize: 18, fontWeight: 'bold' },
    statLabel: { fontSize: 12, color: '#888' },
    statDivider: { width: 1, backgroundColor: '#DDD' },
    listContent: { padding: 20 },
    resultCard: { borderRadius: 12, marginBottom: 12, overflow: 'hidden', padding: 15 },
    cardHeader: { flexDirection: 'row', gap: 10 },
    statusIndicator: { width: 4, borderRadius: 2, height: '100%' },
    cardTitle: { flex: 1, fontSize: 15, fontWeight: '500' },
    cardBody: { marginTop: 10, paddingLeft: 14 },
    label: { fontSize: 13 },
    explanationBox: { marginTop: 10, padding: 10, borderRadius: 6 },
    tabBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16 },
    tabText: { fontWeight: 'bold', fontSize: 12 },
    modalContainer: { flex: 1, paddingTop: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 },
    modalTitle: { fontSize: 18, fontWeight: 'bold', flex: 1 }
});
