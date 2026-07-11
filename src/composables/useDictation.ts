import { computed, onBeforeUnmount, ref } from 'vue'
import {
  cancelMobileShellDictation,
  getMobileShellDictationStatus,
  isNativeAndroidShell,
  startMobileShellDictation,
  stopMobileShellDictation,
} from '../mobile/mobileShell'

export type DictationState = 'idle' | 'requesting' | 'recording' | 'transcribing'
const DICTATION_SILENCE_THRESHOLD = 0.0025
const DICTATION_BAR_WIDTH = 3
const DICTATION_BAR_GAP = 2
const MAX_WAVEFORM_SAMPLES = 256

export function useDictation(options: {
  onTranscript: (text: string) => void
  getLanguage?: () => string
  onEmpty?: () => void
  onError?: (error: unknown) => void
}) {
  const liveRecordingSupported =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  const fileUploadSupported =
    typeof window !== 'undefined' &&
    typeof fetch !== 'undefined' &&
    typeof FormData !== 'undefined' &&
    typeof File !== 'undefined'
  const nativeShell = isNativeAndroidShell()
  const nativeDictationSupported = ref(false)
  const state = ref<DictationState>('idle')
  const isSupported = computed(() => nativeDictationSupported.value || liveRecordingSupported || fileUploadSupported)
  const supportsLiveRecording = ref(liveRecordingSupported)
  const supportsFileUpload = ref(fileUploadSupported)
  const supportsNativeDictation = computed(() => nativeDictationSupported.value)
  const recordingDurationMs = ref(0)
  const waveformCanvasRef = ref<HTMLCanvasElement | null>(null)

  let mediaRecorder: MediaRecorder | null = null
  let mediaStream: MediaStream | null = null
  let chunks: Blob[] = []
  let audioContext: AudioContext | null = null
  let mediaStreamSource: MediaStreamAudioSourceNode | null = null
  let processorNode: ScriptProcessorNode | null = null
  let recordingStartedAt: number | null = null
  let waveformSamples: number[] = []
  let isStartingRecording = false
  let stopRequestedBeforeStart = false
  let transcribeAbortController: AbortController | null = null
  let nativeRecordingStartedAt: number | null = null
  let nativeRecordingTimer: ReturnType<typeof setInterval> | null = null
  let nativeCancellationRequested = false

  async function detectNativeDictationSupport(): Promise<void> {
    if (!nativeShell) return
    try {
      const status = await getMobileShellDictationStatus()
      nativeDictationSupported.value = status.available
    } catch {
      // Older Android shells do not expose native dictation. The composer keeps
      // the synchronous audio picker fallback available on the first tap.
      nativeDictationSupported.value = false
    }
  }

  void detectNativeDictationSupport()

  function pickSupportedMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/wav',
    ]
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
    return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ''
  }

  function extractTranscriptText(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
    const record = value as Record<string, unknown>
    const direct = record.text ?? record.transcript
    if (typeof direct === 'string') return direct.trim()
    const segmentsText = extractTranscriptSegmentsText(record.segments)
    if (segmentsText) return segmentsText
    const data = record.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const dataRecord = data as Record<string, unknown>
      const nested = dataRecord.text ?? dataRecord.transcript
      if (typeof nested === 'string') return nested.trim()
      const nestedSegmentsText = extractTranscriptSegmentsText(dataRecord.segments)
      if (nestedSegmentsText) return nestedSegmentsText
    }
    return ''
  }

  function extractTranscriptSegmentsText(value: unknown): string {
    if (!Array.isArray(value)) return ''
    return value
      .map((segment) => {
        if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return ''
        const text = (segment as Record<string, unknown>).text
        return typeof text === 'string' ? text.trim() : ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  function cancelTranscription(): void {
    if (transcribeAbortController) {
      transcribeAbortController.abort()
      transcribeAbortController = null
    }
    if (state.value === 'transcribing') {
      state.value = 'idle'
    }
  }

  function stopNativeRecordingTimer(): void {
    if (nativeRecordingTimer) {
      clearInterval(nativeRecordingTimer)
      nativeRecordingTimer = null
    }
    nativeRecordingStartedAt = null
  }

  function startNativeRecordingTimer(): void {
    stopNativeRecordingTimer()
    resetWaveformDisplay()
    nativeRecordingStartedAt = performance.now()
    nativeRecordingTimer = setInterval(() => {
      if (nativeRecordingStartedAt !== null) {
        recordingDurationMs.value = Math.max(0, performance.now() - nativeRecordingStartedAt)
      }
    }, 250)
  }

  function isNativePluginUnavailable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '')
    return /unimplemented|not implemented|plugin.*not found/iu.test(message)
  }

  async function startNativeDictation(): Promise<void> {
    if (state.value !== 'idle') return
    nativeCancellationRequested = false
    startNativeRecordingTimer()
    state.value = 'recording'

    try {
      const result = await startMobileShellDictation(options.getLanguage?.().trim() ?? '')
      if (nativeCancellationRequested) return
      if (result.audioBase64) {
        const binary = window.atob(result.audioBase64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        await transcribeBlob(new Blob([bytes], { type: result.mimeType || 'audio/mp4' }), {
          mimeType: result.mimeType || 'audio/mp4',
          fileName: result.fileName || 'dictation.m4a',
        })
        return
      }
      const text = result.text.trim()
      if (text) {
        options.onTranscript(text)
      } else {
        options.onEmpty?.()
      }
    } catch (error) {
      if (!nativeCancellationRequested) {
        if (isNativePluginUnavailable(error)) {
          nativeDictationSupported.value = false
          options.onError?.(new Error('当前安卓版本不支持自动语音转文字，请更新 CX-Codex。'))
        } else {
          options.onError?.(error)
        }
      }
    } finally {
      stopNativeRecordingTimer()
      if (state.value === 'recording' || state.value === 'transcribing') {
        state.value = 'idle'
      }
    }
  }

  function drawWaveform(): void {
    const canvas = waveformCanvasRef.value
    if (!canvas || typeof window === 'undefined') return
    const context = canvas.getContext('2d')
    if (!context) return

    const cssWidth = Math.max(1, Math.floor(canvas.clientWidth))
    const cssHeight = Math.max(1, Math.floor(canvas.clientHeight || 36))
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr))
    const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr))

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)

    const maxBars = Math.max(12, Math.floor(cssWidth / (DICTATION_BAR_WIDTH + DICTATION_BAR_GAP)))
    const recentSamples = waveformSamples.slice(-maxBars)
    const leadingBars = Math.max(0, maxBars - recentSamples.length)
    const centerY = cssHeight / 2
    const fill = getComputedStyle(canvas).color || '#000000'

    for (let index = 0; index < maxBars; index += 1) {
      const value = recentSamples[index - leadingBars] ?? 0
      const heightRatio = Math.max(0.08, Math.min(1, value * 18))
      const barHeight = heightRatio * centerY
      const x = index * (DICTATION_BAR_WIDTH + DICTATION_BAR_GAP)

      context.globalAlpha = value <= DICTATION_SILENCE_THRESHOLD ? 0.35 : 1
      context.fillStyle = fill
      context.fillRect(x, centerY - barHeight, DICTATION_BAR_WIDTH, barHeight * 2)
    }

    context.globalAlpha = 1
  }

  function resetWaveformDisplay(): void {
    waveformSamples = []
    recordingDurationMs.value = 0
    drawWaveform()
  }

  function stopWaveformCapture(): void {
    if (processorNode) {
      processorNode.disconnect()
      processorNode.onaudioprocess = null
      processorNode = null
    }
    if (mediaStreamSource) {
      mediaStreamSource.disconnect()
      mediaStreamSource = null
    }
    if (audioContext) {
      void audioContext.close()
      audioContext = null
    }
    recordingStartedAt = null
  }

  function startWaveformCapture(stream: MediaStream): void {
    if (typeof window === 'undefined') return

    const fallbackAudioContext = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    const AudioContextCtor = window.AudioContext ?? fallbackAudioContext
    if (!AudioContextCtor) return

    stopWaveformCapture()
    resetWaveformDisplay()

    audioContext = new AudioContextCtor()
    mediaStreamSource = audioContext.createMediaStreamSource(stream)
    processorNode = audioContext.createScriptProcessor(2048, 1, 1)
    recordingStartedAt = performance.now()

    processorNode.onaudioprocess = (event) => {
      const channelData = event.inputBuffer.getChannelData(0)
      let total = 0
      for (let index = 0; index < channelData.length; index += 1) {
        const amplitude = Math.abs(channelData[index] ?? 0)
        total += amplitude < DICTATION_SILENCE_THRESHOLD ? 0 : amplitude
      }

      waveformSamples.push(total / channelData.length)
      if (waveformSamples.length > MAX_WAVEFORM_SAMPLES) {
        waveformSamples.shift()
      }

      if (recordingStartedAt !== null) {
        recordingDurationMs.value = Math.max(0, performance.now() - recordingStartedAt)
      }

      drawWaveform()
    }

    mediaStreamSource.connect(processorNode)
    processorNode.connect(audioContext.destination)
    drawWaveform()
  }

  async function startRecording() {
    if (state.value === 'transcribing') {
      cancelTranscription()
    }
    if (state.value !== 'idle' || isStartingRecording) return
    if (nativeDictationSupported.value) {
      await startNativeDictation()
      return
    }
    if (!supportsLiveRecording.value) return
    isStartingRecording = true
    stopRequestedBeforeStart = false
    state.value = 'requesting'

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
      chunks = []
      const mimeType = pickSupportedMimeType()
      mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream)
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      mediaRecorder.onstop = () => {
        const recordedChunks = chunks
        const recordedMimeType = mediaRecorder?.mimeType || recordedChunks[0]?.type || 'audio/webm'
        cleanup()
        void transcribe(recordedChunks, recordedMimeType)
      }
      startWaveformCapture(mediaStream)
      mediaRecorder.start(250)
      state.value = 'recording'
      if (stopRequestedBeforeStart) {
        stopRecording()
      }
    } catch (error) {
      cleanup()
      state.value = 'idle'
      options.onError?.(error)
    } finally {
      isStartingRecording = false
    }
  }

  function stopRecording() {
    if (isStartingRecording && state.value === 'requesting') {
      stopRequestedBeforeStart = true
      return
    }
    if (nativeDictationSupported.value && state.value === 'recording') {
      state.value = 'transcribing'
      void stopMobileShellDictation().catch((error: unknown) => {
        options.onError?.(error)
      })
      return
    }
    if (state.value !== 'recording' || !mediaRecorder) return
    if (mediaRecorder.state !== 'inactive') {
      state.value = 'transcribing'
      try {
        mediaRecorder.requestData()
      } catch {
        // Some browsers do not allow requestData in every recorder state.
      }
      mediaRecorder.stop()
    }
  }

  function cancel() {
    stopRequestedBeforeStart = false
    nativeCancellationRequested = true
    if (nativeDictationSupported.value) {
      void cancelMobileShellDictation().catch(() => {
        // The native plugin may be unavailable in an older installed shell.
      })
    }
    stopNativeRecordingTimer()
    cancelTranscription()
    cleanup()
    state.value = 'idle'
  }

  async function transcribe(recordedChunks: Blob[], mimeType: string) {
    if (recordedChunks.length === 0) {
      options.onEmpty?.()
      state.value = 'idle'
      return
    }

    const blob = new Blob(recordedChunks, { type: mimeType })
    await transcribeBlob(blob, {
      mimeType,
    })
  }

  function normalizeAudioExtension(mimeType: string, fileName = ''): string {
    const fileExtMatch = fileName.trim().match(/\.([A-Za-z0-9]+)$/u)
    if (fileExtMatch?.[1]) {
      return fileExtMatch[1].toLowerCase()
    }
    const mimeMatch = mimeType.trim().match(/^audio\/([a-z0-9.+-]+)/iu)
    if (mimeMatch?.[1]) {
      return mimeMatch[1].toLowerCase().replace('x-', '').replace('mpeg', 'mp3')
    }
    return 'webm'
  }

  async function transcribeBlob(
    blob: Blob,
    optionsForBlob: {
      mimeType?: string
      fileName?: string
    } = {},
  ) {
    state.value = 'transcribing'
    let requestAbortController: AbortController | null = null

    try {
      const mimeType = optionsForBlob.mimeType?.trim() || blob.type || 'audio/webm'
      const ext = normalizeAudioExtension(mimeType, optionsForBlob.fileName)
      const formData = new FormData()
      formData.append('file', blob, optionsForBlob.fileName?.trim() || `codex.${ext}`)
      const selectedLanguage = options.getLanguage?.().trim() ?? ''
      if (selectedLanguage && selectedLanguage.toLowerCase() !== 'auto') {
        formData.append('language', selectedLanguage)
      }
      requestAbortController = new AbortController()
      transcribeAbortController = requestAbortController

      const response = await fetch('/codex-api/transcribe', {
        method: 'POST',
        body: formData,
        signal: requestAbortController.signal,
      })

      const responseText = await response.text()
      let data: { text?: string; error?: string } | null = null
      try {
        data = responseText.trim() ? (JSON.parse(responseText) as { text?: string; error?: string }) : null
      } catch {
        data = null
      }

      if (!response.ok) {
        const jsonError = data?.error?.trim()
        const textError = responseText.trim()
        throw new Error(jsonError || textError || `Transcription failed: ${response.status}`)
      }

      const text = extractTranscriptText(data)
      if (text.length > 0) {
        options.onTranscript(text)
      } else {
        options.onEmpty?.()
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      options.onError?.(error)
    } finally {
      if (requestAbortController && transcribeAbortController === requestAbortController) {
        transcribeAbortController = null
      }
      if (state.value === 'transcribing') {
        state.value = 'idle'
      }
    }
  }

  async function transcribeFile(file: File) {
    if (!supportsFileUpload.value) {
      throw new Error('当前浏览器不支持语音文件上传。')
    }
    if (!(file instanceof File) || file.size <= 0) {
      options.onEmpty?.()
      return
    }
    await transcribeBlob(file, {
      mimeType: file.type || 'audio/webm',
      fileName: file.name || undefined,
    })
  }

  function cleanup() {
    stopWaveformCapture()
    resetWaveformDisplay()
    if (mediaRecorder) {
      mediaRecorder.ondataavailable = null
      mediaRecorder.onstop = null
      mediaRecorder = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop())
      mediaStream = null
    }
    chunks = []
  }

  onBeforeUnmount(() => {
    cancel()
  })

  function toggleRecording() {
    if (state.value === 'recording' || state.value === 'requesting') {
      stopRecording()
      return
    }
    if (state.value === 'idle' || state.value === 'transcribing') {
      void startRecording()
    }
  }

  return {
    state,
    isSupported,
    supportsLiveRecording,
    supportsFileUpload,
    supportsNativeDictation,
    recordingDurationMs,
    waveformCanvasRef,
    startRecording,
    stopRecording,
    toggleRecording,
    transcribeFile,
    cancel,
  }
}
