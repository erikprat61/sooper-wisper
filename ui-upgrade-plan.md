# UI Upgrade Plan

Based on `ui-spec.md` and the current Sooper-Wisper app.

## What exists now
- Floating HUD overlay with `idle / recording / processing / success`
- Minimal inline settings inside the HUD
- Local Whisper vs NVIDIA Parakeet switch
- Global hotkeys, tray, paste flow

## Biggest gaps vs `ui-spec.md`
- No real waveform/status animation system
- No dedicated settings window with sidebar panes
- No modes/custom prompt builder
- No vocabulary/app rules/onboarding playground
- API key is saved in JSON, not Keychain
- No explicit auto-purge/focus-lock UI

---

## Phased UI upgrade plan

### Phase 1 — Make the overlay match the spec [COMPLETED]
Keep one job: upgrade the existing HUD, no architecture detour.

#### Scope
- Resize/restyle overlay to the capsule spec
- Add explicit UI states:
  - `idle`
  - `recording`
  - `processing`
  - `pasting`
  - `error`
- Replace pulse dot with:
  - live waveform in mic mode
  - flat/static waveform for system-audio mode placeholder
- Add success/error animations
- Add right-click context menu entry points for settings
- `Escape` during processing hides UI only

#### Backend touch
- Minimal:
  - emit a `pasting` state before paste
  - support `hide_window`
  - optional event for waveform mode later

#### Acceptance
- Overlay feels native and readable
- State transitions are obvious
- No settings panel inside the capsule except maybe a temporary fallback while Phase 2 lands

---

### Phase 2 — Pull settings out into a real settings window [COMPLETED]
Do this next. The inline HUD settings are already too cramped.

#### Scope
Create a dedicated `/settings` view/window with:
- Sidebar nav
  - Modes
  - Models Library
  - Vocabulary & Custom Replacements
  - Keyboard & Touch Shortcuts
  - Advanced & Privacy
- Search field at top
- Main detail pane on the right
- “Pair device via QR” can be a disabled button or stub for now

#### What should be real in this phase
- Existing provider choice moves here
- Existing API key entry moves here
- Shortcut display/settings copy
- Privacy section with current local/cloud explanation

#### What can stay stubbed
- Models Library download management
- QR pairing
- Full search behavior

#### Acceptance
- Settings no longer live inside the overlay
- Tray/hotkey opens settings reliably
- HUD stays tiny; settings handles configuration

---

### Phase 3 — Add modes, prompt builder, and vocabulary [COMPLETED]
This is the first feature phase, not just polish.

#### Scope
Build the spec’s “what Superwhisper does” layer:
- Built-in modes:
  - Note
  - Email
  - Message
- Custom mode editor
- Few-shot examples editor
- Context injection checkboxes:
  - selection
  - clipboard
  - application context
- Vocabulary/custom replacements grid
- Auto-activation app rules UI

#### Backend touch
Add config schema for:
- modes
- default mode
- few-shot examples
- vocabulary replacements
- app-to-mode rules
- context toggles

#### Ponytail note
Don’t build XML generation machinery everywhere in the UI. Just store structured JSON config and generate the prompt wrapper at use time.

#### Acceptance
- User can create/edit a custom mode
- User can define examples and vocab replacements
- UI makes clear which mode is default and which apps trigger which mode

---

### Phase 4 — Security and correctness features from the spec [COMPLETED]
This is where the app stops being “nice demo UI” and becomes trustworthy.

#### Scope
- Move BYOK credentials from `settings.json` to macOS Keychain
- Add explicit:
  - `Auto-Purge Voice Recording After Successful Paste`
- Lock target app/window context at recording start
- Better error deep-links:
  - invalid key
  - missing permission
  - no speech detected

#### Backend touch
- Replace plaintext API key persistence
- Add task/session snapshot for focus lock
- Add purge hooks if temp audio is ever persisted

#### Acceptance
- No plaintext third-party secrets on disk
- Focus mismatch during long dictation is prevented
- Privacy settings match behavior

---

### Phase 5 — Onboarding playground and final native polish [IN PROGRESS]
Only after the main app flow is solid.

#### Scope
- First-run onboarding screen
- Dictation sandbox field
- Latency metric
- Character count
- Mixed-language test hint
- Final accessibility/motion/theme cleanup

#### Acceptance
- New user can verify mic, paste, speed, and language behavior in one place
- Reduced motion and dark/light modes feel intentional

---

## Suggested build order by file area

### First
- `src/main.js`
- `src/style.css`
- `index.html`

That gets Phase 1 done fast.

### Then
- add separate settings UI files/views
- extend Rust config commands in `src-tauri/src/lib.rs`

### Later
- modes/vocabulary/onboarding screens
- Keychain integration and stronger config model

---

## Delivery slices
If you want this broken into actual PRs:

1. **PR 1:** Overlay redesign + new states  
2. **PR 2:** Dedicated settings window + move existing config there  
3. **PR 3:** Modes + vocabulary + prompt builder  
4. **PR 4:** Keychain + privacy/focus-lock fixes  
5. **PR 5:** Onboarding playground + polish  

---

## One thing I’d skip for now
Don’t build the full “Models Library” download manager in the first pass. Start with provider/model selection UI only; add downloads when backend model management exists.
