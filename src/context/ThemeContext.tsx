import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';

type ThemeType = 'light' | 'dark';

interface Colors {
    background: string;
    card: string;
    text: string;
    subtext: string;
    primary: string;
    border: string;
    error: string;
    success: string;
    tint: string;
}

const LightColors: Colors = {
    background: '#FFFFFF',
    card: '#F8F9FA',
    text: '#333333',
    subtext: '#666666',
    primary: '#4285F4',
    border: '#E0E0E0',
    error: '#DC3545',
    success: '#28A745',
    tint: '#EEEEEE'
};

const DarkColors: Colors = {
    background: '#121212',
    card: '#1E1E1E',
    text: '#EEEEEE',
    subtext: '#AAAAAA',
    primary: '#8AB4F8', // Lighter blue for dark mode accessibility
    border: '#333333',
    error: '#CF6679',
    success: '#4ADE80',
    tint: '#2C2C2C'
};

interface ThemeContextType {
    theme: ThemeType;
    colors: Colors;
    toggleTheme: () => void;
    setTheme: (theme: ThemeType) => void;
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
    theme: 'light',
    colors: LightColors,
    toggleTheme: () => { },
    setTheme: () => { },
    isDark: false,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const systemScheme = useColorScheme(); // 'light', 'dark', or null
    const [theme, setThemeState] = useState<ThemeType>('light');

    // Initialize with system theme
    useEffect(() => {
        if (systemScheme) {
            setThemeState(systemScheme);
        }
    }, [systemScheme]);

    const toggleTheme = () => {
        setThemeState(prev => (prev === 'light' ? 'dark' : 'light'));
    };

    const setTheme = (newTheme: ThemeType) => {
        setThemeState(newTheme);
    };

    const colors = theme === 'dark' ? DarkColors : LightColors;

    return (
        <ThemeContext.Provider value={{ theme, colors, toggleTheme, setTheme, isDark: theme === 'dark' }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
