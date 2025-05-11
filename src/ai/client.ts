import { ChatVertexAI } from "@langchain/google-vertexai";
import dotenv from "dotenv";
import logger from "../config/logger";
// Or, if using the web entrypoint:
// import { ChatVertexAI } from "@langchain/google-vertexai-web";
dotenv.config();
if (!process.env.GOOGLE_VERTEX_AI_WEB_CREDENTIALS) {
    throw new Error("GOOGLE_VERTEX_AI_WEB_CREDENTIALS environment variable is not set");
}

const client = new ChatVertexAI({
  model: "gemini-2.0-flash-001",
  authOptions: {
    credentials: JSON.parse(process.env.GOOGLE_VERTEX_AI_WEB_CREDENTIALS)
  }
});

export const query = async(userQuery: string, systemPrompt: string, responseFormat?: string) => {
    try {
        const res = await client.invoke([
            [
                "system",
                systemPrompt + "\nIMPORTANT: Respond ONLY with valid JSON. Do not include any markdown formatting, code blocks, or additional text. The response must be parseable JSON.",
            ],
            [
                "human",
                userQuery,
            ],
          
          ]);
          console.log("--------------------------------",res.content)
     return res.content
    } catch (error) {
        logger.error("Error querying AI", error);
        throw error;
    }
}
