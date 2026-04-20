// ============================================
// AI SERVICE (PRODUCT ASSISTANT)
// File: backend/services/aiService.js
// ============================================

const fetch = require('node-fetch');
const db = require('../config/database');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const DEFAULT_AI_NAME = 'Tro ly AI Dat Dev';
const DEFAULT_AI_PERSONALITY = 'Than thien, ro rang, uu tien tra loi ngan gon va de hieu.';
const DEFAULT_AI_KNOWLEDGE = 'San giao dich ma nguon, mua ban source code, nap tien, tai xuong, demo san pham, ho tro nguoi dung.';
const DEFAULT_AI_SYSTEM_PROMPT = '';

function parseJsonFromText(text = '') {
    const trimmed = text.trim();
    if (!trimmed) return null;

    try {
        return JSON.parse(trimmed);
    } catch (err) {
        // continue
    }

    const block = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/i);
    if (block && block[1]) {
        try {
            return JSON.parse(block[1].trim());
        } catch (err) {
            // continue
        }
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(trimmed.slice(start, end + 1));
        } catch (err) {
            return null;
        }
    }
    return null;
}

function normalizeHighlights(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => (item || '').toString().trim())
        .filter(Boolean)
        .slice(0, 5);
}

async function getAiConfig() {
    const keys = ['ai_api_key', 'ai_name', 'ai_personality', 'ai_knowledge', 'ai_system_prompt'];
    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await db.execute(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE setting_key IN (${placeholders})`,
        keys
    );

    const map = {};
    rows.forEach(row => {
        map[row.setting_key] = (row.setting_value || '').toString();
    });

    return {
        apiKey: (map.ai_api_key || process.env.GEMINI_API_KEY || '').trim(),
        name: (map.ai_name || process.env.AI_NAME || DEFAULT_AI_NAME).trim(),
        personality: (map.ai_personality || process.env.AI_PERSONALITY || DEFAULT_AI_PERSONALITY).trim(),
        knowledge: (map.ai_knowledge || process.env.AI_KNOWLEDGE || DEFAULT_AI_KNOWLEDGE).trim(),
        systemPrompt: (map.ai_system_prompt || process.env.AI_SYSTEM_PROMPT || DEFAULT_AI_SYSTEM_PROMPT).trim()
    };
}

function buildPersonaPrompt(config = {}) {
    const name = config.name || DEFAULT_AI_NAME;
    const personality = config.personality || DEFAULT_AI_PERSONALITY;
    const knowledge = config.knowledge || DEFAULT_AI_KNOWLEDGE;
    const customPrompt = config.systemPrompt ? `\nHuong dan bo sung tu admin:\n${config.systemPrompt}` : '';

    return `
Ban la ${name} cua website Dat Dev Shop.
Tinh cach: ${personality}
Pham vi kien thuc uu tien: ${knowledge}
${customPrompt}
`.trim();
}

async function generateFromGemini(prompt, config = {}) {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY in backend environment');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: prompt }]
                    }
                ]
            })
        });

        const result = await response.json();
        if (!response.ok) {
            const message = result?.error?.message || 'Gemini request failed';
            throw new Error(message);
        }

        return result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
    } finally {
        clearTimeout(timeout);
    }
}

async function askProductAssistant(product = {}, question = '') {
    const config = await getAiConfig();
    const personaPrompt = buildPersonaPrompt(config);
    const prompt = `
${personaPrompt}

Ban la tro ly ban hang cho website Dat Dev Shop.
Tra ve DUY NHAT JSON hop le, khong them giai thich ngoai JSON.

Yeu cau:
- Ngon ngu: tieng Viet.
- summary: 1-2 cau tom tat san pham.
- highlights: mang 3-5 y chinh, moi y ngan gon.
- answer: tra loi cau hoi cua khach, trung thuc theo thong tin san pham.

Du lieu san pham:
- tieu de: ${product.title || ''}
- gia: ${Number(product.price || 0).toLocaleString('vi-VN')} VND
- mo ta: ${product.description || ''}
- noi dung: ${product.content || ''}
- danh muc: ${Array.isArray(product.categories) ? product.categories.map(c => c.name).filter(Boolean).join(', ') : ''}

Cau hoi khach hang:
${question || 'Hay gioi thieu nhanh san pham nay phu hop cho doi tuong nao.'}

Khuon JSON:
{
  "summary": "string",
  "highlights": ["string"],
  "answer": "string"
}
`.trim();

    const text = await generateFromGemini(prompt, config);
    const parsed = parseJsonFromText(text) || {};

    const summary = (parsed.summary || '').toString().trim();
    const answer = (parsed.answer || '').toString().trim();
    const highlights = normalizeHighlights(parsed.highlights);

    return {
        summary: summary || 'Chua co tom tat tu AI.',
        highlights: highlights.length ? highlights : ['Chua trich xuat duoc diem noi bat.'],
        answer: answer || 'Xin loi, AI chua tra loi duoc cau hoi nay.'
    };
}

async function askQuickAssistant(question = '') {
    const normalizedQuestion = (question || '').toString().trim();
    if (!normalizedQuestion) {
        throw new Error('Question is required');
    }
    if (normalizedQuestion.length > 500) {
        throw new Error('Question is too long (max 500 characters)');
    }

    const config = await getAiConfig();
    const personaPrompt = buildPersonaPrompt(config);
    const prompt = `
${personaPrompt}

Ban la tro ly AI cho website Dat Dev Shop.
Tra loi bang tieng Viet, ngan gon, de hieu, toi da 5 cau.
Neu cau hoi ve website, tap trung vao:
- mua ban source code
- nap tien, tai xuong sau khi mua
- danh muc san pham, demo, lien he ho tro
Neu khong ro, hay tra loi than trong va de xuat lien he admin.

Cau hoi:
${normalizedQuestion}
`.trim();

    const text = await generateFromGemini(prompt, config);
    const answer = (text || '').toString().trim();

    return {
        answer: answer || 'Xin loi, hien tai toi chua tra loi duoc. Ban vui long thu lai sau.'
    };
}

module.exports = {
    askProductAssistant,
    askQuickAssistant,
    getAiConfig
};
