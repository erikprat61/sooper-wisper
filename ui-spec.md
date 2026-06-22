This UI specification document is optimized for an AI frontend engineer or code-generation agent (such as v0, Cursor, or Claude) to construct a high-fidelity, native-feeling voice dictation client matching the functional profile of Superwhisper.

---

# System Design Tokens (macOS Native Adaptive)

Use these baseline CSS variables to build out light, dark, and semi-transparent visual boundaries.

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  
  /* Light Mode (Vibrant/Acrylic Native) */
  --bg-translucent: rgba(255, 255, 255, 0.75);
  --bg-solid: #ffffff;
  --border-subtle: rgba(0, 0, 0, 0.08);
  --text-primary: #1c1c1e;
  --text-muted: #8e8e93;
  --accent-active: #ff453a; /* Recording Red */
  --accent-processing: #0a84ff; /* Processing Blue */
  --accent-success: #30d158; /* Paste/Done Green */
  
  /* Shadow Definitions */
  --shadow-overlay: 0 10px 30px -5px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.05);
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark Mode (Vibrant/Acrylic Native) */
    --bg-translucent: rgba(28, 28, 30, 0.75);
    --bg-solid: #1c1c1e;
    --border-subtle: rgba(255, 255, 255, 0.08);
    --text-primary: #f2f2f7;
    --text-muted: #aeaeb2;
  }
}

```

---

# 1. The Floating Recording Overlay Component (`/recording-overlay`)

This window is a global overlay triggered by hotkeys. It must feel incredibly lightweight, maintaining a high visual hierarchy.

### Visual Architecture

* **Dimensions**: $280\text{px} \times 54\text{px}$ (Mini Recording Window layout).


* **Materials**: Semitransparent backdrop-filter (glassmorphism/acrylic).


* **Border Radius**: $9999\text{px}$ (Capsule shape).
* **Interactions**: Right-click brings up context settings shortcut menu.



### Dynamic Waveform Visualization Engine

* **Standard Mode**: Real-time canvas-based frequency visualizer reacting to raw microphone input amplitude.


* **System Audio Capture Mode**: Flattened, static waveform line indicating internal capture behavior to avoid user confusion over silence.



### Dynamic States and Transitions

| State | CSS Background | Waveform / Icon Action | Status Text | Primary Action Trigger |
| --- | --- | --- | --- | --- |
| **Idle** | `var(--bg-translucent)` | Invisible. Only static Mic/Mode icon displayed.

 | "Hold hotkey/Click to Speak..." | Single modifier press or toggle trigger.

 |
| **Recording** | `var(--bg-translucent)` | Reactive, dynamic red visual waves (`var(--accent-active)`).

 | "Recording (0:00)..." | Release hotkey or second toggle keypress.

 |
| **Processing** | `var(--bg-translucent)` | Linear blue loading bar (`var(--accent-processing)`) moving left-to-right. | "Processing with Claude..."

 | `Escape` hides window but background task persists.

 |
| **Pasting** | `rgba(48, 209, 88, 0.1)` | Success checkmark animates with `scale-in` bounce. | "Inserted!"

 | Auto-triggers window fade-out.

 |
| **Error** | `rgba(255, 69, 58, 0.1)` | Warning triangle indicator appears with a horizontal shake animation. | "Key invalid. Tap to fix."

 | Clicking launches deep-link settings view.

 |

---

# 2. Main System Settings Window Layout (`/settings`)

The dashboard layout splits cleanly into a two-column sidebar interface.

```
+-----------------------------------------------------------------------------------------------------+
|  [Q] Search Settings...                               |  [Note Mode (Custom)]                       |
+-------------------------------------------------------+---------------------------------------------+
|  (App Logo & System Stats)                            |  Model Settings                             |
|                                                       |  [ASR Transcription Model: Whisper Large-v3 ] |
|  [Sidebar Navigation]                                  |  [AI Formatting Model: GPT-5 Mini         ] |
|  * Modes (Default: Note Mode) [cite: 12]              |                                             |
|  * Models Library                                     |  AI Prompt Instructions                     |
|  * Vocabulary & Custom Replacements                   |  +---------------------------------------+  |
|  * Keyboard & Touch Shortcuts                         |  | <role>You are a note editor</role>     |  |
|  * Advanced & Privacy Settings                        |  | <instructions>Format text...</instructions> |
|                                                       |  +---------------------------------------+  |
|  [Pair Device via QR Code Button]                     |                                             |
|                                                       |  Auto-Activation App Rules                  |
|                                                       |  [ Mail.app ] -> Default to Email Mode      |
+-----------------------------------------------------------------------------------------------------+

