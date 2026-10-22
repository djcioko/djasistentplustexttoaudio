const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

function readLibrary() {
  try {
    const filePath = path.join(__dirname, "library.json");
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error("Nu am putut citi library.json:", error.message);
    return [];
  }
}

function normalizeKey(key) {
  return String(key || "").trim().toUpperCase();
}

function isValidCamelotKey(key) {
  return /^[1-9]|1[0-2][AB]$/.test(normalizeKey(key));
}

function camelotCompatibility(key1, key2) {
  const a = normalizeKey(key1);
  const b = normalizeKey(key2);

  if (!isValidCamelotKey(a) || !isValidCamelotKey(b)) {
    return { points: 0, label: "cheie necunoscută" };
  }

  const numberA = parseInt(a, 10);
  const numberB = parseInt(b, 10);
  const letterA = a.slice(-1);
  const letterB = b.slice(-1);

  if (a === b) {
    return { points: 40, label: "perfect" };
  }

  if (numberA === numberB && letterA !== letterB) {
    return { points: 30, label: "compatibilă" };
  }

  const clockwise = (numberA % 12) + 1;
  const counterClockwise = ((numberA + 10) % 12) + 1;

  if (
    letterA === letterB &&
    (numberB === clockwise || numberB === counterClockwise)
  ) {
    return { points: 25, label: "compatibilă" };
  }

  return { points: 0, label: "mai puțin compatibilă" };
}

function recommendTracks(currentTrack) {
  const library = readLibrary();

  const currentBpm = Number(currentTrack.bpm);
  const currentKey = normalizeKey(currentTrack.key);

  return library
    .filter((track) => {
      const sameTrack =
        String(track.title).toLowerCase() ===
          String(currentTrack.title).toLowerCase() &&
        String(track.artist).toLowerCase() ===
          String(currentTrack.artist).toLowerCase();

      return !sameTrack && Number.isFinite(Number(track.bpm));
    })
    .map((track) => {
      const bpmDifference = Math.abs(Number(track.bpm) - currentBpm);
      const keyMatch = camelotCompatibility(currentKey, track.key);

      // BPM-ul poate diferi cu maximum 10.
      if (bpmDifference > 10) {
        return null;
      }

      const bpmPoints = Math.max(0, 30 - bpmDifference * 3);
      const score = bpmPoints + keyMatch.points;

      return {
        title: track.title,
        artist: track.artist,
        bpm: track.bpm,
        key: track.key,
        bpmDifference,
        keyCompatibility: keyMatch.label,
        score
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

app.post("/api/recognize", upload.single("audio"), async (req, res) => {
  try {
    if (!process.env.AUDD_API_TOKEN) {
      return res.status(500).json({
        error: "Lipsește variabila AUDD_API_TOKEN din Render."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Nu a fost primit niciun fișier audio."
      });
    }

    const form = new FormData();
    form.append("api_token", process.env.AUDD_API_TOKEN);
    form.append(
      "file",
      new Blob([req.file.buffer], {
        type: req.file.mimetype || "audio/webm"
      }),
      req.file.originalname || "capture.webm"
    );

    const auddResponse = await fetch("https://api.audd.io/", {
      method: "POST",
      body: form
    });

    const auddData = await auddResponse.json();

    if (!auddResponse.ok) {
      return res.status(502).json({
        error: "AudD nu a răspuns corect.",
        details: auddData
      });
    }

    if (!auddData.result) {
      return res.json({
        song: null,
        message: "Nu am recunoscut piesa. Încearcă din nou cu sunetul mai clar."
      });
    }

    const result = auddData.result;

    // AudD identifică piesa, dar BPM-ul și cheia pentru recomandări
    // trebuie completate în library.json.
    const library = readLibrary();
    const localTrack = library.find((track) =>
      String(track.title).toLowerCase() ===
        String(result.title || "").toLowerCase() &&
      String(track.artist).toLowerCase() ===
        String(result.artist || "").toLowerCase()
    );

    const song = {
      title: result.title || "Titlu necunoscut",
      artist: result.artist || "Artist necunoscut",
      album: result.album || "",
      bpm: localTrack ? Number(localTrack.bpm) : null,
      key: localTrack ? normalizeKey(localTrack.key) : null
    };

    const recommendations =
      song.bpm && song.key ? recommendTracks(song) : [];

    res.json({
      song,
      recommendations,
      message:
        song.bpm && song.key
          ? ""
          : "Piesa a fost identificată, dar adaug-o în library.json cu BPM și cheia Camelot ca să primești recomandări."
    });
  } catch (error) {
    console.error("Eroare la recunoaștere:", error);
    res.status(500).json({
      error: "A apărut o eroare la recunoașterea piesei.",
      details: error.message
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server pornit pe portul ${PORT}`);
});
