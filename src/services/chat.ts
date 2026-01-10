import { db, storage } from '../config/firebase';
import { collection, addDoc, query, where, getDocs, orderBy, onSnapshot, doc, setDoc, updateDoc, deleteDoc, getDoc, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

export const createChat = async (currentUserId: string, otherUserId: string, otherUserName: string) => {
    // Check if chat exists
    // We can composite key or query. For simplicity, we query.
    // Actually, a composite key "uid1_uid2" (sorted) is best for 1-on-1.
    const sortedIds = [currentUserId, otherUserId].sort();
    const chatId = `${sortedIds[0]}_${sortedIds[1]}`;
    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
        await setDoc(chatRef, {
            participants: sortedIds,
            createdAt: new Date().toISOString(),
            lastMessage: { text: 'Chat started', createdAt: new Date().toISOString() },
            participantNames: { [otherUserId]: otherUserName } // basic cache
        });
    }

    return chatId;
};

export const sendMessage = async (chatId: string, text: string, user: any, image?: string, file?: string) => {
    const msgData: any = {
        _id: Date.now().toString(), // or UUID
        text: text || '',
        createdAt: new Date().toISOString(),
        user: {
            _id: user.uid,
            name: user.displayName,
        },
        // We add a 'delivered' flag. If false, it's just sent.
        pending: true
    };

    if (image) msgData.image = image;
    if (file) msgData.file = file;

    // Add to subcollection
    await addDoc(collection(db, 'chats', chatId, 'messages'), msgData);

    // Update last message
    await updateDoc(doc(db, 'chats', chatId), {
        lastMessage: {
            text: image ? '📷 Image' : (file ? '📎 File' : text),
            createdAt: new Date().toISOString()
        }
    });
};

export const uploadFile = async (uri: string, path: string) => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob);
    return await getDownloadURL(storageRef);
};

export const deleteFile = async (path: string) => {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef).catch(e => console.log("Delete error", e));
};

export const getUserOnlineStatus = async (uid: string) => {
    const d = await getDoc(doc(db, 'users', uid));
    return d.exists() ? d.data().isOnline : false;
};

// --- Friend & User Discovery ---

export const getAllUsers = async (limitCount = 50) => {
    const q = query(collection(db, 'users'), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const sendFriendRequest = async (fromUid: string, toUid: string) => {
    // Check if request already exists
    const q = query(
        collection(db, 'friend_requests'),
        where('from', '==', fromUid),
        where('to', '==', toUid)
    );
    const snap = await getDocs(q);
    if (!snap.empty) return; // Already sent

    await addDoc(collection(db, 'friend_requests'), {
        from: fromUid,
        to: toUid,
        status: 'pending',
        createdAt: new Date().toISOString()
    });
};

export const getFriendRequests = async (uid: string) => {
    // Get requests sent by me and received by me
    const sentQ = query(collection(db, 'friend_requests'), where('from', '==', uid));
    const receivedQ = query(collection(db, 'friend_requests'), where('to', '==', uid));

    const [sentSnap, receivedSnap] = await Promise.all([getDocs(sentQ), getDocs(receivedQ)]);

    const sent = sentSnap.docs.map(d => ({ id: d.id, ...d.data(), type: 'sent' }));
    const received = receivedSnap.docs.map(d => ({ id: d.id, ...d.data(), type: 'received' }));

    return [...sent, ...received];
};
