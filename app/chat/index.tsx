import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { db } from '../../src/config/firebase';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';

export default function ChatList() {
    const { user } = useAuth();
    const { colors, isDark } = useTheme();
    const router = useRouter();
    const [chats, setChats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'chats'),
            where('participants', 'array-contains', user.uid),
            // ordering requires index. skip for now or sort client side
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Client-side sort by lastMessage.createdAt
            list.sort((a: any, b: any) => {
                const da = new Date(a.lastMessage?.createdAt || 0);
                const db = new Date(b.lastMessage?.createdAt || 0);
                return db.getTime() - da.getTime();
            });

            setChats(list);
            setLoading(false);
        });

        return unsubscribe;
    }, [user]);

    const getOtherParticipantName = (chat: any) => {
        const otherId = chat.participants.find((id: string) => id !== user?.uid);
        return chat.participantNames?.[otherId] || 'Unknown User';
    };

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={[styles.chatItem, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
            onPress={() => router.push(`/chat/${item.id}?name=${encodeURIComponent(getOtherParticipantName(item))}`)}
        >
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={{ color: '#FFF', fontSize: 18, fontWeight: 'bold' }}>
                    {getOtherParticipantName(item).charAt(0).toUpperCase()}
                </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 15 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={[styles.name, { color: colors.text }]}>{getOtherParticipantName(item)}</Text>
                    <Text style={{ color: colors.subtext, fontSize: 12 }}>
                        {item.lastMessage?.createdAt ? format(new Date(item.lastMessage.createdAt), 'MMM d, h:mm a') : ''}
                    </Text>
                </View>
                <Text style={{ color: colors.subtext, marginTop: 4 }} numberOfLines={1}>
                    {item.lastMessage?.text || 'No messages yet'}
                </Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {loading ? (
                <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
            ) : (
                <FlatList
                    data={chats}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    ListEmptyComponent={
                        <View style={{ alignItems: 'center', marginTop: 100 }}>
                            <Ionicons name="chatbubbles-outline" size={60} color={colors.border} />
                            <Text style={{ color: colors.subtext, marginTop: 20 }}>No messages yet</Text>
                        </View>
                    }
                />
            )}

            <TouchableOpacity
                style={[styles.fab, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/chat/new')}
            >
                <Ionicons name="add" size={30} color="#FFF" />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    chatItem: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, alignItems: 'center' },
    avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    name: { fontSize: 16, fontWeight: 'bold' },
    fab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3 }
});
