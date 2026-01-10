import * as FileSystem from 'expo-file-system/legacy';

const INITIAL_KEYS: string[] = [];

let availableKeys: string[] = [];
let currentKeyIndex = 0;

// Path for custom keys
const CUSTOM_KEYS_PATH = FileSystem.documentDirectory + 'custom_keys.json';

// Initialize keys on start
(async () => {
    try {
        const fileInfo = await FileSystem.getInfoAsync(CUSTOM_KEYS_PATH);
        if (fileInfo.exists) {
            const content = await FileSystem.readAsStringAsync(CUSTOM_KEYS_PATH);
            const json = JSON.parse(content);
            if (Array.isArray(json) && json.length > 0) {
                console.log("Loaded custom keys from storage.");
                availableKeys = json;
            }
        }
    } catch (e) {
        console.warn("Failed to load custom keys", e);
    }
})();

// Helper to persist keys
const saveKeysToStorage = async (keys: string[]) => {
    try {
        await FileSystem.writeAsStringAsync(CUSTOM_KEYS_PATH, JSON.stringify(keys));
        console.log(`Persisted ${keys.length} keys to storage.`);
    } catch (e) {
        console.error("Failed to save keys", e);
    }
};

export function getKeyCount(): number {
    return availableKeys.length;
}

export function getAllKeys(): string[] {
    return [...availableKeys];
}

export async function deleteKey(keyToDelete: string): Promise<void> {
    availableKeys = availableKeys.filter(k => k !== keyToDelete);
    await saveKeysToStorage(availableKeys);
}

export async function addKey(newKey: string): Promise<boolean> {
    if (!newKey || newKey.trim() === "") return false;

    const trimmedKey = newKey.trim();

    // Check duplicate
    if (availableKeys.includes(trimmedKey)) {
        console.log("Key already exists, skipping add.");
        return false;
    }

    // Append
    availableKeys.push(trimmedKey);
    await saveKeysToStorage(availableKeys);
    return true;
}

