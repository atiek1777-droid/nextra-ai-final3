// api/transcribe.js
// يستقبل صوت مسجّل من المتصفح (Base64) ويحوّله لنص عبر Whisper المجاني من Groq.
// المفتاح يبقى هنا فقط ولا يصل أبداً لمتصفح المستخدم.

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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY غير مضبوط بإعدادات Vercel." });
    return;
  }

  try {
    const { audio, mimeType } = req.body || {};
    if (!audio) {
      res.status(400).json({ error: "لا يوجد تسجيل صوتي" });
      return;
    }

    const audioBuffer = Buffer.from(audio, "base64");
    if (audioBuffer.length < 500) {
      res.status(400).json({ error: "التسجيل قصير جداً، حاول مرة ثانية" });
      return;
    }

    const ext = (mimeType || "").includes("mp4") ? "audio.mp4" : "audio.webm";
    const blob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });

    const form = new FormData();
    form.append("file", blob, ext);
    form.append("model", "whisper-large-v3");
    form.append("response_format", "json");

    const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => "");
      res.status(groqRes.status).json({ error: "تعذّر تحويل الصوت لنص", details: errText });
      return;
    }

    const data = await groqRes.json();
    res.status(200).json({ text: (data.text || "").trim() });
  } catch (err) {
    res.status(500).json({ error: "خطأ داخلي بالخادم", details: String(err) });
  }
};