```

### Advanced Sidebar Configuration Panes

* **Modes Panel**: Display active, built-in system presets (Email, Note, Message) alongside Custom user presets. Include a visual "Default Mode" flag selector indicator.


* **Models Library**: Tabbed view showcasing downloadable voice models (Whisper Tiny through Large, Parakeet) and linked cloud-hosted API models.


* **Vocabulary Settings Pane**: A straightforward key-value grid for custom replacements and vocabulary hints designed to assist multilingual and jargon detection.



---

# 3. Custom Prompt Builder Component (`/modes/custom-config`)

This schema directs the agent to construct the XML customization wrapper and its few-shot training workspace.

### Programmatic Context Injection Controls

Implement checkboxes that allow users to toggle context harvesting:

* [ ] **Incorporate Selection Context**: Capture highlighted text at recording initialization.


* [ ] **Incorporate Clipboard Context**: Capture active system clip content.


* [ ] **Incorporate Application Context**: Capture active window name and input fields.



### Few-Shot Example Editor Workspace

Generate an expandable list panel where custom formatting example structures are explicitly parsed.

```typescript
interface FewShotExample {
  id: string;
  userInputRaw: string;
  expectedOutputFormatted: string;
}

// React State Template
const [examples, setExamples] = useState<FewShotExample[]>([
  {
    id: "ex-1",
    userInputRaw: "send an email to tim lets meet up on friday for lunch",
    expectedOutputFormatted: "Subject: Lunch on Friday\n\nHi Tim,\n\nLet's meet up this Friday for lunch.\n\nBest,\n[User]"
  }
]);

```

---

# 4. Critical Logic Triggers & Friction Solvers (Agent Implementation Rules)

Ensure the generated system includes explicit handling for security, mode states, and file recovery.

### Local-First Security Protocol

1. **BYOK Key Encryption**: Third-party API credentials entered under custom models must bypass plaintext disk files and save directly using the system Keychain.


2. **Verify Auto-Purge Behavior**:
* Add an explicit configuration toggle: `[x] Auto-Purge Voice Recording After Successful Paste`.
* Ensure the storage driver implements file removal hooks immediately following cursor injection to prevent persistent disk storage.





### Smart Window Focus Correction (Auto-Activation Rules)

* **The Trap**: Switching target windows or browser tabs during long-form transcription can cause application context mismatching.


* **The UI Solution**: Implement a historical tracker in the state engine. When focus shifts, capture context variables at *recording initialization* and lock them for that specific transcription task, bypassing active layout polling if target focus moves.

### Custom Multi-Language Onboarding Sandbox (`/onboarding/playground`)

During initial onboarding, display a sandbox testing workspace containing a system playground.

```
+-----------------------------------------------------------------------+
|  Interactive Onboarding Playground                                    |
|                                                                       |
|  1. Press and hold [Option + Space] to dictate into this field.       |
|  2. Dictate a phrase, then release to test the insertion latency.     |
|                                                                       |
|  [ Playback Sandbox Field: Start talking to verify setup...        ]  |
|                                                                       |
|  Latency metric: ---- ms | Character Count: ----                      |
+-----------------------------------------------------------------------+

