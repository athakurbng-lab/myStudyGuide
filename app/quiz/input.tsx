import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Keyboard, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { saveQuiz } from '../../src/services/storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

declare var global: any;

type GenMode = 'PDF' | 'YOUTUBE' | 'JSON';

export default function QuizInputScreen() {
    const { colors, isDark } = useTheme();
    const router = useRouter();
    const [mode, setMode] = useState<GenMode>('PDF');
    const [loading, setLoading] = useState(false);

    // Inputs
    const [jsonInput, setJsonInput] = useState("");
    const [youtubeUrl, setYoutubeUrl] = useState("");

    // PDF State
    const [selectedPdf, setSelectedPdf] = useState<any>(null);
    const [questionsPerPage, setQuestionsPerPage] = useState("2");

    // YouTube State
    const [totalQuestions, setTotalQuestions] = useState("10");

    // --- JSON PROCESSING (Existing) ---
    const processJsonData = (jsonString: string) => {
        try {
            let data;
            try { data = JSON.parse(jsonString); } catch (e) { throw new Error("Invalid JSON format."); }

            if (!data.mcqs || !Array.isArray(data.mcqs)) throw new Error("Missing 'mcqs' array.");

            const quizId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            saveQuiz({
                id: quizId,
                source: data.source || 'Imported Quiz',
                mcqs: data.mcqs,
                userAnswers: {},
                isSubmitted: false
            }).then(() => {
                (global as any).currentQuizId = quizId;
                router.replace('/quiz/game');
            });
        } catch (e: any) {
            Alert.alert("Validation Failed", e.message);
            setLoading(false);
        }
    };

    const handleJsonSubmit = () => {
        if (!jsonInput.trim()) return Alert.alert("Required", "Paste JSON first.");
        setLoading(true);
        setTimeout(() => processJsonData(jsonInput), 100);
    };

    const pickJsonFile = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
            if (result.canceled) return;
            setLoading(true);
            const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
            setTimeout(() => processJsonData(content), 100);
        } catch (err) {
            Alert.alert("Error", "Failed to read file.");
            setLoading(false);
        }
    };

    // --- PDF / YOUTUBE LOGIC ---

    // Import dynamically or at top? Need to add imports first.
    // (See next edit for imports)

    const handlePdfSubmit = async () => {
        if (!selectedPdf) return Alert.alert("Required", "Please select a PDF file.");
        const qpp = parseInt(questionsPerPage);
        if (isNaN(qpp) || qpp < 1) return Alert.alert("Invalid", "Questions per page must be at least 1.");

        setLoading(true);

        try {
            const base64 = await FileSystem.readAsStringAsync(selectedPdf.uri, { encoding: 'base64' });

            // Dynamic import to avoid cycles/issues if not ready, strictly speaking standard import is better
            // but we need to ensure services are imported.
            // Assuming imports are added at top.
            const { generateQuizFromPdf } = require('../../src/services/gemini');

            // Show a toast or simple alert? Expo doesn't have toast. We rely on ActivityIndicator.

            const mcqs = await generateQuizFromPdf(base64, qpp, (current: number, total: number) => {
                // Ideally we update a progress state here, but simple loading is fine for now
                // setProgress(`${current}/${total}`)
            });

            if (mcqs.length === 0) throw new Error("No questions generated. Please check the PDF content.");

            const quizId = `${Date.now()}_pdf`;
            await saveQuiz({
                id: quizId,
                source: selectedPdf.name,
                mcqs: mcqs,
                userAnswers: {},
                isSubmitted: false
            });

            (global as any).currentQuizId = quizId;
            router.replace('/quiz/game');

        } catch (e: any) {
            Alert.alert("Generation Failed", e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleYoutubeSubmit = async () => {
        if (!youtubeUrl.trim()) return Alert.alert("Required", "Please enter a YouTube URL.");
        const total = parseInt(totalQuestions);
        if (isNaN(total) || total < 1) return Alert.alert("Invalid", "Total questions must be at least 1.");

        setLoading(true);

        try {
            const { getYouTubeTranscript, extractVideoId } = require('../../src/services/youtube');
            const { generateQuizFromText } = require('../../src/services/gemini');

            const videoId = extractVideoId(youtubeUrl);
            if (!videoId) throw new Error("Invalid YouTube URL.");

            console.log("Fetching transcript for:", videoId);
            const transcript = await getYouTubeTranscript(videoId);

            if (!transcript) {
                // Detailed Fallback Alert
                Alert.alert(
                    "Extraction Failed",
                    "We couldn't extract the transcript automatically.\n\nPossible reasons:\n1. Video has no captions/CC.\n2. Video is Age Restricted or Private.\n3. Region-locked content.\n\nWorkaround: Please copy the transcript manually and use the 'Import Existing' tab (Paste)."
                );
                setLoading(false);
                return; // Stop execution
            }

            console.log("Transcript fetched (len):", transcript.length);
            const mcqs = await generateQuizFromText(transcript, total, (msg: string) => {
                console.log(msg);
            });

            if (mcqs.length === 0) throw new Error("No questions generated.");

            const quizId = `${Date.now()}_yt`;
            await saveQuiz({
                id: quizId,
                source: `YouTube: ${videoId}`,
                mcqs: mcqs,
                userAnswers: {},
                isSubmitted: false
            });

            (global as any).currentQuizId = quizId;
            router.replace('/quiz/game');

        } catch (e: any) {
            Alert.alert("Generation Failed", e.message);
        } finally {
            setLoading(false);
        }
    };

    const pickPdf = async () => {
        const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
        if (!result.canceled) {
            setSelectedPdf(result.assets[0]);
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: colors.text }]}>Create Quiz</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Tabs */}
            <View style={{ flexDirection: 'row', padding: 10, gap: 10 }}>
                {(['PDF', 'YOUTUBE', 'JSON'] as GenMode[]).map(m => (
                    <TouchableOpacity
                        key={m}
                        onPress={() => setMode(m)}
                        style={{
                            flex: 1,
                            paddingVertical: 10,
                            backgroundColor: mode === m ? colors.primary : colors.card,
                            borderRadius: 8,
                            alignItems: 'center',
                            borderWidth: 1,
                            borderColor: mode === m ? colors.primary : colors.border
                        }}
                    >
                        <Text style={{ color: mode === m ? '#FFF' : colors.text, fontWeight: 'bold', fontSize: 12 }}>
                            {m === 'YOUTUBE' ? 'VIDEO' : m} // Label tweak
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
                {mode === 'PDF' && (
                    <View>
                        <Text style={[styles.label, { color: colors.text }]}>1. Select Document</Text>
                        <TouchableOpacity
                            onPress={pickPdf}
                            style={[styles.uploadBox, { borderColor: colors.border, backgroundColor: isDark ? '#222' : '#F9F9F9' }]}
                        >
                            <Ionicons name="document-text" size={32} color={selectedPdf ? colors.primary : colors.subtext} />
                            <Text style={{ color: colors.text, marginTop: 10, fontWeight: '500' }}>
                                {selectedPdf ? selectedPdf.name : "Tap to select PDF file"}
                            </Text>
                        </TouchableOpacity>

                        <Text style={[styles.label, { color: colors.text }]}>2. Settings</Text>
                        <View style={[styles.settingRow]}>
                            <Text style={{ color: colors.text }}>Questions Per Page</Text>
                            <TextInput
                                style={[styles.numInput, { color: colors.text, borderColor: colors.border }]}
                                value={questionsPerPage}
                                onChangeText={setQuestionsPerPage}
                                keyboardType="numeric"
                                maxLength={2}
                            />
                        </View>
                        <Text style={{ color: colors.subtext, fontSize: 12, marginBottom: 20 }}>
                            We process 2 pages at a time. This will generate {parseInt(questionsPerPage || '0') * 2} questions per batch.
                        </Text>

                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
                            onPress={handlePdfSubmit}
                            disabled={loading}
                        >
                            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Generate Quiz</Text>}
                        </TouchableOpacity>
                    </View>
                )}

                {mode === 'YOUTUBE' && (
                    <View>
                        <Text style={[styles.label, { color: colors.text }]}>1. YouTube Link</Text>
                        <TextInput
                            style={[styles.textInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? '#222' : '#F9F9F9' }]}
                            placeholder="https://youtu.be/..."
                            placeholderTextColor={colors.subtext}
                            value={youtubeUrl}
                            onChangeText={setYoutubeUrl}
                            autoCapitalize="none"
                        />

                        <Text style={[styles.label, { color: colors.text }]}>2. Settings</Text>
                        <View style={[styles.settingRow]}>
                            <Text style={{ color: colors.text }}>Total Questions</Text>
                            <TextInput
                                style={[styles.numInput, { color: colors.text, borderColor: colors.border }]}
                                value={totalQuestions}
                                onChangeText={setTotalQuestions}
                                keyboardType="numeric"
                            />
                        </View>
                        <Text style={{ color: colors.subtext, fontSize: 12, marginBottom: 20 }}>
                            We will extract the transcript and distribute these {totalQuestions} questions evenly.
                        </Text>

                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
                            onPress={handleYoutubeSubmit}
                            disabled={loading}
                        >
                            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Generate Quiz</Text>}
                        </TouchableOpacity>
                    </View>
                )}

                {mode === 'JSON' && (
                    <View>
                        <Text style={[styles.label, { color: colors.text }]}>Import Existing</Text>
                        <TouchableOpacity onPress={pickJsonFile} style={[styles.uploadBox, { marginBottom: 15, borderColor: colors.border }]}>
                            <Ionicons name="cloud-upload-outline" size={24} color={colors.primary} />
                            <Text style={{ color: colors.primary }}>Upload JSON File</Text>
                        </TouchableOpacity>

                        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10 }}>
                            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                            <Text style={{ marginHorizontal: 10, color: colors.subtext }}>OR PASTE</Text>
                            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                        </View>

                        <TextInput
                            style={[styles.areaInput, { color: colors.text, borderColor: colors.border, backgroundColor: isDark ? '#222' : '#F9F9F9' }]}
                            multiline
                            placeholder="{ ... }"
                            placeholderTextColor={colors.subtext}
                            value={jsonInput}
                            onChangeText={setJsonInput}
                        />

                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: colors.primary }]}
                            onPress={handleJsonSubmit}
                            disabled={loading}
                        >
                            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Import & Play</Text>}
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1 },
    title: { fontSize: 20, fontWeight: 'bold' },
    content: { flex: 1, padding: 20 },
    label: { fontSize: 16, fontWeight: 'bold', marginTop: 15, marginBottom: 10 },
    uploadBox: { height: 100, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
    numInput: { width: 60, height: 40, borderWidth: 1, borderRadius: 8, textAlign: 'center', fontSize: 16 },
    textInput: { height: 50, borderWidth: 1, borderRadius: 10, paddingHorizontal: 15, marginBottom: 15 },
    areaInput: { height: 200, borderWidth: 1, borderRadius: 12, padding: 15, textAlignVertical: 'top', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    actionButton: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10, marginBottom: 40 },
    btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 }
});
