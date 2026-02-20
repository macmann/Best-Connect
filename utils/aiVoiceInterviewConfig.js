function isTruthy(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function parseIceServers(rawValue) {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function getAiVoiceInterviewConfig() {
  const featureFlagEnabled =
    isTruthy(process.env.AI_VOICE_INTERVIEW_ENABLED) ||
    isTruthy(process.env.ENABLE_AI_VOICE_INTERVIEW) ||
    isTruthy(process.env.AI_REALTIME_ENABLED);

  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const enabled = featureFlagEnabled && hasOpenAiKey;

  return {
    enabled,
    featureFlagEnabled,
    hasOpenAiKey
  };
}

function getAiVoiceInterviewRealtimeConfig() {
  const iceServers = parseIceServers(
    process.env.PUBLIC_AI_REALTIME_ICE_SERVERS || process.env.OPENAI_REALTIME_ICE_SERVERS || ''
  );

  return {
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
    voice: process.env.OPENAI_REALTIME_VOICE || 'alloy',
    transcriptionModel: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    maxDurationSec: Number(process.env.PUBLIC_AI_REALTIME_MAX_DURATION_SEC || 600),
    allowInterruptions: isTruthy(process.env.PUBLIC_AI_REALTIME_ALLOW_INTERRUPTION ?? 'true'),
    iceServers
  };
}

function isAiVoiceInterviewEnabled() {
  return getAiVoiceInterviewConfig().enabled;
}

module.exports = {
  getAiVoiceInterviewConfig,
  getAiVoiceInterviewRealtimeConfig,
  isAiVoiceInterviewEnabled
};