```

Ensure this test box validates the vocabulary list hint trick: instruct the user to type in their local target tongue (e.g., adding a Spanish phrase like *"y también puede incluir palabras en español"* to test real-time mixed-language accuracy).


This UI specification document is optimized for an AI frontend engineer or code-generation agent (such as v0, Cursor, or Claude) to construct a high-fidelity, native-feeling voice dictation client matching the functional profile of Superwhisper.

---

# System Design Tokens (macOS Native Adaptive)

Use these baseline CSS variables to build out light, dark, and semi-transparent visual boundaries.

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  
  /* Light Mode (Vibrant/Acrylic Native) */
  --bg-translucent: rgba(255, 255, 255, 0.75);
  --bg-solid: #ffffff;
  --border-subtle: rgba(0, 0, 0, 0.08);
  --text-primary: #1c1c1e;
  --text-muted: #8e8e93;
  --accent-active: #ff453a; /* Recording Red */
  --accent-processing: #0a84ff; /* Processing Blue */
  --accent-success: #30d158; /* Paste/Done Green */
  
  /* Shadow Definitions */
  --shadow-overlay: 0 10px 30px -5px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.05);
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark Mode (Vibrant/Acrylic Native) */
    --bg-translucent: rgba(28, 28, 30, 0.75);
    --bg-solid: #1c1c1e;
    --border-subtle: rgba(255, 255, 255, 0.08);
    --text-primary: #f2f2f7;
    --text-muted: #aeaeb2;
  }
}

```

---

# 1. The Floating Recording Overlay Component (`/recording-overlay`)

This window is a global overlay triggered by hotkeys. It must feel incredibly lightweight, maintaining a high visual hierarchy.

### Visual Architecture

* **Dimensions**: $280\text{px} \times 54\text{px}$ (Mini Recording Window layout).


* **Materials**: Semitransparent backdrop-filter (glassmorphism/acrylic).


* **Border Radius**: $9999\text{px}$ (Capsule shape).
* **Interactions**: Right-click brings up context settings shortcut menu.



### Dynamic Waveform Visualization Engine

* **Standard Mode**: Real-time canvas-based frequency visualizer reacting to raw microphone input amplitude.


* **System Audio Capture Mode**: Flattened, static waveform line indicating internal capture behavior to avoid user confusion over silence.



### Dynamic States and Transitions

| State | CSS Background | Waveform / Icon Action | Status Text | Primary Action Trigger |
| --- | --- | --- | --- | --- |
| **Idle** | `var(--bg-translucent)` | Invisible. Only static Mic/Mode icon displayed.

 | "Hold hotkey/Click to Speak..." | Single modifier press or toggle trigger.

 |
| **Recording** | `var(--bg-translucent)` | Reactive, dynamic red visual waves (`var(--accent-active)`).

 | "Recording (0:00)..." | Release hotkey or second toggle keypress.

 |
| **Processing** | `var(--bg-translucent)` | Linear blue loading bar (`var(--accent-processing)`) moving left-to-right. | "Processing with Claude..."

 | `Escape` hides window but background task persists.

 |
| **Pasting** | `rgba(48, 209, 88, 0.1)` | Success checkmark animates with `scale-in` bounce. | "Inserted!"

 | Auto-triggers window fade-out.

 |
| **Error** | `rgba(255, 69, 58, 0.1)` | Warning triangle indicator appears with a horizontal shake animation. | "Key invalid. Tap to fix."

 | Clicking launches deep-link settings view.

 |

---

# 2. Main System Settings Window Layout (`/settings`)

The dashboard layout splits cleanly into a two-column sidebar interface.