export async function addMultipleKeys(newKeys: string[]): Promise<number> {
    let addedCount = 0;
    for (const key of newKeys) {
        const trimmed = key.trim();
        if (trimmed && !availableKeys.includes(trimmed)) {
            availableKeys.push(trimmed);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        await saveKeysToStorage(availableKeys);
    }
    return addedCount;
}

function getNextKey(): string {
    if (availableKeys.length === 0) {
        throw new Error("No API keys found. Please add a Gemini API Key in Settings.");
    }
    const key = availableKeys[currentKeyIndex % availableKeys.length];
    currentKeyIndex++;
    return key;
}

function removeKey(keyToRemove: string) {
    console.warn(`Removing exhausted key: ${keyToRemove.substring(0, 10)}...`);
    // Ideally we also delete from storage if it's permanently dead? 
    // For now, in-memory removal for the session to avoid wiping valid keys on temporary errors.
    // If we want permanent removal, we'd call deleteKey. 
    // The user might want to manually delete "bad" keys.
    availableKeys = availableKeys.filter(k => k !== keyToRemove);
    if (availableKeys.length === 0) {
        console.error("CRITICAL: All keys exhausted!");
    }
}

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function fetchWithRetry(urlBase: string, body: any, retries = 3): Promise<Response> {

    // Get a key for this attempt
    let apiKey = getNextKey();

    try {
        const response = await fetch(`${urlBase}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        // Handle Rate Limits (429)
        if (response.status === 429) {
            console.log(`Key ${apiKey.substring(0, 8)}... hit 429. Removing from pool.`);
            removeKey(apiKey);

            if (availableKeys.length > 0) {
                // Retry immediately with a DIFFERENT key (recursive)
                console.log("Retrying with next available key...");
                return fetchWithRetry(urlBase, body, retries);
            } else {
                throw new Error("All API keys exhausted.");
            }
        }

        if (!response.ok) {
            // Log the error detail
            const errorText = await response.text();
            console.error(`Gemini API Failed [${response.status}]:`, errorText);
            // Don't throw here, let the caller handle the non-ok response or throw specific error structure
            // But usually we want to throw if it's a hard failure to trigger the catch block below?
            // Actually, the original code returned response and caller checked ok.
            // Let's attach the error text to the response object or just log it effectively.
            // We can't easily modify the response body stream once read.
            // So we reconstruct it or throw a custom error.
            throw new Error(`Gemini API Error ${response.status}: ${errorText}`);
        }

        return response;

    } catch (error: any) {
        // If it was a network error or something else, standard backoff might apply
        // But for now, if keys are exhausted, we fail.
        if (error.message.includes("exhausted")) throw error;

        console.warn(`Attempt failed with key ${apiKey.substring(0, 5)}... Error: ${error.message}`);

        if (retries > 0) {
            await new Promise(r => setTimeout(r, 1000));
            return fetchWithRetry(urlBase, body, retries - 1);
        }
        throw error;
    }
}

import { PDFDocument } from 'pdf-lib';

// ... (fetchWithRetry remains the same) ...

// Helper to generate script for a SINGLE page
async function generateScriptForPage(pageBase64: string, pageNum: number, previousContext: string | null): Promise<any> {
    const contextInstruction = previousContext
        ? `PREVIOUS CONTEXT (Summary of past pages): "${previousContext}"`
        : `PREVIOUS CONTEXT: None (Start of book).`;

    const prompt = `
    You are an expert audio content creator.
    Task: Create a seamless audio narration for Page ${pageNum} of the attached PDF.

    Context Info:
    ${contextInstruction}
    
    INSTRUCTIONS:
    1. **Analyze**: Read the page content comprehensively.
    2. **Current Summary (S)**: Generate a concise summary of THIS page's events/info.
    3. **Update Context (C)**: Calculate the new context using: Context = (0.8 * S) + (0.2 * Previous Context).
       - If Previous Context is "None", Context = S.
       - Output the final calculated string for "context_summary".
    4. **Visual Prompt**: Create a short, descriptive, visual prompt (max 5-7 words) that captures the mood/scene of this page (e.g., "Cyberpunk city rain neon", "Ancient library old books").
    5. **Generate Script**: Write the finalized audio narration.
       - Style: Professional, engaging, clear.
       - Content: Accurately narrate the page content.
       - Do NOT prefix with "Page X".

    Output Format (JSON):
    {
        "script": "The narration text...",
        "context_summary": "The updated context string...",
        "page_summary": "The summary of this page (S)",
        "visual_prompt": "Abstract tech background blue"
    }
    Return ONLY valid JSON.
    `;

    try {
        const response = await fetchWithRetry(API_URL, {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: "application/pdf",
                            data: pageBase64
                        }
                    }
                ]
            }],
            generationConfig: { responseMimeType: "application/json" }
        });

        if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("No content from Gemini");

        return JSON.parse(text);
    } catch (e) {
        console.error(`Error processing page ${pageNum}`, e);
        throw e;
    }
}

export async function processPdfAndGenerateScript(base64Data: string, onProgress?: (current: number, total: number) => void) {
    try {
        console.log("Loading PDF...");
        const pdfDoc = await PDFDocument.load(base64Data);
        const totalPages = pdfDoc.getPageCount();
        console.log(`PDF has ${totalPages} pages.`);

        const results = [];
        let currentContext = "";

        // Loop through each page
        for (let i = 0; i < totalPages; i++) {
            const pageNum = i + 1;
            if (onProgress) onProgress(pageNum, totalPages);
            console.log(`Processing Page ${pageNum}/${totalPages}...`);

            // Extract single page
            const newPdf = await PDFDocument.create();
            const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
            newPdf.addPage(copiedPage);
            const pageBase64 = await newPdf.saveAsBase64();

            // Call API
            try {
                const result = await generateScriptForPage(pageBase64, pageNum, currentContext);

                // Update Context for next iteration
                currentContext = result.context_summary || "";

                results.push({
                    page: pageNum,
                    script: result.script,
                    context_summary: currentContext,
                    visual_prompt: result.visual_prompt || "Audiobook cover artistic"
                });

            } catch (err) {
                console.error(`Failed to process page ${pageNum}, skipping/retrying...`, err);
                // Optional: Retry logic or placeholder?
                // For now, push a placeholder to keep index alignment or just skip?
                // Let's push a placeholder error note so audio doesn't break
                results.push({
                    page: pageNum,
                    script: "Audio generation failed for this page.",
                    context_summary: currentContext
                });
            }
        }

        return results;

    } catch (error) {
        console.error("Critical error in PDF processing loop:", error);
        throw error;
    }
}
// --- QUIZ GENERATION HELPERS ---

async function generateQuizForChunk(promptContent: { text?: string, pdfBase64?: string }, numQuestions: number): Promise<any[]> {
    const prompt = `
    Task: Generate exactly ${numQuestions} multiple-choice questions (MCQs) based on the provided content.
    
    Output Format (JSON Array):
    {
      "mcqs": [
        {
          "question": "Question text...",
          "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
          "answer": "A",
          "explanation": "Brief explanation..."
        }
      ]
    }
    
    CRITICAL RULES:
    1. Return ONLY valid JSON.
    2. Ensure "answer" is one of "A", "B", "C", "D".
    3. Questions should be challenging and relevant.
    `;

    const parts: any[] = [{ text: prompt }];

    if (promptContent.text) {
        parts.push({ text: `CONTENT:\n${promptContent.text}` });
    }
    if (promptContent.pdfBase64) {
        parts.push({
            inline_data: {
                mime_type: "application/pdf",
                data: promptContent.pdfBase64
            }
        });
    }

    try {
        const response = await fetchWithRetry(API_URL, {
            contents: [{ parts }],
            generationConfig: { responseMimeType: "application/json" }
        });

        if (!response.ok) throw new Error(`Gemini Quiz Error: ${response.status}`);
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("No quiz content from Gemini");

        const json = JSON.parse(text);
        return json.mcqs || [];
    } catch (e) {
        console.error("Quiz generation failed for chunk", e);
        return []; // Return empty on failure to allow partial results? Or throw?
        // Better to return empty so one bad chunk doesn't kill the whole quiz.
    }
}

export async function generateQuizFromText(fullText: string, totalQuestions: number, onProgress?: (msg: string) => void): Promise<any[]> {
    // 1. Chunking
    // Gemini 1.5/2.0 Flash has HUGE context (1M tokens).
    // For most transcripts (e.g. 1 hour video ~ 10k words), we don't strictly need to chunk for context limits.
    // However, generating 50 questions in one go might degrade quality/formatting.
    // Let's safe-limit to chunks of ~15,000 characters if text is massive, or just process in one go if small.
    // Given mobile constraints, let's chunk if > 20k chars (~4k tokens).

    const CHUNK_SIZE = 20000;
    const items: any[] = [];

    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
        chunks.push(fullText.substring(i, i + CHUNK_SIZE));
    }

    const numChunks = chunks.length;
    const baseQ = Math.floor(totalQuestions / numChunks);
    const remainder = totalQuestions % numChunks;

    const allMcqs: any[] = [];

    for (let i = 0; i < numChunks; i++) {
        const isLuckyChunk = i < remainder;
        const qCount = baseQ + (isLuckyChunk ? 1 : 0);

        if (qCount === 0) continue;

        if (onProgress) onProgress(`Processing part ${i + 1}/${numChunks}...`);

        const mcqs = await generateQuizForChunk({ text: chunks[i] }, qCount);

        // Add IDs
        mcqs.forEach((m: any, idx: number) => {
            m.id = `${Date.now()}_${i}_${idx}`;
            allMcqs.push(m);
        });
    }

    return allMcqs;
}

export async function generateQuizFromPdf(base64Data: string, questionsPerPage: number, onProgress?: (current: number, total: number) => void): Promise<any[]> {
    const pdfDoc = await PDFDocument.load(base64Data);
    const totalPages = pdfDoc.getPageCount();
    const allMcqs: any[] = [];

    // Batch size = 2
    for (let i = 0; i < totalPages; i += 2) {
        const pageNum = i + 1;
        const isPair = (i + 1) < totalPages;
        const batchSize = isPair ? 2 : 1;
        const targetQ = questionsPerPage * batchSize;

        if (onProgress) onProgress(pageNum, totalPages);
        console.log(`Quiz Gen: Processing Page ${pageNum}${isPair ? `-${pageNum + 1}` : ''}/${totalPages}...`);

        // Extract Pages
        const newPdf = await PDFDocument.create();
        const pagesToCopy = isPair ? [i, i + 1] : [i];
        const copiedPages = await newPdf.copyPages(pdfDoc, pagesToCopy);
        copiedPages.forEach(p => newPdf.addPage(p));
        const batchBase64 = await newPdf.saveAsBase64();

        const mcqs = await generateQuizForChunk({ pdfBase64: batchBase64 }, targetQ);

        mcqs.forEach((m: any, idx: number) => {
            m.id = `${Date.now()}_${pageNum}_${idx}`;
            allMcqs.push(m);
        });
    }


    return allMcqs;
}

// --- ANALYSIS HELPERS ---

export async function analyzeQuizWeakness(problemQuestions: any[], userAnswers: { [key: string]: string }): Promise<string> {
    const summary = problemQuestions.map((q, i) => {
        const ua = userAnswers[q.id];
        return `Q${i + 1}: ${q.question}\nCorrect: ${q.answer} (${q.options[q.answer]})\nUser Answered: ${ua || 'Skipped'}\nExplanation: ${q.explanation}\n`;
    }).join('\n');

    const prompt = `
    Task: Act as an expert tutor. I have just taken a quiz and got the following questions WRONG or SKIPPED.
    
    Analyze my mistakes and provide a concise, encouraging, and actionable "Weakness Analysis".
    
    SPECIFIC INSTRUCTIONS:
    1. Identify any common patterns (e.g., "You seem to confuse X with Y").
    2. Provide 3 specific bullet points of concepts I should review.
    3. Keep it friendly but academic.
    4. Do not just list the correct answers again; explain the *underlying* gap in knowledge.
    
    Here is the data:
    ${summary}
    `;

    try {
        const response = await fetchWithRetry(API_URL, {
            contents: [{ parts: [{ text: prompt }] }]
        });

        if (!response.ok) throw new Error("Analysis request failed");

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        return text || "Could not generate analysis.";

    } catch (e) {
        console.error("Analysis Error", e);
        return "Sorry, I couldn't analyze your results right now. Please try again.";
    }
}

export async function updateRollingAnalysis(oldSummary: string, oldWeight: number, newProblems: any[], userAnswers: { [key: string]: string }): Promise<string> {
    const newSummaryData = newProblems.map((q, i) => {
        const ua = userAnswers[q.id];
        return `New Q${i + 1}: ${q.question}\nCorrect: ${q.answer}\nUser: ${ua || 'Skipped'}\nExplanation: ${q.explanation}\n`;
    }).join('\n');

    const newWeight = newProblems.length;

    const prompt = `
    Task: Update a "Study Guide" rolling summary.
    
    Context:
    - We have an existing analysis based on ${oldWeight} past questions.
    - We just analyzed ${newWeight} NEW questions (Mistakes/Skips).
    
    Goal: Merge the "Old Analysis" with the "New Findings" to create a single, up-to-date Rolling Summary. Use a weighted approach: ensure the new findings are integrated proportionally (Ratio ${oldWeight}:${newWeight}).
    
    Old Analysis:
    """${oldSummary}"""
    
    New Findings Data:
    """${newSummaryData}"""
    
    Instructions:
    1. Result should be a single cohesive analysis (not just "Old section + New section").
    2. If the user repeats a mistake found in Old Analysis, emphasize it ("Persistent Issue").
    3. If New Findings show improvement on old weaknesses, acknowledge it.
    4. Provide 3-4 top priority review points based on the COMBINED data.
    `;

    try {
        const response = await fetchWithRetry(API_URL, {
            contents: [{ parts: [{ text: prompt }] }]
        });

        if (!response.ok) throw new Error("Rolling Analysis request failed");

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        return text || oldSummary; // Fallback to old if fail

    } catch (e) {
        console.error("Rolling Analysis Error", e);
        return oldSummary; // Safer fallback
    }
}
