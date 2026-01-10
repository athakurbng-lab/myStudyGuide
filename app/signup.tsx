import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/context/ThemeContext';
import { auth, db } from '../src/config/firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { setDoc, doc } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';

export default function SignupScreen() {
    const { colors, isDark } = useTheme();
    const router = useRouter();

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSignup = async () => {
        if (!name || !email || !password) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }
        setLoading(true);
        try {
            // 1. Create Auth User
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Update Auth Profile
            await updateProfile(user, { displayName: name });

            // 3. Create Firestore Profile
            try {
                await setDoc(doc(db, "users", user.uid), {
                    uid: user.uid,
                    email: user.email,
                    displayName: name,
                    photoURL: null,
                    createdAt: new Date().toISOString(),
                    isOnline: true
                });
            } catch (fsError) {
                console.warn("Firestore profile creation failed (offline?):", fsError);
                // We typically still want to let them in, AuthContext will try to sync later
            }

            Alert.alert("Success", "Account created successfully!");
            // Ensure navigation happens
            setTimeout(() => router.replace('/dashboard'), 100);
        } catch (e: any) {
            Alert.alert('Signup Failed', e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.formContainer}>
                <View style={{ alignItems: 'center', marginBottom: 40 }}>
                    <Ionicons name="person-add" size={60} color={colors.primary} />
                    <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
                    <Text style={{ color: colors.subtext }}>Join the community</Text>
                </View>

                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="person-outline" size={20} color={colors.subtext} style={{ marginLeft: 10 }} />
                    <TextInput
                        style={[styles.input, { color: colors.text }]}
                        placeholder="Full Name"
                        placeholderTextColor={colors.subtext}
                        value={name}
                        onChangeText={setName}
                    />
                </View>

                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="mail-outline" size={20} color={colors.subtext} style={{ marginLeft: 10 }} />
                    <TextInput
                        style={[styles.input, { color: colors.text }]}
                        placeholder="Email"
                        placeholderTextColor={colors.subtext}
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                    />
                </View>

                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="lock-closed-outline" size={20} color={colors.subtext} style={{ marginLeft: 10 }} />
                    <TextInput
                        style={[styles.input, { color: colors.text }]}
                        placeholder="Password"
                        placeholderTextColor={colors.subtext}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />
                </View>

                <TouchableOpacity
                    style={[styles.button, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
                    onPress={handleSignup}
                    disabled={loading}
                >
                    {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Sign Up</Text>}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
                    <Text style={{ color: colors.subtext, textAlign: 'center' }}>
                        Already have an account? <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Log In</Text>
                    </Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 20 },
    formContainer: { maxWidth: 400, width: '100%', alignSelf: 'center' },
    title: { fontSize: 28, fontWeight: 'bold', marginTop: 10, marginBottom: 5 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: 12, borderWidth: 1, marginBottom: 15 },
    input: { flex: 1, height: '100%', paddingHorizontal: 10 },
    button: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 },
    buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' }
});