```
+-----------------------------------------------------------------------------------------------------+
|  [Q] Search Settings...                               |  [Note Mode (Custom)]                       |
+-------------------------------------------------------+---------------------------------------------+
|  (App Logo & System Stats)                            |  Model Settings                             |
|                                                       |  [ASR Transcription Model: Whisper Large-v3 ] |
|  [Sidebar Navigation]                                  |  [AI Formatting Model: GPT-5 Mini         ] |
|  * Modes (Default: Note Mode) [cite: 12]              |                                             |
|  * Models Library                                     |  AI Prompt Instructions                     |
|  * Vocabulary & Custom Replacements                   |  +---------------------------------------+  |
|  * Keyboard & Touch Shortcuts                         |  | <role>You are a note editor</role>     |  |
|  * Advanced & Privacy Settings                        |  | <instructions>Format text...</instructions> |
|                                                       |  +---------------------------------------+  |
|  [Pair Device via QR Code Button]                     |                                             |
|                                                       |  Auto-Activation App Rules                  |
|                                                       |  [ Mail.app ] -> Default to Email Mode      |
+-----------------------------------------------------------------------------------------------------+

```

### Advanced Sidebar Configuration Panes

* **Modes Panel**: Display active, built-in system presets (Email, Note, Message) alongside Custom user presets. Include a visual "Default Mode" flag selector indicator.


* **Models Library**: Tabbed view showcasing downloadable voice models (Whisper Tiny through Large, Parakeet) and linked cloud-hosted API models.


* **Vocabulary Settings Pane**: A straightforward key-value grid for custom replacements and vocabulary hints designed to assist multilingual and jargon detection.



---

# 3. Custom Prompt Builder Component (`/modes/custom-config`)

This schema directs the agent to construct the XML customization wrapper and its few-shot training workspace.

### Programmatic Context Injection Controls

Implement checkboxes that allow users to toggle context harvesting:

* [ ] **Incorporate Selection Context**: Capture highlighted text at recording initialization.


* [ ] **Incorporate Clipboard Context**: Capture active system clip content.


* [ ] **Incorporate Application Context**: Capture active window name and input fields.



### Few-Shot Example Editor Workspace

Generate an expandable list panel where custom formatting example structures are explicitly parsed.

```typescript
interface FewShotExample {
  id: string;
  userInputRaw: string;
  expectedOutputFormatted: string;
}

// React State Template
const [examples, setExamples] = useState<FewShotExample[]>([
  {
    id: "ex-1",
    userInputRaw: "send an email to tim lets meet up on friday for lunch",
    expectedOutputFormatted: "Subject: Lunch on Friday\n\nHi Tim,\n\nLet's meet up this Friday for lunch.\n\nBest,\n[User]"
  }
]);

```

---

# 4. Critical Logic Triggers & Friction Solvers (Agent Implementation Rules)

Ensure the generated system includes explicit handling for security, mode states, and file recovery.

### Local-First Security Protocol

1. **BYOK Key Encryption**: Third-party API credentials entered under custom models must bypass plaintext disk files and save directly using the system Keychain.


2. **Verify Auto-Purge Behavior**:
* Add an explicit configuration toggle: `[x] Auto-Purge Voice Recording After Successful Paste`.
* Ensure the storage driver implements file removal hooks immediately following cursor injection to prevent persistent disk storage.





### Smart Window Focus Correction (Auto-Activation Rules)

* **The Trap**: Switching target windows or browser tabs during long-form transcription can cause application context mismatching.


* **The UI Solution**: Implement a historical tracker in the state engine. When focus shifts, capture context variables at *recording initialization* and lock them for that specific transcription task, bypassing active layout polling if target focus moves.

### Custom Multi-Language Onboarding Sandbox (`/onboarding/playground`)

During initial onboarding, display a sandbox testing workspace containing a system playground.

```
+-----------------------------------------------------------------------+
|  Interactive Onboarding Playground                                    |
|                                                                       |
|  1. Press and hold [Option + Space] to dictate into this field.       |
|  2. Dictate a phrase, then release to test the insertion latency.     |
|                                                                       |
|  [ Playback Sandbox Field: Start talking to verify setup...        ]  |
|                                                                       |
|  Latency metric: ---- ms | Character Count: ----                      |
+-----------------------------------------------------------------------+

```

Ensure this test box validates the vocabulary list hint trick: instruct the user to type in their local target tongue (e.g., adding a Spanish phrase like *"y también puede incluir palabras en español"* to test real-time mixed-language accuracy).