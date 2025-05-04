"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryAI = queryAI;
const google_genai_1 = require("@langchain/google-genai");
const model = new google_genai_1.ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash",
    apiKey: "AIzaSyDXxtY7A7aM-CHGiDTe6PbJme4rvnnBitg",
});
function queryAI(systemPrompt_1, userPrompt_1) {
    return __awaiter(this, arguments, void 0, function* (systemPrompt, userPrompt, jsonMode = false) {
        const completion = yield model.invoke([
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
    });
}
