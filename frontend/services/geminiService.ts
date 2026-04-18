import { GoogleGenAI } from '@google/genai';

export const generateToneVariation = async (script: string, tone: string): Promise<string> => {
  if (!tone || tone === 'Original') {
    return script;
  }

  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `You are an expert ad copywriter. Rewrite the following ad script to have a "${tone}" tone. 
      Keep it roughly the same length and suitable for a voiceover. 
      Do not add any extra commentary, markdown formatting, or quotes around the output. Just return the raw script text.
      
      Original Script:
      ${script}`,
      config: {
        temperature: 0.7,
      }
    });

    return response.text.trim();
  } catch (error: any) {
    console.error("Error generating variation:", error);
    throw new Error(error.message || "Failed to generate variation");
  }
};
