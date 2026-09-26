import authorRules from '../rules/ruleset.json' with { type: 'json' };

const speech = authorRules.speech;
if (Object.keys(speech).join(',') !== 'maxChars' ||
    !Number.isSafeInteger(speech.maxChars) || speech.maxChars < 1) {
  throw new Error('INVALID_SPEECH_POLICY');
}

export const maxSpeechChars = speech.maxChars;
