export class AudioRecorder {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.audioBuffers = [];
    this.recordingDuration = 0;
    this.timerInterval = null;
    this.onTimeUpdate = null;
    this.onLevelUpdate = null;
  }

  async start(onTimeUpdate = null, onLevelUpdate = null) {
    this.audioBuffers = [];
    this.recordingDuration = 0;
    this.onTimeUpdate = onTimeUpdate;
    this.onLevelUpdate = onLevelUpdate;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      await this.audioContext.resume();

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        this.audioBuffers.push(new Float32Array(inputData));

        if (this.onLevelUpdate) {
          let sumSquares = 0;
          for (let i = 0; i < inputData.length; i++) {
            sumSquares += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sumSquares / inputData.length);
          this.onLevelUpdate(Math.min(1, rms * 14));
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      if (this.onTimeUpdate) {
        this.onTimeUpdate(0);
      }
      if (this.onLevelUpdate) {
        this.onLevelUpdate(0);
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
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const incomingSampleRate = this.audioContext ? this.audioContext.sampleRate : 16000;
    const buffersToEncode = [...this.audioBuffers];

    this.cleanup();

    if (buffersToEncode.length === 0) {
      return new Uint8Array();
    }

    const totalLength = buffersToEncode.reduce((acc, buf) => acc + buf.length, 0);
    let mergedBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of buffersToEncode) {
      mergedBuffer.set(buf, offset);
      offset += buf.length;
    }

    if (incomingSampleRate !== 16000) {
      console.log(`[AudioRecorder] Resampling from ${incomingSampleRate}Hz to 16000Hz...`);
      mergedBuffer = this.resample(mergedBuffer, incomingSampleRate, 16000);
    }

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
    this.audioBuffers = [];
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.onLevelUpdate) {
      this.onLevelUpdate(0);
    }
  }

  encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
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
