# Sooper-Wisper

Sooper-Wisper is a lightweight, system-wide background macOS helper tool inspired by Superwhisper. It captures your voice input from the microphone, transcribes it using OpenAI's **Whisper** speech-to-text model running **completely locally & offline** on your Mac (optimized for Apple Silicon via macOS Metal framework), and automatically inserts the text directly at your active cursor position in any application.

---

## Key Features

*   **100% Offline & Private**: No audio data or API calls ever leave your local computer.
*   **Accessory Mode Background App**: Runs silently without a Dock icon or menu bar presence, operating entirely in the background until triggered.
*   **Apple Silicon GPU Acceleration**: Compiles with Apple's Metal framework for sub-second local inference.
*   **Global Hotkey Toggle**: Toggle recording instantly with a global keyboard shortcut (default: `Option + Space`).
*   **Premium Glassmorphic HUD**: Displays a sleek, floating status capsule centered at the top of the screen with smooth state animations:
    *   **Recording**: Pulsing indicator with active timer.
    *   **Processing**: Spinning loading circle indicating local ASR inference.
    *   **Success**: Emerald checkmark confirming text insertion.
*   **Automatic Model Management**: Automatically downloads the lightweight `ggml-tiny.en.bin` (~75MB) model on the first startup if no model is found locally.
*   **Smart Clipboard Restore**: Copies the transcription, simulates keyboard paste (`Cmd + V`), and restores the user's previous clipboard contents automatically after a 200ms delay.
---

## Tech Stack

*   **Frontend**: HTML5, Vanilla CSS, Vanilla Javascript.
*   **Backend**: Rust (Tauri v2 core, global shortcut, clipboard, and `whisper-rs` bindings to `whisper.cpp`).

---

## Prerequisites

*   **macOS** (Target host for Tauri and AppleScript paste simulation).
*   **Node.js** (v18+) & **npm**.
*   **Rust Compiler** (Cargo and rustup).
*   **Xcode Command Line Tools** (For compiling the Metal C++ whisper library):
    ```bash
    xcode-select --install
    ```

---

## Setup & Configuration

1.  **Clone and install dependencies**:
    ```bash
    git clone https://github.com/yourusername/sooper-wisper.git
    cd sooper-wisper
    npm install
    ```

2.  **Configure Environment**:
    Create a `.env` file in the root of the project:
    ```ini
    # Local Whisper Configuration
    # (Optional) Leave empty to automatically download and use the lightweight 'ggml-tiny.en.bin' model (~75MB)
    # or specify the absolute path to your custom GGML Whisper model file (.bin).
    LOCAL_WHISPER_MODEL_PATH=

    # Application Settings
    GLOBAL_HOTKEY=Option+Space
    ```

---

## Running the Application

Start the development server:
```bash
npm run tauri dev
```

> [!NOTE]
> On the very first startup, the app will check for the Whisper model. If `LOCAL_WHISPER_MODEL_PATH` is empty, it will automatically download `ggml-tiny.en.bin` from Hugging Face and store it inside the application cache directory (`~/Library/Application Support/com.tauri.dev/models/`). You will see download logs in your terminal.

> [!IMPORTANT]
> **macOS Permissions Required**:
> * **Microphone**: Needed to capture your voice input.
> * **Accessibility**: Needed by AppleScript to simulate the keyboard shortcut command (`Cmd+V`) for inserting text. You will be prompted by macOS to authorize these permissions when first running the application.

---

## How It Works Under the Hood

1. **Hotkey Activation**: Pressing `Option + Space` triggers the global keyboard shortcut, showing the HUD window and starting a 16kHz audio capture.
2. **Audio Encoding**: Pressing `Option + Space` again stops recording, downsamples, and packages PCM samples into raw WAV bytes.
3. **Rust Inference**: The backend decodes the PCM samples, locks the shared `WhisperContext` cache, and executes inference in a background thread pool (`tokio::task::spawn_blocking`) to keep the UI completely fluid.
4. **Metal Processing**: The underlying C++ library (`whisper.cpp`) utilizes Metal GPU shaders to execute parallel neural network passes, returning the transcribed text.
5. **Paste & Clipboard Restore**: Rust copies the text, triggers `Cmd + V` via AppleScript, and restores the previous clipboard item.
