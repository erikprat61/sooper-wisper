export class AudioRecorder {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.audioBuffers = [];
    this.recordingDuration = 0; // in seconds
    this.timerInterval = null;
    this.onTimeUpdate = null; // callback(seconds)
  }

  async start(onTimeUpdate = null) {
    this.audioBuffers = [];
    this.recordingDuration = 0;
    this.onTimeUpdate = onTimeUpdate;

    try {
      // 1. Prompt for mic access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      // 2. Set up AudioContext with forced 16kHz sample rate (Safari/Chrome support this)
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 3. ScriptProcessor for recording chunk accumulation
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processorNode.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Clone Float32Array data as e.inputBuffer is reused by browser
        this.audioBuffers.push(new Float32Array(inputData));
      };

      // Connect graph
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      // 4. Start recording time counter
      if (this.onTimeUpdate) {
        this.onTimeUpdate(0);
      }
      this.timerInterval = setInterval(() => {
        this.recordingDuration += 1;
        if (this.onTimeUpdate) {
          this.onTimeUpdate(this.recordingDuration);
        }
      }, 1000);

    } catch (err) {
      this.cleanup();
      throw new Error(`Microphone capture failed: ${err.message}`);
    }
  }

  async stop() {
    // Stop recording timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const incomingSampleRate = this.audioContext ? this.audioContext.sampleRate : 16000;
    const buffersToEncode = [...this.audioBuffers];

    // Cleanup active audio graph and stream
    this.cleanup();

    if (buffersToEncode.length === 0) {
      return new Uint8Array();
    }

    // Merge Float32 segments into one continuous buffer
    const totalLength = buffersToEncode.reduce((acc, buf) => acc + buf.length, 0);
    let mergedBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of buffersToEncode) {
      mergedBuffer.set(buf, offset);
      offset += buf.length;
    }

    // Resample if the browser's AudioContext rate does not match 16000Hz
    if (incomingSampleRate !== 16000) {
      console.log(`[AudioRecorder] Resampling from ${incomingSampleRate}Hz to 16000Hz...`);
      mergedBuffer = this.resample(mergedBuffer, incomingSampleRate, 16000);
    }

    // Normalize audio level to peak at 0.8
    let maxVal = 0;
    for (let i = 0; i < mergedBuffer.length; i++) {
      const val = Math.abs(mergedBuffer[i]);
      if (val > maxVal) {
        maxVal = val;
      }
    }
    if (maxVal > 0) {
      const targetPeak = 0.8;
      const scale = targetPeak / maxVal;
      for (let i = 0; i < mergedBuffer.length; i++) {
        mergedBuffer[i] *= scale;
      }
    }

    // Encode to 16-bit Mono WAV format at 16kHz
    return this.encodeWAV(mergedBuffer, 16000);
  }

  resample(samples, fromSampleRate, toSampleRate) {
    if (fromSampleRate === toSampleRate) {
      return samples;
    }
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(samples.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const index = i * ratio;
      const leftIndex = Math.floor(index);
      const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
      const weight = index - leftIndex;
      result[i] = samples[leftIndex] * (1 - weight) + samples[rightIndex] * weight;
    }
    return result;
  }

  cleanup() {
    // Stop mic stream track execution
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Disconnect Web Audio graph
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF identifier */
    this.writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    this.writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    this.writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw PCM = 1) */
    view.setUint16(20, 1, true);
    /* channel count (mono = 1) */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample (16-bit) */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    this.writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    // Write raw PCM 16-bit audio samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      // Clamp float values between [-1.0, 1.0]
      const s = Math.max(-1, Math.min(1, samples[i]));
      // Map [-1.0, 1.0] range to [-32768, 32767]
      const pcm16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(offset, pcm16, true);
    }

    return new Uint8Array(buffer);
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
