import { ChatVertexAI } from "@langchain/google-vertexai";
import logger from "../config/logger";
// Or, if using the web entrypoint:
// import { ChatVertexAI } from "@langchain/google-vertexai-web";

const client = new ChatVertexAI({
  model: "gemini-2.0-flash-001",
  authOptions: {
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  },
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
