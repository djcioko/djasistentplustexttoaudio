const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname, "public")));

function readLibrary() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "library.json"), "utf8")
    );
  } catch {
    return [];
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function camelotScore(first, second) {
  const parse = value => {
    const match = String(value || "").toUpperCase().match(/^([1-9]|1[0-2])([AB])$/);
    return match ? { number: Number(match[1]), mode: match[2] } : null;
  };

  const a = parse(first);
  const b = parse(second);
  if (!a || !b) return 0;

  const distance = Math.min(
    Math.abs(a.number - b.number),
    12 - Math.abs(a.number - b.number)
  );

  if (a.mode === b.mode && distance === 0) return 3;
  if (a.mode === b.mode && distance === 1) return 2;
  if (a.mode !== b.mode && distance === 0) return 2;
  return 1;
}

app.post("/api/recognize", upload.single("audio"), async (req, res) => {
  try {
    if (!process.env.AUDD_API_TOKEN) {
      return res.status(500).json({ error: "Lipsește AUDD_API_TOKEN." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Nu a fost primit audio." });
    }

    const form = new FormData();
    form.append("api_token", process.env.AUDD_API_TOKEN);
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "audio/webm" }),
      "capture.webm"
    );

    const response = await fetch("https://api.audd.io/", {
      method: "POST",
      body: form
    });

    const audd = await response.json();
    if (!response.ok || audd.status !== "success" || !audd.result) {
      return res.status(422).json({ error: "AudD nu a identificat piesa." });
    }

    const result = audd.result;
    const library = readLibrary();

    const localTrack = library.find(track =>
      normalize(track.title) === normalize(result.title) &&
      normalize(track.artist) === normalize(result.artist)
    );

    let recommendations = [];

    if (localTrack) {
      recommendations = library
        .filter(track => track !== localTrack)
        .map(track => {
          const bpmDifference = Math.abs(Number(track.bpm) - Number(localTrack.bpm));
          const keyMatch = camelotScore(track.key, localTrack.key);
          return { ...track, bpmDifference, keyMatch };
        })
        .filter(track =>
          Number.isFinite(track.bpmDifference) &&
          track.bpmDifference <= 10 &&
          track.keyMatch > 0
        )
        .sort((a, b) =>
          (b.keyMatch * 10 - b.bpmDifference) -
          (a.keyMatch * 10 - a.bpmDifference)
        )
        .slice(0, 5);
    }

    res.json({
      track: {
        title: result.title,
        artist: result.artist,
        album: result.album || "",
        bpm: localTrack?.bpm || null,
        key: localTrack?.key || null
      },
      recommendations,
      message: localTrack
        ? ""
        : "Piesa a fost identificată. Adaug-o în library.json cu BPM și Camelot key pentru recomandări."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Eroare la identificarea audio." });
  }
});

// TTS demonstrativ: fișierul descărcat este audio-ul returnat de serviciu.
// Extensia se stabilește după Content-Type, nu se presupune că este MP3.
app.get("/api/tts", async (req, res) => {
  try {
    const text = String(req.query.text || "").trim();
    if (!text || text.length > 500) {
      return res.status(400).send("Text invalid.");
    }

    const voice = process.env.TTS_VOICE || "Alina";
    const url =
      "https://api.streamelements.com/kappa/v2/speech" +
      `?voice=${encodeURIComponent(voice)}` +
      `&text=${encodeURIComponent(text)}`;

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).send("Serviciul TTS nu a generat audio.");
    }

    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const extension = contentType.includes("mpeg") ? "mp3" : "audio";
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="anunt.${extension}"`
    );
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.status(500).send("Eroare la generarea anunțului.");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server pornit pe portul ${port}`));
