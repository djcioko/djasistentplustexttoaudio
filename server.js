const express = require("express");
const multer = require("multer");
const path = require("path");
require("dotenv").config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 9 * 1024 * 1024 }
});

app.use(express.static(__dirname));

app.post("/recognize", upload.single("audio"), async (req, res) => {
  try {
    if (!process.env.AUDD_API_TOKEN) {
      return res.status(500).json({
        error: "Lipsește AUDD_API_TOKEN din fișierul .env."
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Nu a fost primit fragmentul audio." });
    }

    const form = new FormData();
    form.append("api_token", process.env.AUDD_API_TOKEN);
    form.append(
      "file",
      new Blob([req.file.buffer], {
        type: req.file.mimetype || "audio/webm"
      }),
      req.file.originalname || "clip.webm"
    );

    const response = await fetch("https://api.audd.io/", {
      method: "POST",
      body: form
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.error_message || "Eroare de la AudD."
      });
    }

    if (data.status !== "success") {
      return res.status(502).json({
        error: data.error?.error_message || "AudD nu a putut identifica fragmentul."
      });
    }

    res.json({ result: data.result || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Eroare la identificarea piesei." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`DJ Assistant rulează la http://localhost:${port}`);
});
