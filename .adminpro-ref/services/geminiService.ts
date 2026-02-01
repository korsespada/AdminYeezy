import { GoogleGenAI } from "@google/genai";
import { Product } from "../types";

// Initialize the Gemini client safely
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API_KEY is missing from environment variables.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const generateProductDescription = async (product: Product): Promise<string | null> => {
  const ai = getClient();
  if (!ai) return null;

  try {
    const prompt = `
      Ты профессиональный копирайтер для e-commerce.
      Напиши краткое, продающее описание (максимум 2 предложения) на русском языке для следующего товара:
      Название: ${product.name}
      Бренд: ${product.brand}
      Категория: ${product.category} / ${product.subcategory}
      Цена: ${product.price}
      
      Сделай акцент на премиальности и выгоде. Не используй смайлики.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 } // Disable thinking for faster short text
      }
    });

    return response.text?.trim() || "Не удалось сгенерировать описание.";
  } catch (error) {
    console.error("Error generating description:", error);
    return null;
  }
};