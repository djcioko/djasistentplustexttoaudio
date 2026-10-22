const fs = require("fs");
const path = require("path");

const LIBRARY_PATH = path.join(__dirname, "library.json");

function readLibrary() {
  try {
    const data = fs.readFileSync(LIBRARY_PATH, "utf8");
    const library = JSON.parse(data);

    if (!Array.isArray(library)) {
      throw new Error("library.json trebuie să conțină o listă JSON.");
    }

    return library;
  } catch (error) {
    console.error("Eroare la citirea library.json:", error.message);
    return [];
  }
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function findDetectedTrack(result, library) {
  const detectedTitle = normalizeText(result.title);
  const detectedArtist = normalizeText(result.artist);

  return library.find((track) => {
    const titleMatches = normalizeText(track.title) === detectedTitle;
    const artistMatches = normalizeText(track.artist) === detectedArtist;

    return titleMatches && artistMatches;
  });
}

function parseCamelotKey(value) {
  const match = String(value || "")
    .trim()
    .toUpperCase()
    .match(/^(1[0-2]|[1-9])([AB])$/);

  if (!match) return null;

  return {
    number: Number(match[1]),
    letter: match[2]
  };
}

function camelotCompatible(keyA, keyB) {
  const a = parseCamelotKey(keyA);
  const b = parseCamelotKey(keyB);

  if (!a || !b) return false;

  // Aceeași cheie
  if (a.number === b.number && a.letter === b.letter) return true;

  // Cheia relativă: de exemplu 8A și 8B
  if (a.number === b.number && a.letter !== b.letter) return true;

  // Cheile vecine de pe roata Camelot: de exemplu 8A și 7A/9A
  const clockwise = (a.number % 12) + 1;
  const counterClockwise = ((a.number + 10) % 12) + 1;

  return (
    a.letter === b.letter &&
    (b.number === clockwise || b.number === counterClockwise)
  );
}

function getRecommendations(detectedTrack, library, limit = 5) {
  const detectedBpm = Number(detectedTrack.bpm);
  const detectedKey = detectedTrack.key;

  if (!Number.isFinite(detectedBpm) || !detectedKey) {
    return [];
  }

  return library
    .filter((track) => {
      // Nu recomandăm piesa care tocmai a fost recunoscută
      const sameTrack =
        normalizeText(track.title) === normalizeText(detectedTrack.title) &&
        normalizeText(track.artist) === normalizeText(detectedTrack.artist);

      if (sameTrack) return false;

      const bpm = Number(track.bpm);
      if (!Number.isFinite(bpm)) return false;

      // Diferența maximă: 10 BPM
      if (Math.abs(bpm - detectedBpm) > 10) return false;

      // Recomandăm doar dacă cheia este compatibilă Camelot
      return camelotCompatible(detectedKey, track.key);
    })
    .map((track) => {
      const bpmDifference = Math.abs(Number(track.bpm) - detectedBpm);

      return {
        ...track,
        bpmDifference,
        spotifyUrl:
          "https://open.spotify.com/search/" +
          encodeURIComponent(`${track.artist} ${track.title}`)
      };
    })
    .sort((a, b) => a.bpmDifference - b.bpmDifference)
    .slice(0, limit);
}
