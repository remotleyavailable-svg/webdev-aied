export interface ScriptRow {
  id: string;
  originalScript: string;
  tone: string;
  generatedScript: string;
  audioBase64?: string;
  status: 'idle' | 'processing' | 'done' | 'error';
  errorMessage?: string;
}

export const TONES = [
  'Original',
  'Excited & Energetic',
  'Calm & Professional',
  'Urgent & Compelling',
  'Friendly & Casual',
  'Authoritative',
  'Humorous'
];
