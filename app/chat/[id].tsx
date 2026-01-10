import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert, Text, TouchableOpacity, Linking, Platform } from 'react-native';
import { GiftedChat, Bubble, Send, InputToolbar, Actions, Composer } from 'react-native-gifted-chat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { db } from '../../src/config/firebase';
import { collection, doc, query, orderBy, onSnapshot, deleteDoc, getDoc } from 'firebase/firestore';
import { sendMessage, uploadFile, getUserOnlineStatus } from '../../src/services/chat';
import { saveLocalMessages, getLocalMessages } from '../../src/services/chatStorage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';

export default function ChatScreen() {
    const { id } = useLocalSearchParams();
    const chatId = Array.isArray(id) ? id[0] : id; // safe check
    const { name } = useLocalSearchParams();

    const { user } = useAuth();
    const { colors, isDark } = useTheme();
    const router = useRouter();

    const [messages, setMessages] = useState<any[]>([]);
    const [participants, setParticipants] = useState<string[]>([]);

    useEffect(() => {
        if (!chatId || !user) return;

        const loadLocal = async () => {
            const local = await getLocalMessages(chatId);
            setMessages(local);
        };
        loadLocal();

        getDoc(doc(db, 'chats', chatId)).then(snap => {
            if (snap.exists()) {
                setParticipants(snap.data().participants || []);
            }
        });

        const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const msgData = change.doc.data();
                const msgId = change.doc.id;

                if (change.type === 'added') {
                    const msg = {
                        _id: msgId,
                        text: msgData.text,
                        createdAt: new Date(msgData.createdAt),
                        user: msgData.user,
                        image: msgData.image,
                        file: msgData.file
                    };

                    setMessages(previousMessages => {
                        // Avoid duplicates if already loaded from local
                        if (previousMessages.some(m => m._id === msgId)) return previousMessages;
                        const newMsgs = GiftedChat.append(previousMessages, [msg]);
                        saveLocalMessages(chatId, newMsgs); // Persist
                        return newMsgs;
                    });

                    // EPHEMERAL LOGIC: Delete from server once 'received' (added to local state)
                    if (msgData.user._id !== user.uid) {
                        deleteDoc(change.doc.ref).catch(e => console.log("Delete failed", e));
                    }
                }
                if (change.type === 'removed') {
                    // Update tick to READ locally, BUT DO NOT DELETE from local state
                    setMessages(previousMessages => {
                        const updated = previousMessages.map(m => {
                            if (m._id === msgId) {
                                return { ...m, received: true };
                            }
                            return m;
                        });
                        saveLocalMessages(chatId, updated); // Persist tick update
                        return updated;
                    });
                }
            });
        });

        return unsubscribe;
    }, [chatId, user]);

    const onSend = useCallback((newMessages: any[] = []) => {
        const text = newMessages[0].text;
        // Optimistic update
        setMessages(previousMessages => {
            const updated = GiftedChat.append(previousMessages, newMessages);
            saveLocalMessages(chatId, updated);
            return updated;
        });
        sendMessage(chatId, text, user);
    }, [chatId, user]);

    const handlePickData = async (type: 'image' | 'file') => {
        try {
            let result;
            let uri, fileSize;

            if (type === 'image') {
                result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ImagePicker.MediaTypeOptions.Images,
                    quality: 0.8,
                });
                if (result.canceled) return;
                uri = result.assets[0].uri;
                const info = await FileSystem.getInfoAsync(uri);
                if (info.exists) fileSize = info.size;
            } else {
                result = await DocumentPicker.getDocumentAsync({});
                if (result.canceled) return;
                uri = result.assets[0].uri;
                fileSize = result.assets[0].size;
            }

            if (!uri) return;

            const LIMIT = 10 * 1024 * 1024;
            if (fileSize && fileSize > LIMIT) {
                const otherUid = participants.find(pid => pid !== user?.uid);
                if (!otherUid) { Alert.alert("Error", "Cannot verify user."); return; }

                const isOnline = await getUserOnlineStatus(otherUid);
                if (!isOnline) {
                    Alert.alert("User Offline", "Big files >10MB require user online.");
                    return;
                }
            }

            const path = `chat/${chatId}/${Date.now()}_${type === 'image' ? 'img.jpg' : 'file'}`;
            const downloadUrl = await uploadFile(uri, path);
            sendMessage(chatId, '', user, type === 'image' ? downloadUrl : undefined, type === 'file' ? downloadUrl : undefined);

        } catch (e) {
            Alert.alert("Error", "Failed to share file.");
        }
    };

    const handleImportQuiz = async (url: string) => {
        try {
            const fileUri = (FileSystem.documentDirectory || '') + 'temp_quiz.json';
            const { uri } = await FileSystem.downloadAsync(url, fileUri);
            const content = await FileSystem.readAsStringAsync(uri);
            const quizData = JSON.parse(content);

            if (!quizData.id || !quizData.mcqs) {
                Alert.alert("Error", "Invalid quiz file format.");
                return;
            }

            const QUIZZES_DIR = (FileSystem.documentDirectory || '') + 'saved_quizzes/';
            const targetPath = QUIZZES_DIR + quizData.id + '.json';

            const dirInfo = await FileSystem.getInfoAsync(QUIZZES_DIR);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(QUIZZES_DIR, { intermediates: true });
            }

            // Check if already exists? Overwrite for now.
            await FileSystem.writeAsStringAsync(targetPath, JSON.stringify(quizData));
            Alert.alert("Success", "Quiz imported! Check Dashboard.");

        } catch (e) {
            console.error(e);
            Alert.alert("Error", "Failed to import quiz.");
        }
    };

    const renderActions = (props: any) => (
        <Actions
            {...props}
            options={{
                'Send Image': () => handlePickData('image'),
                'Send File': () => handlePickData('file'),
                'Cancel': () => { },
            }}
            icon={() => <Ionicons name="add" size={28} color={colors.primary} />}
        />
    );

    const renderBubble = (props: any) => (
        <Bubble
            {...props}
            wrapperStyle={{
                right: { backgroundColor: colors.primary },
                left: { backgroundColor: colors.card },
            }}
            textStyle={{
                right: { color: '#FFF' },
                left: { color: colors.text },
            }}
        />
    );

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <GiftedChat
                messages={messages}
                onSend={messages => onSend(messages)}
                user={{
                    _id: user?.uid || '',
                    name: user?.displayName || 'User',
                }}
                renderBubble={renderBubble}
                renderActions={renderActions}
                renderInputToolbar={(props) => (
                    <InputToolbar
                        {...props}
                        containerStyle={{ backgroundColor: colors.card, borderTopColor: colors.border }}
                    />
                )}
                renderComposer={(props) => (
                    <Composer
                        {...props}
                        // @ts-ignore
                        textInputStyle={{ color: colors.text, backgroundColor: colors.card, paddingTop: 10, paddingHorizontal: 10, marginLeft: 0 }}
                    />
                )}
                renderMessageText={(props) => {
                    const { currentMessage } = props;
                    if (currentMessage?.file) {
                        const isJson = currentMessage.file.includes('.json') || (currentMessage.text && currentMessage.text.includes('Quiz'));

                        return (
                            <View style={{ padding: 5 }}>
                                {isJson ? (
                                    <TouchableOpacity onPress={() => handleImportQuiz(currentMessage.file)}>
                                        <Text style={{ color: colors.primary, fontWeight: 'bold', padding: 10 }}>
                                            📥 Import Quiz
                                        </Text>
                                    </TouchableOpacity>
                                ) : (
                                    <TouchableOpacity onPress={() => Linking.openURL(currentMessage.file)}>
                                        <Text style={{ color: colors.primary, textDecorationLine: 'underline', padding: 10 }}>
                                            🖇️ View Shared File
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )
                    }
                    return <Text style={{ color: props.position === 'left' ? colors.text : '#fff', fontSize: 16, margin: 5 }}>{currentMessage.text}</Text>
                }}
                // @ts-ignore
                renderTicks={(message) => {
                    if (message.received) {
                        return <Text style={{ color: '#81D4FA', fontSize: 10 }}>✓✓</Text>
                    }
                    return <Text style={{ color: 'white', fontSize: 10 }}>✓</Text>
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({});
