import { Stack } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';

export default function ChatLayout() {
    const { colors, isDark } = useTheme();

    return (
        <Stack
            screenOptions={{
                headerStyle: { backgroundColor: colors.card },
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: 'bold' },
            }}
        >
            <Stack.Screen name="index" options={{ title: 'Messages' }} />
            <Stack.Screen name="[id]" options={{ title: 'Chat' }} />
            <Stack.Screen name="new" options={{ title: 'New Chat', presentation: 'modal' }} />
        </Stack>
    );
}
