
import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { useKeepAwake } from 'expo-keep-awake';
import Slider from '@react-native-community/slider';
import { saveBook, ScriptItem, saveGlobalStats, getGlobalStats, updateBookProgress } from '../src/services/storage';
import { useTheme } from '../src/context/ThemeContext';

declare var global: any;

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const DEFAULT_CHARS_PER_SEC = 15;

const MIN_RATE = 5.0;
const MAX_RATE = 35.0;

// Helper: Format seconds to MM:SS
const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600000) return "--:--"; // Limit increased to ~1000h
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// ...





export default function Player() {
    useKeepAwake(); // Keep screen on while Player is active

    const { colors, isDark } = useTheme();
    const { fileId } = useLocalSearchParams();
    const router = useRouter();
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSpeed, setCurrentSpeed] = useState(1.0);
    // @ts-ignore
    const [currentPage, setCurrentPage] = useState((global as any).currentInitialPage || 0);

    // @ts-ignore
    const [scripts, setScripts] = useState<ScriptItem[]>((global as any).currentScripts || []);
    // @ts-ignore
    const bookTitle = (global as any).currentBookTitle || "Untitled Book";

    // Use an existing ID if we are editing a saved book, else undefined means new
    const initialBookId = (global as any).currentBookId;
    const [bookId, setBookId] = useState<string | undefined>(initialBookId);

    // Playback State
    const [isAutoplay, setIsAutoplay] = useState(false);

    // Time State
    const [estimatedCharRate, setEstimatedCharRate] = useState(DEFAULT_CHARS_PER_SEC);

    // Seeking State
    const [progress, setProgress] = useState(0); // 0 to 1
    const [currentTextOffset, setCurrentTextOffset] = useState(0);
    const [pageTextLength, setPageTextLength] = useState(1);
    const isSeekingRef = useRef(false);
    const lastRateUpdateRef = useRef<number>(0);
    // Ref to track latest rate for unmount cleanup (avoids stale closure)
    const rateRef = useRef(estimatedCharRate);
    // [NEW] Ref to hold the target character offset when jumping between pages
    const targetPageOffset = useRef<number | null>(null);
    // [NEW] Ref to track if initial resume logic has run
    const initialLoadDone = useRef(false);

    useEffect(() => {
        rateRef.current = estimatedCharRate;
    }, [estimatedCharRate]);

    // Smart Learning State
    const speechStartTime = useRef<number | null>(null);
    const speechStartChar = useRef<number>(0);

    // Voice State
    const [voices, setVoices] = useState<Speech.Voice[]>([]);
    const [selectedVoice, setSelectedVoice] = useState<Speech.Voice | null>(null);
    const [showVoiceModal, setShowVoiceModal] = useState(false);
    const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

    useEffect(() => {
        // Load global settings on mount
        const loadSettings = async () => {
            const stats = await getGlobalStats();
            if (stats && stats.lastEstimatedCharRate && stats.lastEstimatedCharRate > 0) {
                console.log("Loaded global learned rate:", stats.lastEstimatedCharRate);
                setEstimatedCharRate(stats.lastEstimatedCharRate);
            }
        };
        loadSettings();

        // Configure Audio Mode for Background Playback
        const configureAudio = async () => {
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    staysActiveInBackground: true,
                    playsInSilentModeIOS: true,
                    shouldDuckAndroid: true,
                    playThroughEarpieceAndroid: false
                });
            } catch (e) {
                console.warn("Failed to set audio mode", e);
            }
        };
        configureAudio();

        // Load scripts from global store
        const loadedScripts = (global as any).currentScripts || [];
        setScripts(loadedScripts);
        if (loadedScripts.length > 0) {
            setPageTextLength(Math.max(1, loadedScripts[0].script.length));
        }
        recalculateRate(loadedScripts);
        loadVoices();
    }, []);

    // Save global rate on unmount setup
    useEffect(() => {
        return () => {
            // Save on unmount (cleanup) using REF to get latest value
            if (rateRef.current > 0) {
                console.log("Saving final learned rate:", rateRef.current);
                saveGlobalStats(rateRef.current);
            }
        };
    }, []);

    // ...

    useEffect(() => {
        // Reset state on page change
        if (scripts[currentPage]) {
            setPageTextLength(Math.max(1, scripts[currentPage].script.length));

            // Check if we have a target jump position (from seeking back/forward across pages)
            let startOffset = 0;

            // [NEW] Resume Logic (First Mount)
            if (!initialLoadDone.current && (global as any).currentInitialProgress !== undefined) {
                const resumeProg = (global as any).currentInitialProgress || 0;
                if (resumeProg > 0) {
                    startOffset = Math.floor(resumeProg * scripts[currentPage].script.length);
                    console.log("Resuming from saved progress:", resumeProg, "Offset:", startOffset);
                }
                initialLoadDone.current = true;
            } else if (targetPageOffset.current !== null) {
                // Seek Logic
                startOffset = targetPageOffset.current;
                targetPageOffset.current = null; // Reset
            }

            setCurrentTextOffset(startOffset);

            // Calculate progress based on this offset
            const scriptLen = Math.max(1, scripts[currentPage].script.length);
            setProgress(startOffset / scriptLen);

            speechStartTime.current = null; // Reset timing
            if (isPlaying) {
                // Background Playback Fix:
                // JS Timers (setTimeout) often stall in background.
                // Speech.speak() interrupts automatically, so we call it directly.
                // This maximizes the chance of the OS processing the next chunk immediately.
                playFrom(startOffset);
            }
        }
    }, [currentPage]);

    // [NEW] Custom Back Handler to Save State
    const handleBack = async () => {
        Speech.stop();
        if (bookId) {
            // Save current state
            // progress is state 0..1
            console.log("Saving state on exit...", currentPage, progress);
            await updateBookProgress(bookId, currentPage, progress);
        }
        router.back();
    };

    // Calculate a more accurate rate based on recorded durations
    const recalculateRate = (currentScripts: ScriptItem[]) => {
        let totalChars = 0;
        let totalTime = 0;
        let count = 0;

        currentScripts.forEach(s => {
            if (s.duration && s.duration > 0) {
                totalChars += s.script.length;
                totalTime += s.duration;
                count++;
            }
        });

        if (count > 0 && totalTime > 0) {
            const newRate = totalChars / totalTime;
            // Sanity check: between 5 and 30 chars/sec
            if (newRate > 5 && newRate < 30) {
                setEstimatedCharRate(newRate);
            }
        }
    };

    const loadVoices = async () => {
        try {
            const availableVoices = await Speech.getAvailableVoicesAsync();
            const allowedLocales = ['en-US', 'en-GB', 'en-IN', 'hi-IN'];

            const filteredVoices = availableVoices.filter(v => {
                const lang = v.language.replace('_', '-');
                return allowedLocales.some(loc => lang.includes(loc));
            }).sort((a, b) => {
                if (a.language !== b.language) return a.language.localeCompare(b.language);
                return a.name.localeCompare(b.name);
            });

            setVoices(filteredVoices);

            if (filteredVoices.length > 0) {
                const defaultVoice = filteredVoices.find(v => v.language.includes('en-IN') || v.language.includes('en-US')) || filteredVoices[0];
                setSelectedVoice(defaultVoice);
            }
        } catch (e) {
            console.error("Failed to load voices", e);
        }
    };

    // Helper for cleaner names (omitted for brevity, assume unchanged logic or simplified)
    const getVoiceLabel = (voice: Speech.Voice) => {
        return { name: voice.name, detail: voice.language };
    };

    const updatePageDuration = async (duration: number) => {
        if (!scripts[currentPage]) return;

        // Update local state
        const updatedScripts = [...scripts];
        updatedScripts[currentPage].duration = duration;
        setScripts(updatedScripts);

        // REMOVED: recalculateRate(updatedScripts); 
        // We want the EMA (updateRate) to drive the current session's estimation, 
        // not the historical global average.

        // Auto-save if we have an ID
        if (bookId) {
            await saveBook(bookTitle, updatedScripts, bookId);
        }
    };

    const updateRate = (charsPlayed: number, timeTaken: number) => {
        if (timeTaken <= 0 || charsPlayed <= 0) return;

        // Normalize time taken to 1.0x speed
        // If I listened for 10s at 2x speed, I heard 20s worth of audio (relative to 1x)
        // Rate = Chars / Time(at 1x)
        // Time(at 1x) = timeTaken * currentSpeed

        const realDurationAt1x = timeTaken * currentSpeed;
        const instantRate = charsPlayed / realDurationAt1x;

        // EMA Formula: Rate = (Old * 0.4) + (Current * 0.6)
        setEstimatedCharRate(prevRate => {
            const newRate = (prevRate * 0.4) + (instantRate * 0.6);
            console.log(`[Smart Rate] Chars: ${charsPlayed}, Time: ${timeTaken.toFixed(2)}s, Instant: ${instantRate.toFixed(1)}, New EMA: ${newRate.toFixed(1)}`);
            return newRate;
        });
    };

    const playFrom = (startCharIndex: number, speedOverride?: number) => {
        if (!scripts[currentPage]) return;
        const fullText = scripts[currentPage].script;

        if (startCharIndex >= fullText.length) {
            setIsPlaying(false);
            if (currentPage < scripts.length - 1 && isAutoplay) {
                setCurrentPage((p: number) => p + 1);
            }
            return;
        }
        if (startCharIndex < 0) startCharIndex = 0;

        const textToSpeak = fullText.substring(startCharIndex);
        setCurrentTextOffset(startCharIndex);

        // Start tracking session
        speechStartTime.current = Date.now();
        speechStartChar.current = startCharIndex;
        lastRateUpdateRef.current = Date.now();

        const speedToUse = speedOverride || currentSpeed;

        const options: Speech.SpeechOptions = {
            rate: speedToUse,
            onDone: () => {
                if (!isSeekingRef.current && speechStartTime.current) {
                    const startTime = speechStartTime.current;
                    // Calculate stats for this segment
                    const timeTaken = (Date.now() - startTime) / 1000;
                    const endCharIndex = fullText.length; // Finished
                    const charsPlayed = endCharIndex - speechStartChar.current;

                    updateRate(charsPlayed, timeTaken);
                    speechStartTime.current = null;

                    // Also complete page duration logic (legacy/fallback)
                    updatePageDuration((Date.now() - startTime) / 1000 * speedToUse);

                    if (currentPage < scripts.length - 1) {
                        if (isAutoplay) {
                            setCurrentPage((p: number) => p + 1);
                        } else {
                            setIsPlaying(false);
                            setCurrentPage((p: number) => p + 1);
                        }
                    } else {
                        setIsPlaying(false);
                        setProgress(1);
                    }
                }
            },
            onStopped: () => {
                // If stopped manually (pause), we still learn from the segment!
                if (!isSeekingRef.current && speechStartTime.current && isPlaying) {
                    const timeTaken = (Date.now() - speechStartTime.current) / 1000;
                    // We don't know EXACT char we stopped at easily in 'onStopped' without boundary tracking
                    // Rely on boundary update? 
                    // 'progress' state is up to date roughly.
                    const currentEstimatedChar = Math.floor(progress * pageTextLength);
                    const charsPlayed = currentEstimatedChar - speechStartChar.current;

                    // Only update if significant
                    if (timeTaken > 2) {
                        updateRate(charsPlayed, timeTaken);
                    }
                }
                if (!isSeekingRef.current) setIsPlaying(false);
                speechStartTime.current = null;
            },
            onBoundary: (event: any) => {
                if (!isSeekingRef.current) {
                    const realIndex = startCharIndex + event.charIndex;
                    const newProg = realIndex / fullText.length;
                    setProgress(newProg);

                    // Real-Time Adaptation Logic (User Request: "for each second update the speed")
                    const now = Date.now();
                    const timeSinceLastUpdate = (now - lastRateUpdateRef.current) / 1000;

                    if (timeSinceLastUpdate >= 1.0 && speechStartTime.current) { // Update every 1 second
                        const sessionDuration = (now - speechStartTime.current) / 1000;
                        const charsProcessedTotal = realIndex - speechStartChar.current;

                        // Use the ACTUAL speed being used (speedToUse)
                        const realDuration1x = sessionDuration * speedToUse;
                        if (realDuration1x > 0) {
                            const instantRate = charsProcessedTotal / realDuration1x;

                            // Sanity check for instant rate before letting it affect EMA
                            if (instantRate > 2.0 && instantRate < 50.0) {
                                setEstimatedCharRate(prev => {
                                    let newRate = (prev * 0.4) + (instantRate * 0.6);
                                    // CLAMPING
                                    if (newRate < MIN_RATE) newRate = MIN_RATE;
                                    if (newRate > MAX_RATE) newRate = MAX_RATE;
                                    return newRate;
                                });
                            }
                        }

                        lastRateUpdateRef.current = now;
                    }
                }
            }
        };

        if (selectedVoice) {
            options.voice = selectedVoice.identifier;
        }

        Speech.speak(textToSpeak, options);
        setIsPlaying(true);
    };

    const togglePlay = async () => {
        const isSpeaking = await Speech.isSpeakingAsync();
        if (isSpeaking) {
            Speech.stop();
            setIsPlaying(false);
        } else {
            const resumeIndex = Math.floor(progress * pageTextLength);
            playFrom(resumeIndex);
        }
    };

    const seekBySeconds = (seconds: number) => {
        Speech.stop();
        isSeekingRef.current = true;

        // Use dynamic rate for seeking calculations too!
        const charsToSkip = Math.round(seconds * estimatedCharRate * currentSpeed);
        const currentRealIndex = Math.floor(progress * pageTextLength);
        let newIndex = currentRealIndex + charsToSkip;

        // [NEW] Smart Previous Page Logic
        if (newIndex < 0) {
            if (currentPage > 0) {
                // Determine how far back we went (e.g. -50 chars)
                const overflow = newIndex;
                // Get previous page length
                const prevPageLen = scripts[currentPage - 1].script.length;
                // Target is (Length - Overflow), e.g. Length + (-50)
                let targetIndex = prevPageLen + overflow;
                if (targetIndex < 0) targetIndex = 0; // Cap at start of prev page

                console.log(`Rewinding to Previous Page. Overflow: ${overflow}, Target: ${targetIndex}`);

                targetPageOffset.current = targetIndex;
                setCurrentPage((p: number) => p - 1);

                // We don't playFrom here because useEffect(currentPage) will handle it
                // Just clear seeking flag after a tiny delay to allow render
                setTimeout(() => { isSeekingRef.current = false; }, 100);
                return;
            } else {
                newIndex = 0; // Cap at start of book
            }
        }

        if (newIndex > pageTextLength) {
            // [Optional] Smart Next Page logic could go here, but strict request was only for -10s
            newIndex = pageTextLength - 1;
        }

        setProgress(newIndex / pageTextLength);

        setTimeout(() => {
            isSeekingRef.current = false;
            playFrom(newIndex);
        }, 100);
    };

    const handleSliderComplete = (value: number) => {
        Speech.stop();
        isSeekingRef.current = true;
        const newIndex = Math.floor(value * pageTextLength);
        setTimeout(() => {
            isSeekingRef.current = false;
            playFrom(newIndex);
        }, 100);
    };

    const changeSpeed = async () => {
        const currentIndex = SPEEDS.indexOf(currentSpeed);
        const nextIndex = (currentIndex + 1) % SPEEDS.length;
        const newSpeed = SPEEDS[nextIndex];
        setCurrentSpeed(newSpeed);

        const isSpeaking = await Speech.isSpeakingAsync();
        if (isSpeaking) {
            Speech.stop();
            isSeekingRef.current = true;
            setTimeout(() => {
                isSeekingRef.current = false;
                const currentPos = Math.floor(progress * pageTextLength);
                // PASS NEW SPEED DYNAMICALLY
                playFrom(currentPos, newSpeed);
            }, 100);
        }
    };

    const selectVoice = (voice: Speech.Voice) => {
        setSelectedVoice(voice);
        setShowVoiceModal(false);
    };

    const handleSave = async () => {
        if (!scripts || scripts.length === 0) {
            alert("No content to save.");
            return;
        }
        const newId = await saveBook(bookTitle, scripts, bookId);
        setBookId(newId); // Now it's a saved book
        alert("Book saved to your library!");
    };


    // DYNAMIC TIME CALCULATION
    // User Formula: Total Time = Total Char / Speed
    // Current Time = % * Total Time

    const effectiveRate = estimatedCharRate * currentSpeed;
    const safeRate = (effectiveRate > 0) ? effectiveRate : 15.0; // Prevent div by zero

    // Current Page
    const currentPageChars = scripts[currentPage]?.script.length || 0;
    const displayPageDuration = currentPageChars / safeRate;
    const displayCurrentPageTime = displayPageDuration * progress;

    // Total Book
    const totalBookChars = scripts.reduce((acc, s) => acc + s.script.length, 0);
    const displayTotalTime = totalBookChars / safeRate;

    // Global Progress is approximate based on chars vs total chars
    // This is more stable than summing time durations which might vary
    const previousPagesChars = scripts.slice(0, currentPage).reduce((acc, s) => acc + s.script.length, 0);
    const currentProgressChars = previousPagesChars + (currentPageChars * progress);
    const displayGlobalProgress = currentProgressChars / safeRate;

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <Stack.Screen
                options={{
                    title: bookTitle,
                    headerLeft: () => (
                        <TouchableOpacity onPress={handleBack} style={{ marginLeft: 0, paddingRight: 10 }}>
                            <Ionicons name="arrow-back" size={24} color={colors.text} />
                        </TouchableOpacity>
                    ),
                    headerRight: () => (
                        <TouchableOpacity onPress={handleSave} style={{ marginRight: 10 }}>
                            <Ionicons name={bookId ? "checkmark-circle" : "save-outline"} size={24} color={colors.text} />
                        </TouchableOpacity>
                    )
                }}
            />
            <View style={styles.artContainer}>
                {scripts[currentPage] && scripts[currentPage].visual_prompt ? (
                    <Image
                        source={{ uri: `https://image.pollinations.ai/prompt/${encodeURIComponent(scripts[currentPage].visual_prompt)}?nologo=true` }}
                        style={styles.artPlaceholder}
                        resizeMode="cover"
                    />
                ) : (
                    <View style={styles.artPlaceholder}>
                        <Ionicons name="musical-notes" size={80} color="#fff" />
                    </View>
                )}

                <Text style={[styles.title, { color: colors.text }]}>Page {currentPage + 1}</Text>
                <Text style={[styles.subtitle, { color: colors.subtext }]}>{selectedVoice ? `Voice: ${selectedVoice.name}` : 'Default Voice'}</Text>

                {/* Visual Indicator of Smart Mode */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 5 }}>
                    <Ionicons name="flash-outline" size={12} color={colors.primary} />
                    <Text style={{ fontSize: 10, color: colors.subtext }}>
                        Effective Speed: {(estimatedCharRate * currentSpeed).toFixed(1)} chars/s {scripts.some(s => s.duration) ? '(Smart)' : '(Default)'}
                    </Text>
                </View>

                <TouchableOpacity
                    style={[styles.autoplayBadge, { backgroundColor: isDark ? colors.card : '#eee' }, isAutoplay && styles.autoplayBadgeActive]}
                    onPress={() => setIsAutoplay(!isAutoplay)}
                >
                    <Ionicons name="infinite" size={16} color={isAutoplay ? "#fff" : colors.subtext} />
                    <Text style={[styles.autoplayText, { color: isAutoplay ? "#fff" : colors.subtext }]}>
                        AutoPlay: {isAutoplay ? "ON" : "OFF"}
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.controls}>
                <View style={styles.progressContainer}>
                    <View style={styles.timeLabels}>
                        <Text style={[styles.timeText, { color: colors.subtext }]}>{formatTime(displayCurrentPageTime)}</Text>
                        <Text style={[styles.timeText, { color: colors.subtext }]}>{formatTime(displayPageDuration)}</Text>
                    </View>
                    <Slider
                        style={styles.slider}
                        minimumValue={0}
                        maximumValue={1}
                        value={progress}
                        onSlidingComplete={handleSliderComplete}
                        minimumTrackTintColor={colors.primary}
                        maximumTrackTintColor={colors.border}
                        thumbTintColor={colors.primary}
                        onValueChange={(val) => {
                            setProgress(val);
                        }}
                    />
                    <Text style={[styles.totalBookTime, { color: colors.primary }]}>
                        Total Book Listened: {formatTime(displayGlobalProgress)} / {formatTime(displayTotalTime)}
                    </Text>
                </View>

                <View style={styles.buttonsRow}>
                    <TouchableOpacity onPress={changeSpeed} style={styles.speedButton}>
                        <Text style={[styles.speedText, { color: colors.text }]}>{currentSpeed}x</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => seekBySeconds(-10)} style={styles.secondaryButton}>
                        <Ionicons name="play-back" size={30} color={colors.text} />
                        <Text style={[styles.tinyText, { color: colors.subtext }]}>-10s</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={togglePlay} style={[styles.playButton, { backgroundColor: colors.primary }]}>
                        <Ionicons name={isPlaying ? "pause" : "play"} size={40} color="white" />
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => seekBySeconds(10)} style={styles.secondaryButton}>
                        <Ionicons name="play-forward" size={30} color={colors.text} />
                        <Text style={[styles.tinyText, { color: colors.subtext }]}>+10s</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => setShowVoiceModal(true)} style={styles.actionButton}>
                        <Ionicons name="options" size={24} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Voice Modal - Simplified for brevity in this replacement */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={showVoiceModal}
                onRequestClose={() => setShowVoiceModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Voice</Text>
                            <TouchableOpacity onPress={() => setShowVoiceModal(false)}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={voices}
                            keyExtractor={(item) => item.identifier}
                            renderItem={({ item }) => {
                                // Simplified label logic
                                return (
                                    <TouchableOpacity
                                        style={[
                                            styles.voiceItem,
                                            { borderBottomColor: colors.border },
                                            selectedVoice?.identifier === item.identifier && { backgroundColor: isDark ? colors.tint : '#f0f8ff' }
                                        ]}
                                        onPress={() => selectVoice(item)}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.voiceName, { color: colors.text }]}>{item.name}</Text>
                                            <Text style={[styles.voiceLang, { color: colors.subtext }]}>{item.language}</Text>
                                        </View>
                                    </TouchableOpacity>
                                )
                            }}
                        />
                    </View>
                </View>
            </Modal>
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'space-between',
        padding: 24,
    },
    progressContainer: {
        width: '100%',
        marginBottom: 30,
    },
    timeLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 5,
        paddingHorizontal: 10,
    },
    timeText: {
        fontSize: 12,
        fontVariant: ['tabular-nums'],
    },
    totalBookTime: {
        textAlign: 'center',
        fontSize: 14,
        fontWeight: '600',
        marginTop: 10,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    artContainer: {
        marginTop: 60,
        alignItems: 'center',
    },
    artPlaceholder: {
        width: 200,
        height: 200,
        borderRadius: 20,
        backgroundColor: '#FF7043',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        shadowColor: '#FF7043',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 10,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
    },
    autoplayBadge: {
        marginTop: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6
    },
    autoplayBadgeActive: {
        backgroundColor: '#4285F4',
    },
    autoplayText: {
        fontSize: 12,
        fontWeight: '600',
    },
    controls: {
        marginBottom: 40,
    },
    buttonsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    playButton: {
        width: 70,
        height: 70,
        borderRadius: 35,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#4285F4',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    secondaryButton: {
        padding: 10,
        alignItems: 'center',
    },
    tinyText: {
        fontSize: 10,
        marginTop: 2,
    },
    speedButton: {
        width: 50,
        alignItems: 'center',
    },
    speedText: {
        fontWeight: 'bold',
    },
    actionButton: {
        width: 50,
        alignItems: 'center',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        height: '60%',
        padding: 20,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        borderBottomWidth: 1,
        paddingBottom: 10,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    voiceItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 15,
        borderBottomWidth: 1,
    },
    voiceName: {
        fontSize: 16,
        fontWeight: '500',
    },
    voiceLang: {
        fontSize: 12,
    },
});
