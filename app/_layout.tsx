import 'react-native-reanimated';
import { LogBox } from 'react-native';

// Suppress known deprecation warnings
LogBox.ignoreLogs(['Expo AV has been deprecated']);

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider as NavThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';

import { AuthProvider } from '../src/context/AuthContext';

function LayoutContent() {
    const { theme } = useTheme();

    return (
        <NavThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="login" options={{ headerShown: false }} />
                <Stack.Screen name="signup" options={{ headerShown: false }} />
                <Stack.Screen
                    name="dashboard"
                    options={{
                        title: 'Dashboard',
                        headerStyle: { backgroundColor: theme === 'dark' ? '#1E1E1E' : '#FFFFFF' },
                        headerTintColor: theme === 'dark' ? '#FFFFFF' : '#000000',
                    }}
                />
                <Stack.Screen
                    name="player"
                    options={{
                        title: 'Now Playing',
                        headerStyle: { backgroundColor: theme === 'dark' ? '#1E1E1E' : '#FFFFFF' },
                        headerTintColor: theme === 'dark' ? '#FFFFFF' : '#000000',
                    }}
                />
                <Stack.Screen
                    name="quiz/input"
                    options={{
                        title: 'Create Quiz',
                        headerStyle: { backgroundColor: theme === 'dark' ? '#1E1E1E' : '#FFFFFF' },
                        headerTintColor: theme === 'dark' ? '#FFFFFF' : '#000000',
                    }}
                />
                <Stack.Screen
                    name="quiz/game"
                    options={{
                        headerShown: false
                    }}
                />
                <Stack.Screen
                    name="quiz/result"
                    options={{
                        headerShown: false
                    }}
                />
            </Stack>
            <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        </NavThemeProvider>
    );
}

export default function RootLayout() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <LayoutContent />
            </AuthProvider>
        </ThemeProvider>
    );
}

