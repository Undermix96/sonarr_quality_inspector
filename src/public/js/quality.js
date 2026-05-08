'use strict';

// Quality rank table — higher = better.
// Names match Sonarr's quality.quality.name field.
const QUALITY_RANK = {
  'Unknown':       0,
  'SDTV':          10,
  'WEBDL-480p':    20,
  'WEBRip-480p':   20,
  'DVD':           25,
  'Bluray-480p':   27,
  'HDTV-720p':     30,
  'WEBDL-720p':    35,
  'WEBRip-720p':   35,
  'Bluray-720p':   40,
  'HDTV-1080p':    45,
  'WEBDL-1080p':   50,
  'WEBRip-1080p':  50,
  'Bluray-1080p':  55,
  'Remux-1080p':   60,
  'HDTV-2160p':    65,
  'WEBDL-2160p':   70,
  'WEBRip-2160p':  70,
  'Bluray-2160p':  75,
  'Remux-2160p':   80,
  'BR-DISK':       85,
};

const QUALITY_SHORT = {
  'Unknown':       '?',
  'SDTV':          'SD',
  'WEBDL-480p':    '480p',
  'WEBRip-480p':   '480p',
  'DVD':           'DVD',
  'Bluray-480p':   '480p',
  'HDTV-720p':     '720p',
  'WEBDL-720p':    '720p',
  'WEBRip-720p':   '720p',
  'Bluray-720p':   '720p',
  'HDTV-1080p':    '1080p',
  'WEBDL-1080p':   '1080p',
  'WEBRip-1080p':  '1080p',
  'Bluray-1080p':  '1080p',
  'Remux-1080p':   '1080p',
  'HDTV-2160p':    '2160p',
  'WEBDL-2160p':   '2160p',
  'WEBRip-2160p':  '2160p',
  'Bluray-2160p':  '2160p',
  'Remux-2160p':   '2160p',
  'BR-DISK':       'DISK',
};

function rankOf(name) {
  if (!name) return -1;
  if (QUALITY_RANK[name] !== undefined) return QUALITY_RANK[name];
  // Fuzzy fallback: partial match
  for (const [k, v] of Object.entries(QUALITY_RANK)) {
    if (name.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return 0;
}

function shortOf(name) {
  if (!name) return '—';
  if (QUALITY_SHORT[name]) return QUALITY_SHORT[name];
  // Try to extract resolution from name
  const m = name.match(/(\d{3,4}p)/i);
  if (m) return m[1].toLowerCase();
  return name.length > 8 ? name.slice(0, 7) + '…' : name;
}

// Given an array of episodes with .quality (string|null) and .hasFile (bool),
// returns the dominant quality name (most frequent among files present).
function dominantQuality(episodes) {
  const counts = {};
  for (const ep of episodes) {
    if (!ep.hasFile || !ep.quality) continue;
    counts[ep.quality] = (counts[ep.quality] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// Analyse seasons for a series. Returns array of season objects.
function analyseSeasons(episodesBySeasonMap, fileMap) {
  const result = [];

  for (const [seasonNum, episodes] of Object.entries(episodesBySeasonMap)) {
    const sn = parseInt(seasonNum, 10);
    if (sn === 0) continue; // skip specials

    // Attach quality from file map
    const enriched = episodes.map(ep => ({
      ...ep,
      quality: ep.hasFile ? (fileMap[ep.episodeFileId] || 'Unknown') : null,
    }));

    const withFile = enriched.filter(e => e.hasFile);
    if (withFile.length === 0) continue;

    const dominant = dominantQuality(enriched);
    const domRank = rankOf(dominant);

    const problems = withFile.filter(e => rankOf(e.quality) < domRank);

    result.push({
      seasonNumber: sn,
      episodes: enriched.sort((a, b) => a.episodeNumber - b.episodeNumber),
      dominant,
      domRank,
      problems,
    });
  }

  return result.sort((a, b) => a.seasonNumber - b.seasonNumber);
}
