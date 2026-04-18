export const GOOGLE_TTS_VOICES = [
  { name: 'en-US-Journey-D', label: 'Journey D (Male, Deep)' },
  { name: 'en-US-Journey-F', label: 'Journey F (Female, Professional)' },
  { name: 'en-US-Standard-A', label: 'Standard A (Male)' },
  { name: 'en-US-Standard-B', label: 'Standard B (Male)' },
  { name: 'en-US-Standard-C', label: 'Standard C (Female)' },
  { name: 'en-US-Standard-E', label: 'Standard E (Female)' },
];

export const generateGoogleTTS = async (text: string, voiceName: string): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is missing.");
  }

  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'en-US', name: voiceName },
      audioConfig: { audioEncoding: 'MP3' }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Google TTS API Error: ${response.status}`);
  }

  const data = await response.json();
  return data.audioContent; // Returns base64 encoded MP3 string
};
