const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const PORT = process.env.PORT || 3000;
const libraryPath = path.join(__dirname, "library.json");

app.use(express.static(path.join(__dirname, "public")));

function readLibrary() {
  try {
    return JSON.parse(fs.readFileSync(libraryPath, "utf8"));
  } catch {
    return [];
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function sameTrack(a, b) {
  return normalize(a.title) === normalize(b.title) &&
         normalize(a.artist) === normalize(b.artist);
}

function camelotDistance(a, b) {
  const parse = value => {
    const match = String(value || "").toUpperCase().match(/^([1-9]|1[0-2])([AB])$/);
    return match ? { number: Number(match[1]), mode: match[2] } : null;
  };

  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;

  const wheelDistance = Math.min(
    Math.abs(x.number - y.number),
    12 - Math.abs(x.number - y.number)
  );

  if (x.mode === y.mode && wheelDistance === 0) return 3; // perfect
  if (x.mode === y.mode && wheelDistance === 1) return 2; // compatibil
  if (x.mode !== y.mode && wheelDistance === 0) return 2; // relativ major/minor
  return 1; // mai puțin compatibil
}

function recommendTracks(current, library) {
  if (!Number.isFinite(Number(current.bpm)) || !current.key) return [];

  return library
    .filter(track => !sameTrack(track, current))
    .map(track => {
      const bpmDifference = Math.abs(Number(track.bpm) - Number(current.bpm));
      const keyScore = camelotDistance(current.key, track.key);

      if (!Number.isFinite(bpmDifference) || bpmDifference > 10 || keyScore === null) {
        return null;
      }

      // Scor mai bun pentru diferență mică de BPM și compatibilitate Camelot ridicată.
      const score = keyScore * 10 - bpmDifference;
      return { ...track, bpmDifference, keyScore, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

app.post("/api/recognize", upload.single("audio"), async (req, res) => {
  try {
    if (!process.env.AUDD_API_TOKEN) {
      return res.status(500).json({ error: "Lipsește AUDD_API_TOKEN pe server." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Nu a fost primit niciun fișier audio." });
    }

    const form = new FormData();
    form.append("api_token", process.env.AUDD_API_TOKEN);
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "audio/webm" }),
      req.file.originalname || "capture.webm"
    );
    form.append("return", "spotify");

    const auddResponse = await fetch("https://api.audd.io/", {
      method: "POST",
      body: form
    });

    const auddData = await auddResponse.json();

    if (!auddResponse.ok || auddData.status !== "success" || !auddData.result) {
      return res.status(422).json({
        error: auddData.error?.error_message || "Nu am identificat piesa.",
        details: auddData
      });
    }

    const result = auddData.result;
    const library = readLibrary();

    // AudD identifică titlul și artistul, dar BPM/key trebuie să existe în biblioteca locală.
    const localTrack = library.find(track =>
      sameTrack(track, { title: result.title, artist: result.artist })
    );

    const currentTrack = {
      title: result.title,
      artist: result.artist,
      album: result.album || "",
      bpm: localTrack?.bpm ?? null,
      key: localTrack?.key ?? null,
      spotifyUrl:
        result.spotify?.external_urls?.spotify ||
        `https://open.spotify.com/search/${encodeURIComponent(
          `${result.artist} ${result.title}`
        )}`
    };

    res.json({
      track: currentTrack,
      recommendations: localTrack ? recommendTracks(localTrack, library) : [],
      message: localTrack
        ? ""
        : "Piesa a fost identificată, dar nu apare în library.json cu BPM și key. Adaug-o acolo pentru recomandări."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Eroare la identificarea audio." });
  }
});

// Endpoint demonstrativ pentru audio TTS descărcabil.
// Verifică dacă vocea aleasă și endpointul sunt disponibile înainte de deploy.
app.get("/api/tts", async (req, res) => {
  try {
    const text = String(req.query.text || "").trim();

    if (!text || text.length > 500) {
      return res.status(400).send("Text invalid sau prea lung.");
    }

    const ttsUrl =
      "https://api.streamelements.com/kappa/v2/speech" +
      `?voice=${encodeURIComponent(process.env.TTS_VOICE || "Alina")}` +
      `&text=${encodeURIComponent(text)}`;

    const response = await fetch(ttsUrl);

    if (!response.ok) {
      return res.status(502).send("Serviciul TTS nu a generat audio.");
    }

    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Content-Disposition", 'attachment; filename="anunt-audio"');
    res.send(audio);
  } catch (error) {
    console.error(error);
    res.status(500).send("Eroare la generarea anunțului.");
  }
});

app.listen(PORT, () => {
  console.log(`Server pornit pe portul ${PORT}`);
});
