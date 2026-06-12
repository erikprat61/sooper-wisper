import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AudioRecorder } from './audio.js';

const recorder = new AudioRecorder();
let currentState = 'idle';
let errorTimeout = null;

// Initialize elements
const hud = document.getElementById('hud');
const statusText = document.getElementById('status-text');
const timer = document.getElementById('timer');

function transitionTo(state) {
  // Clear any active error timeouts if we transition out
  if (errorTimeout) {
    clearTimeout(errorTimeout);
    errorTimeout = null;
  }

  // Remove previous states from classList
  hud.classList.remove('idle', 'recording', 'processing', 'success');
  
  // Add new state class
  hud.classList.add(state);
  currentState = state;

  // Reset standard text styling
  statusText.style.color = '';

  switch (state) {
    case 'idle':
      statusText.textContent = 'Ready';
      timer.textContent = '0:00';
      break;

    case 'recording':
      statusText.textContent = 'Listening...';
      timer.textContent = '0:00';
      break;

    case 'processing':
      statusText.textContent = 'Transcribing...';
      break;

    case 'success':
      statusText.textContent = 'Pasted!';
      break;
  }
}

function showError(message) {
  statusText.textContent = message;
  statusText.style.color = '#ef4444'; // Red color for errors
  
  // Set hud style to success/processing structure to ensure it remains visible
  hud.classList.remove('idle', 'recording', 'processing', 'success');
  hud.classList.add('processing'); // Use processing state styling to show error

  // Clear previous timeout and set new one to transition to idle
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => {
    transitionTo('idle');
  }, 2500);
}

async function handleShortcutTrigger() {
  if (currentState === 'idle') {
    // 1. Enter Recording state
    transitionTo('recording');
    
    try {
      await recorder.start((seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      });
    } catch (err) {
      console.error(err);
      showError('Mic error');
    }

  } else if (currentState === 'recording') {
    // 2. Stop recording and enter Processing state
    transitionTo('processing');

    try {
      const wavBytes = await recorder.stop();
      if (wavBytes.length === 0) {
        transitionTo('idle');
        return;
      }

      // Convert Uint8Array to regular array for serialization
      const audioArray = Array.from(wavBytes);

      // Invoke ASR transcription command
      const text = await invoke('transcribe_audio', { audioBytes: audioArray });

      if (!text || text.trim() === '') {
        showError('No speech detected');
        return;
      }

      // Indicate paste operation is in progress
      statusText.textContent = 'Pasting...';

      // Invoke clipboard writing and AppleScript keyboard pasting
      await invoke('paste_text', { text });

      // Show success
      transitionTo('success');

      // Dismiss HUD after 1.5 seconds
      setTimeout(() => {
        if (currentState === 'success') {
          transitionTo('idle');
        }
      }, 1500);

    } catch (err) {
      console.error(err);
      showError('ASR / Paste failed');
    }

  } else {
    // 3. User pressed shortcut while transcribing or in success state: cancel operations
    recorder.cleanup();
    transitionTo('idle');
  }
}

// Listen for global shortcut events from Rust backend
listen('global-shortcut-pressed', () => {
  handleShortcutTrigger().catch(console.error);
});

// Initial state
transitionTo('idle');
