// Vercel Serverless Function — /api/gemini
// 브라우저가 이 함수를 호출하면, 함수가 서버에서 Gemini를 대신 호출합니다.
// API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 저장되며 브라우저로 전달되지 않습니다.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({ error: "Server missing GEMINI_API_KEY" });
    return;
  }

  try {
    // 요청 본문 파싱 (Vercel은 보통 자동 파싱하지만, 문자열로 올 때도 대비)
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const prompt = (body && body.prompt) ? String(body.prompt) : "";
    const temperature = (body && typeof body.temperature === "number") ? body.temperature : 0.3;
    const model = (body && body.model) ? String(body.model) : "gemini-2.5-flash";
    const jsonMode = !!(body && body.jsonMode);

    if (!prompt) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const genConfig = { temperature: temperature };
    if (jsonMode) genConfig.responseMimeType = "application/json";

    // 503(과부하) 등 일시적 오류에 대비: 재시도 + 모델 폴백
    const models = [model, "gemini-2.0-flash", "gemini-flash-latest"];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    let lastStatus = 0, lastDetail = "", data = null, ok = false;

    outer:
    for (let mi = 0; mi < models.length; mi++) {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/"
        + models[mi] + ":generateContent";
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: genConfig
          })
        });

        if (r.ok) { data = await r.json(); ok = true; break outer; }

        lastStatus = r.status;
        try { const e = await r.json(); lastDetail = (e && e.error && e.error.message) ? e.error.message : ""; }
        catch (e) { lastDetail = ""; }

        // 503/429/500 은 잠깐 기다렸다 재시도, 그 외는 즉시 다음 모델로
        if (r.status === 503 || r.status === 429 || r.status === 500) {
          await sleep(600 * (attempt + 1));
          continue;
        } else {
          break; // 다음 모델 시도
        }
      }
    }

    if (!ok) {
      res.status(lastStatus || 503).json({ error: lastDetail || ("Gemini error " + (lastStatus || "unknown")) });
      return;
    }

    let text = "";
    try {
      text = (data.candidates[0].content.parts || []).map(p => p.text || "").join("");
    } catch (e) { text = ""; }

    res.status(200).json({ text: text });
  } catch (e) {
    res.status(500).json({ error: "Server error: " + (e && e.message ? e.message : "unknown") });
  }
}
