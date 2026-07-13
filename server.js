import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.get("/", (req, res) => {
  res.json({
    status: "BembaHub Backend is running!"
  });
});

app.post("/translate", async (req, res) => {
  try {
    const { text, direction } = req.body;

    const prompt =
      direction === "en-bm"
        ? `Translate the following English text into natural Bemba. Return only the translation:\n\n${text}`
        : `Translate the following Bemba text into English. Return only the translation:\n\n${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    res.json({
      translation: response.text
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Translation failed."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
