// api/chat.js
// هذه الدالة تعمل على خادم Vercel (سيرفرلس) — المفاتيح تبقى هنا فقط ولا تصل أبداً لمتصفح المستخدم.
// تدعم: محادثة عادية (+ اكتشاف تلقائي لطلبات الصور)، وضع "إنشاء صورة" المباشر، و3 تخصصات نماذج (عام/برمجة/تحليل).
// كل تخصص له ترتيب مزوّدين مختلف؛ لو فشل الأول (ازدحام/خطأ خادم) يتحول تلقائياً للثاني.

const BASE_SYSTEM_PROMPT = `You are "Nextra AI" (نكسترا), a warm, helpful, multilingual AI assistant created for the public to use for free.

CRITICAL — never show your internal reasoning: never output <think>, </think>, or any chain-of-thought/reasoning trace in your reply. Do not narrate your analysis process, do not write things like "Here's a thinking process" or numbered internal steps. Go straight to the final, clean, user-facing answer only — nothing else.
Always reply in the same language the user writes in (Arabic or English), matching their dialect/register naturally.
If the user writes in Arabic, reply in Arabic. If in English, reply in English. If mixed, mirror the dominant language.

Tone and style: be genuinely helpful, warm, and respectful — like a knowledgeable friend, not a corporate manual. Write in natural, flowing prose, the way a person would speak in normal conversation. Avoid over-using bullet lists, numbered lists, or bold headings by default; reserve that kind of structure for cases where it truly aids clarity (e.g. real step-by-step instructions, comparing several distinct options, or a genuine list of items). Most everyday replies should just be well-written paragraphs.

CRITICAL — language purity: reply ENTIRELY in one language only (Arabic or English, matching the user). NEVER insert stray words, characters, or fragments from any other language (Chinese, Thai, Hindi, Russian, Korean, etc.) into your reply under any circumstance. If you notice you are unsure of a word, choose a simpler word in the SAME language instead of guessing in another script. Mixing scripts/languages within a single reply is a serious error — double-check before answering that every word is in the correct language.

Accuracy: never make things up. If you don't know something or aren't sure, say so plainly instead of guessing confidently. Prefer being honestly uncertain over sounding falsely authoritative.

Continuity: if you need to refer to something the user said earlier in the conversation, weave it in naturally as part of the reply — don't explicitly announce that you "remember" or "recall" it.

Clarification: if a question or request is ambiguous or missing key details, ask a brief, polite clarifying question rather than guessing wildly.

Sensitive topics: stay neutral and balanced on political, religious, or other controversial/divisive topics — present different perspectives fairly rather than pushing one side. Do not provide medical diagnoses or dangerous/harmful instructions (e.g. weapons, drugs, self-harm). For health or legal questions, share general, safe, well-established information and gently suggest consulting a qualified professional for anything serious, without being preachy or repetitive about it. Be supportive and encouraging without exaggerating or being saccharine.

Your overall goal: give answers that are useful, accurate, and easy to understand, in a tone that feels natural, warm, and trustworthy.

Follow-up suggestions: after a substantive reply (not for simple greetings or one-word acknowledgements), think of up to 3 short, natural follow-up actions the user might want next — things like continuing the idea, going deeper on one part, or a related next step. Append them at the very end of your reply as a single hidden line in EXACTLY this format (nothing else on that line):
SUGGESTIONS::suggestion one|suggestion two|suggestion three
Each suggestion must be very short (3-6 words), written from the user's point of view as something THEY would say next (e.g. "لخّص هذا بجدول", "اشرح النقطة الثانية أكثر", "اكتب نسخة أقصر"), in the same language as your reply. If nothing meaningful fits, omit this line entirely. Never mention this line or its format in the visible part of your reply.

Special case — identity: if the user asks who you are, who made/built/developed/created/programmed you, what company made you, or similar (e.g. "من أنت", "من طورك", "من برمجك", "من صنعك", "مين سواك", "ما هي شركتك", "من صممك", "who are you", "who made you", "who developed you", "what company made you"), you MUST answer using this exact fixed reply, in the same language as the user's question, and nothing else should contradict it:
If the user writes in Arabic, reply with exactly this sentence (you may add at most one short warm sentence before or after it, but never alter or omit it): "تم التطوير من قبل شركة Nextra AI من قبل الخبراء التقنيين عتيق الجذوة وعبدالمجيد الجهمي".
If the user writes in English, reply with: "Developed by Nextra AI, by tech experts Atiq Al-Jathwah and Abdulmajeed Al-Jahmi." (You may add at most one short warm sentence before or after it, but never alter or omit this core statement.)
This exact identity answer applies everywhere in the conversation, regardless of specialization mode (general, coding, or analysis) or how the question is phrased.

Special case — images: if (and only if) the user is asking you to draw, create, generate, design, or imagine an image/picture/logo/artwork/illustration, do NOT write a normal reply. Instead reply with EXACTLY one line and nothing else, in this exact format:
IMAGE_REQUEST::<a short, vivid, detailed prompt in English describing the image, translated and enhanced from the user's request>
Do not add any greeting, explanation, or extra text before or after that line. For every other kind of message, ignore this rule and reply normally as instructed above.`;

