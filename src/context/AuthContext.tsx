import React, { createContext, useState, useEffect, useContext } from 'react';
import { auth, db } from '../config/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { AppState, AppStateStatus } from 'react-native';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    setUser: (user: User | null) => void;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    setUser: () => { },
    logout: async () => { }
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const logout = async () => {
        try {
            await auth.signOut();
        } catch (e) {
            console.error("Logout failed", e);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    // Handle User Profile Sync & Online Status
    useEffect(() => {
        if (!user) return;

        const syncUserProfile = async () => {
            try {
                const userRef = doc(db, "users", user.uid);
                // Blindly merge essential info to ensure "presence" in the list
                // We avoid overwriting 'createdAt' if possible, but ensuring the doc exists is priority.
                await setDoc(userRef, {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || 'User',
                    isOnline: true,
                    lastSeen: new Date().toISOString()
                }, { merge: true });
            } catch (e: any) {
                // Ignore offline errors, common on startup
                const msg = e.message || e.toString();
                if (msg.toLowerCase().includes("offline")) return;
                console.error("Profile sync failed", e);
            }
        };

        syncUserProfile();
    }, [user]);

    // Handle App State (Online/Offline)
    useEffect(() => {
        if (!user) return;
        const userRef = doc(db, "users", user.uid);

        const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
                updateDoc(userRef, { isOnline: true }).catch(e => console.log('Online update failed', e));
            } else {
                updateDoc(userRef, { isOnline: false }).catch(e => console.log('Offline update failed', e));
            }
        });

        return () => {
            subscription.remove();
            // Also set offline on unmount? (Hard to do reliable in RN, AppState is best effort)
            updateDoc(userRef, { isOnline: false }).catch(e => console.log('Offline unmount failed', e));
        };
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, loading, setUser, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
