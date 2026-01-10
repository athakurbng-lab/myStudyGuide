# myStudyGuide 📚🎧

A powerful AI-powered study companion that converts your PDF documents into immersive audiobooks and helps you practice with smart MCQ quizzes.

> **Formerly known as**: myAudioApp

---

## 🚀 Key Features

### 🎧 Smart Audio Player
- **PDF-to-Audio**: Converts documents into natural-sounding speech page-by-page.
- **Context Awareness**: Maintains narrative flow between pages using "Chain-of-Thought" AI.
- **Background Playback**: Continues playing even when your screen is locked.
- **Smart Speed**: Learns your actual listening speed (EMA) to provide 100% accurate time estimates.
- **Auto-Scroll**: Automatically advances to the next page hands-free.

### 🎓 MCQ Quiz System
- **Study Mode**: Paste JSON quizzes generated from your notes.
- **Smart Scoring**: Authentic exam scoring (+2 for Correct, -0.67 for Wrong).
- **Persistence**: Auto-saves progress so you can close and resume anytime.
- **Detailed Review**: Filter results by Correct/Wrong/Unattempted and view detailed AI explanations.
- **Jump Navigation**: Quickly navigate through questions.
- **Retake**: Reset your progress at any time to practice again.

### 🎨 Dynamic Experience
- **Visual Prompts**: Generates unique, conceptual "Album Art" for every page.
- **Theme Support**: Fully responsive Dark/Light mode.
- **Local Library**: Save generated audiobooks and stats completely offline.

---

## 🛠 Tech Stack

- **Framework**: React Native (Expo SDK 52)
- **AI Model**: Google Gemini 1.5 Flash
- **Language**: TypeScript
- **Routing**: Expo Router
- **Build System**: EAS (Expo Application Services)

---

## 📦 Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/myStudyGuide.git
    cd myStudyGuide
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Setup API Keys**:
    - The app requires a Google Gemini API Key.
    - You can add keys manually inside the app via the **Key Manager** (Dashboard > Key Icon).

---

## 🏃‍♂️ Running Locally

Start the development server:

```bash
npx expo start
```

- Press `s` to switch to development build.
- Press `a` to open on Android Emulator.
- Scan the QR code with **Expo Go** on your physical device.

---

## 🏗 Building for Android (APK)

To generate a standalone APK for installation:

1.  **Install EAS CLI**:
    ```bash
    npm install -g eas-cli
    ```

2.  **Run Build Command**:
    ```bash
    npx eas-cli build -p android --profile preview
    ```

3.  **Download**: Once finished, download the `.apk` from the provided Expo link.

---

## 📝 MCQ JSON Format

To import quizzes, use the following JSON structure:

```json
{
  "source": "Topic Name",
  "mcqs": [
    {
      "id": 1,
      "question": "What is the capital of France?",
      "options": {
        "A": "London",
        "B": "Berlin",
        "C": "Paris",
        "D": "Madrid"
      },
      "answer": "C",
      "explanation": "Paris is the capital and most populous city of France."
    }
  ]
}
```

---

## 🔒 Privacy

- **Guest Mode**: No login required.
- **Local Storage**: All books and quiz results are stored locally on your device.
- **Direct Keys**: API keys are stored securely in local storage and never shared.