const SPECIALIZATION_PROMPTS = {
  coding: `\n\nSpecialization — coding mode: the user has switched you into a programming-focused mode. Prioritize correct, working, well-structured code. Use proper code blocks with language tags. If the programming language or framework isn't specified and it matters, ask briefly. Explain code concisely alongside it, but the code itself is the priority — don't pad with unnecessary theory.`,
  analysis: `\n\nSpecialization — analysis & research mode: the user has switched you into a deep-analysis mode. Take extra care to reason carefully, weigh different angles, note tradeoffs and uncertainty, and structure longer answers clearly (headings/tables are welcome here when they genuinely help, more so than in normal chat mode). Prioritize thoroughness and accuracy over brevity.`,
};

const TRANSLATE_PROMPT = `You turn a user's image request (in Arabic or English) into a short, vivid, detailed image-generation prompt in English. Reply with ONLY the prompt text, nothing else — no quotes, no explanation, no prefix.`;

const FREE_IMAGE_LIMIT = 3; // عدد الصور المجانية بالساعة لكل جهاز

// يتحقق من حد الصور عبر Upstash Redis (اختياري: لو المفاتيح غير مضبوطة، ما فيه حد إطلاقاً)
async function checkImageLimit(deviceId) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !deviceId) {
    return { allowed: true, remaining: null }; // قاعدة البيانات غير مفعّلة بعد — بدون حد
  }

  try {
    const key = `imgcount:${deviceId}`;
    const incrRes = await fetch(`${url}/incr/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const incrData = await incrRes.json();
    const count = incrData.result;

    if (count === 1) {
      // أول صورة بهذي الساعة — فعّل عداد الساعة (3600 ثانية)
      await fetch(`${url}/expire/${key}/3600`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    if (count > FREE_IMAGE_LIMIT) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: FREE_IMAGE_LIMIT - count };
  } catch (e) {
    // لو صار خطأ بقاعدة البيانات، لا نمنع المستخدم — نسمح ونكمل
    return { allowed: true, remaining: null };
  }
}

// Groq أوقف llama-3.3-70b-versatile نهائياً بـ 17 يونيو 2026 — البديل الرسمي الموصى به من Groq نفسه: qwen/qwen3.6-27b
const GROQ_MODEL = "qwen/qwen3.6-27b";

// كل تخصص له ترتيب مزوّدين من طبقتين (بعد حذف z-ai/glm-5.2 نهائياً — انتهى عمره رسمياً بتاريخ 2026-08-21 برسالة 410)
// نعتمد بس على نماذج مُستخدمة ومُتحقق منها فعلياً بالكود (بدون أي اسم جديد غير مجرّب)
const SPECIALIZATIONS = {
  general: [
    { provider: "groq", model: GROQ_MODEL },
    { provider: "nvidia", model: "deepseek-ai/deepseek-v4-flash" },
  ],
  coding: [
    { provider: "nvidia", model: "deepseek-ai/deepseek-v4-flash" },
    { provider: "groq", model: GROQ_MODEL },
  ],
  analysis: [
    { provider: "nvidia", model: "mistralai/mistral-large-3-675b-instruct-2512" },
    { provider: "groq", model: GROQ_MODEL },
  ],
};

// نماذج NVIDIA اللي تفهم صور (Vision) — تُستخدم فقط لما يرفع المستخدم صورة، بغض النظر عن التخصص المختار
const VISION_ORDER = [
  { provider: "nvidia", model: "mistralai/mistral-large-3-675b-instruct-2512" },
  { provider: "nvidia", model: "nvidia/nemotron-3-nano-omni" },
];

const PROVIDER_URLS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
};

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"; // "Nano Banana" — أرخص نموذج صور حقيقي من Gemini (~0.039$/صورة)
const GEMINI_IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

// توليد صورة حقيقية عبر Gemini (مدفوع — يُستخدم فقط لو المستخدم اختار "جودة عالية" واختياره صراحة)
async function generateGeminiImage(prompt, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(GEMINI_IMAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, text };
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p) => p.inlineData?.data);
    if (!imgPart) return { ok: false, status: 502, text: "لم يرجع Gemini بيانات صورة" };
    const mime = imgPart.inlineData.mimeType || "image/png";
    return { ok: true, dataUrl: `data:${mime};base64,${imgPart.inlineData.data}` };
  } catch (e) {
    return { ok: false, status: 0, text: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

const PER_ATTEMPT_TIMEOUT_MS = 18000; // 18 ثانية كحد أقصى لكل محاولة نموذج — لو ما رد بهالوقت، ننتقل للاحتياط التالي فوراً بدل الانتظار

async function callProvider(provider, model, apiKey, systemPrompt, messages, maxTokens, temperature) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
  const body = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature,
    max_tokens: maxTokens,
  };
  // بعض نماذج NVIDIA (GLM, DeepSeek) تدعم إيقاف وضع "التفكير الظاهر" صراحة عبر هذا المعامل — إيقافه هنا كطبقة حماية أولى
  if (provider === "nvidia") {
    body.chat_template_kwargs = { thinking: false };
  }
  try {
    return await fetch(PROVIDER_URLS[provider], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// يجرب مزوّدي التخصص بالترتيب؛ لو رجع 429 (ازدحام) أو خطأ خادم (5xx) أو فشل الاتصال أو تأخر كثير، ينتقل تلقائياً للتالي بالقائمة
// بعض نماذج NVIDIA (خصوصاً لما يفشل Groq وننتقل للاحتياط) تسرّب "تفكيرها الداخلي"
// بصيغة <think>...</think> ضمن الرد نفسه بدل إخفائه. هذي الدالة تشيله دايماً قبل أي عرض للمستخدم.
function stripThinking(text) {
  if (!text) return text;
  // يشيل أي كتلة <think>...</think> كاملة (حتى لو تكررت أو احتوت أسطر متعددة)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // احتياط إضافي: لو الوسم فُتح ولم يُغلق أبداً (انقطع الرد وسط التفكير)، نشيل من <think> للنهاية
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
  return cleaned.trim();
}

async function chatCompletion(order, keys, systemPrompt, messages, maxTokens, temperature) {
  let lastError = null;
  let lastFailedRes = null;

  for (const step of order) {
    const apiKey = keys[step.provider];
    if (!apiKey) continue;
    try {
      const res = await callProvider(step.provider, step.model, apiKey, systemPrompt, messages, maxTokens, temperature);
      if (res.ok) return { ok: true, res, provider: step.provider };
      lastError = { status: res.status, text: await res.text().catch(() => "") };
      lastFailedRes = res;
      // أي خطأ (ازدحام 429، خطأ خادم 5xx، نموذج متوقف/محذوف 404/410، أو أي خطأ آخر) → جرّب المزوّد التالي بدل التوقف فوراً
      continue;
    } catch (e) {
      // يشمل حالة انتهاء المهلة الزمنية (AbortError) — نعتبرها فشل عادي وننتقل للمزوّد التالي
      lastError = { status: 0, text: String(e) };
    }
  }

  return { ok: false, res: lastFailedRes, provider: "none", error: lastError };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const keys = {
    groq: process.env.GROQ_API_KEY?.trim(),
    nvidia: process.env.NVIDIA_API_KEY?.trim(),
    gemini: process.env.GEMINI_API_KEY?.trim(),
  };

  if (!keys.groq && !keys.nvidia) {
    res.status(500).json({
      error: "لا يوجد أي مفتاح API مضبوط (GROQ_API_KEY أو NVIDIA_API_KEY). راجع ملف README.",
    });
    return;
  }

  try {
    const { messages, mode, specialization, deviceId, imageQuality } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages مطلوبة" });
      return;
    }

    const trimmed = messages.slice(-20);
    const spec = SPECIALIZATIONS[specialization] ? specialization : "general";
    let order = SPECIALIZATIONS[spec];
    const temperature = spec === "coding" ? 0.3 : 0.5;

    // لو آخر رسالة من المستخدم فيها صورة مرفوعة (محتوى متعدد الأنواع)، نحوّل تلقائياً لنماذج تفهم الصور
    const lastMsg = trimmed[trimmed.length - 1];
    const hasImage = Array.isArray(lastMsg?.content) && lastMsg.content.some((c) => c.type === "image_url");
    if (hasImage) {
      order = VISION_ORDER;
    }

    // ===== وضع "إنشاء صورة" المباشر (زر الصورة) =====
    if (mode === "image") {
      const limit = await checkImageLimit(deviceId);
      if (!limit.allowed) {
        res.status(200).json({
          type: "text",
          reply: "وصلت للحد المجاني (3 صور بالساعة) 🌸 جرب بعد شوي، أو تابعونا قريباً للاشتراك المدفوع اللي يرفع الحد لـ 50 صورة باليوم.",
          suggestions: [],
        });
        return;
      }

      const lastUserMsg = [...trimmed].reverse().find((m) => m.role === "user");
      const rawPrompt = lastUserMsg?.content?.trim();
      if (!rawPrompt) {
        res.status(400).json({ error: "الرجاء وصف الصورة" });
        return;
      }

      const result = await chatCompletion(
        SPECIALIZATIONS.general,
        keys,
        TRANSLATE_PROMPT,
        [{ role: "user", content: rawPrompt }],
        150,
        0.5
      );

      if (!result.ok) {
        if (result.res?.status === 429) {
          res.status(429).json({ error: "الخدمة مزدحمة حالياً، حاول بعد دقيقة." });
          return;
        }
        res.status(result.res?.status || 502).json({
          error: "خطأ من مزوّد النموذج",
          debug: {
            triedProviders: SPECIALIZATIONS.general.map((s) => s.provider),
            lastStatus: result.error?.status ?? null,
            lastProviderMessage: result.error?.text ?? null,
            hasGroqKey: !!keys.groq,
            hasNvidiaKey: !!keys.nvidia,
          },
        });
        return;
      }

      const data = await result.res.json();
      const enhancedPrompt = stripThinking((data.choices?.[0]?.message?.content || rawPrompt).trim()) || rawPrompt;

      // "جودة عالية" (مدفوع) — يُستخدم فقط لو المستخدم اختارها صراحة ومفتاح Gemini موجود
      if (imageQuality === "premium") {
        if (!keys.gemini) {
          res.status(200).json({
            type: "text",
            reply: "وضع 'جودة عالية' غير مفعّل حالياً (يحتاج مفتاح Gemini من مالك الموقع). جرب الوضع المجاني بدل ذلك 🌸",
            suggestions: [],
          });
          return;
        }
        const gemResult = await generateGeminiImage(enhancedPrompt, keys.gemini);
        if (!gemResult.ok) {
          console.error("gemini image failure:", gemResult.status, gemResult.text);
          res.status(200).json({
            type: "text",
            reply: "تعذّر إنشاء الصورة بجودة عالية حالياً (خطأ من Gemini). جرب الوضع المجاني بدل ذلك 🌸",
            suggestions: [],
          });
          return;
        }
        res.status(200).json({ type: "image", prompt: enhancedPrompt, imageData: gemResult.dataUrl, premium: true });
        return;
      }

      res.status(200).json({ type: "image", prompt: enhancedPrompt });
      return;
    }

    // ===== وضع المحادثة العادي (+ اكتشاف تلقائي لطلبات الصور) =====
    const systemPrompt = BASE_SYSTEM_PROMPT + (SPECIALIZATION_PROMPTS[spec] || "");
    const result = await chatCompletion(order, keys, systemPrompt, trimmed, 1536, temperature);

    if (!result.ok) {
      if (result.res?.status === 429) {
        res.status(429).json({
          error: "الخدمة مزدحمة حالياً (تجاوزنا الحد المجاني المؤقت). حاول بعد دقيقة.",
        });
        return;
      }
      const debugInfo = {
        triedProviders: order.map((s) => s.provider + ":" + s.model),
        lastStatus: result.error?.status ?? null,
        lastProviderMessage: result.error?.text ?? null,
        hasGroqKey: !!keys.groq,
        hasNvidiaKey: !!keys.nvidia,
        groqKeyLength: keys.groq ? keys.groq.length : 0,
        nvidiaKeyLength: keys.nvidia ? keys.nvidia.length : 0,
      };
      console.error("chat provider failure:", JSON.stringify(debugInfo));
      res.status(result.res?.status || 502).json({ error: "خطأ من مزوّد النموذج", debug: debugInfo });
      return;
    }

    const data = await result.res.json();
    let reply = stripThinking((data.choices?.[0]?.message?.content ?? "").trim());

    // لو النموذج انقطع وهو "يفكر" ولم يوصل للإجابة الفعلية، التنظيف يرجع فاضي — نطلب إعادة المحاولة بدل رد فاضي
    if (!reply) {
      res.status(200).json({
        type: "text",
        reply: "معذرة، ما وصلني رد كامل. جرب ترسل رسالتك مرة ثانية 🌸",
        suggestions: [],
      });
      return;
    }

    if (reply.startsWith("IMAGE_REQUEST::")) {
      const limit = await checkImageLimit(deviceId);
      if (!limit.allowed) {
        res.status(200).json({
          type: "text",
          reply: "وصلت للحد المجاني (3 صور بالساعة) 🌸 جرب بعد شوي، أو تابعونا قريباً للاشتراك المدفوع اللي يرفع الحد لـ 50 صورة باليوم.",
          suggestions: [],
        });
        return;
      }
      const prompt = reply.slice("IMAGE_REQUEST::".length).trim();
      res.status(200).json({ type: "image", prompt: prompt || "a modern abstract geometric artwork in olive green and cream tones" });
      return;
    }

    let suggestions = [];
    const suggMatch = reply.match(/\n?SUGGESTIONS::(.+)$/);
    if (suggMatch) {
      suggestions = suggMatch[1]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
      reply = reply.slice(0, suggMatch.index).trim();
    }

    res.status(200).json({ type: "text", reply, suggestions });
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي في الخادم", details: String(err) });
  }
};
