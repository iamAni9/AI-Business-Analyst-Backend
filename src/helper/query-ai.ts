import { ChatGoogleGenerativeAI } from "@langchain/google-genai";


const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash",
    apiKey: process.env.GOOGLE_API_KEY,
});


export async function queryAI(systemPrompt: string, userPrompt: string, jsonMode: boolean = false): Promise<string> {
    const completion = await model.invoke([
        {
            role: "system",
            content: systemPrompt
        },
        {
            role: "user",
            content: [
                { type: "text", text: userPrompt },
            ]
        },
    ]);

    // Clean the response by removing markdown code block markers
    let response = completion.content.toString();
    response = response.replace(/```json\n?|\n?```/g, '').trim();
    
    return response;
}