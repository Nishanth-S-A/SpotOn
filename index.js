require("dotenv").config();

const { App } = require("@slack/bolt");
const axios = require("axios");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const MB = "https://musicbrainz.org/ws/2";
const MB_HEADERS = {
  "User-Agent": "SpotOn-SlackBot/1.0 (your@email.com)",
  Accept: "application/json",
};

// search for an artist, returns first match or null
async function mbFindArtist(name) {
  const res = await axios.get(`${MB}/artist`, {
    headers: MB_HEADERS,
    params: { query: name, limit: 1, fmt: "json" },
  });
  return res.data.artists?.[0] || null;
}

app.command("/spoton-ping", async ({ command, ack, respond }) => {
  const start = Date.now();
  await ack();
  const latency = Date.now() - start;
  await respond({ text: `Pong!\nLatency: ${latency}ms` });
});

app.command("/spoton-track", async ({ ack, respond }) => {
  await ack();
  try {
    const genres = [
      "pop",
      "rock",
      "jazz",
      "electronic",
      "hip-hop",
      "classical",
      "indie",
      "soul",
      "metal",
      "folk",
    ];
    const genre = genres[Math.floor(Math.random() * genres.length)];
    const offset = Math.floor(Math.random() * 80);

    const res = await axios.get(`${MB}/recording`, {
      headers: MB_HEADERS,
      params: {
        query: `tag:${genre}`,
        limit: 20,
        offset,
        fmt: "json",
      },
    });

    const recordings = res.data.recordings?.filter(
      (r) => r.title && r["artist-credit"]?.length,
    );
    if (!recordings?.length)
      return await respond({
        text: "⚠️ Couldn't find a track right now. Try again!",
      });

    const track = recordings[Math.floor(Math.random() * recordings.length)];
    const artist = track["artist-credit"]
      .map((a) => a.name || a.artist?.name)
      .join(", ");
    const release = track.releases?.[0]?.title || "Unknown Album";
    const year = track.releases?.[0]?.date?.slice(0, 4) || "Unknown Year";
    const mbid = track.id;

    await respond({
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🎵 SpotOn Track Pick",
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Track:*\n${track.title}` },
            { type: "mrkdwn", text: `*Artist:*\n${artist}` },
            { type: "mrkdwn", text: `*Album:*\n${release}` },
            { type: "mrkdwn", text: `*Year:*\n${year}` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔎 *MusicBrainz:* https://musicbrainz.org/recording/${mbid}`,
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Genre: _${genre}_` }],
        },
      ],
    });
  } catch (err) {
    console.error(err);
    await respond({
      text: "⚠️ Something went wrong fetching a track. Try again!",
    });
  }
});

app.command("/spoton-similar", async ({ command, ack, respond }) => {
  await ack();
  const artistName = command.text.trim();
  if (!artistName)
    return await respond({
      text: "⚠️ Usage: `/spoton-similar <artist>`\nExample: `/spoton-similar Radiohead`",
    });

  try {
    // step 1: find the artist + their tags
    const searchRes = await axios.get(`${MB}/artist`, {
      headers: MB_HEADERS,
      params: { query: artistName, limit: 1, fmt: "json" },
    });
    const artist = searchRes.data.artists?.[0];
    if (!artist)
      return await respond({
        text: `⚠️ Could not find artist *"${artistName}"*.\nTry another name.`,
      });

    // step 2: get full artist detail for tags
    const detailRes = await axios.get(`${MB}/artist/${artist.id}`, {
      headers: MB_HEADERS,
      params: { inc: "tags", fmt: "json" },
    });
    const tags = detailRes.data.tags
      ?.sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((t) => t.name);

    if (!tags?.length)
      return await respond({
        text: `⚠️ Not enough data to find similar artists for *${artist.name}*.`,
      });

    // step 3: search artists by those tags, exclude the original
    const tagQuery = tags.map((t) => `tag:${t}`).join(" AND ");
    const simRes = await axios.get(`${MB}/artist`, {
      headers: MB_HEADERS,
      params: { query: tagQuery, limit: 15, fmt: "json" },
    });

    const similar = simRes.data.artists
      ?.filter(
        (a) =>
          a.id !== artist.id &&
          a.name.toLowerCase() !== artistName.toLowerCase(),
      )
      .slice(0, 8);

    if (!similar?.length)
      return await respond({
        text: `⚠️ No similar artists found for *${artist.name}*.`,
      });

    const list = similar
      .map((a) => {
        const country = a.country ? ` · ${a.country}` : "";
        return `• *${a.name}*${country}`;
      })
      .join("\n");

    await respond({
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🎧 If you like ${artist.name}, try:`,
            emoji: true,
          },
        },
        { type: "section", text: { type: "mrkdwn", text: list } },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Based on shared tags: _${tags.join(", ")}_`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.error(err);
    await respond({ text: "⚠️ Something went wrong. Try again!" });
  }
});

app.command("/spoton-vs", async ({ command, ack, respond }) => {
  await ack();

  // parse "A vs B" or "A, B"
  let [name1, name2] = command.text.trim().split(/\s+vs\s+/i);
  if (!name2)
    [name1, name2] = command.text
      .trim()
      .split(",")
      .map((s) => s.trim());
  if (!name1 || !name2) {
    const words = command.text.trim().split(/\s+/);
    const mid = Math.floor(words.length / 2);
    name1 = words.slice(0, mid).join(" ");
    name2 = words.slice(mid).join(" ");
  }
  if (!name1 || !name2)
    return await respond({
      text: "⚠️ Usage: `/spoton-vs <artist1> vs <artist2>`\nExample: `/spoton-vs Oasis vs Blur`",
    });

  try {
    async function fetchArtistFull(name) {
      const searchRes = await axios.get(`${MB}/artist`, {
        headers: MB_HEADERS,
        params: { query: name, limit: 1, fmt: "json" },
      });
      const artist = searchRes.data.artists?.[0];
      if (!artist) return null;

      // get release count
      const releaseRes = await axios.get(`${MB}/release-group`, {
        headers: MB_HEADERS,
        params: {
          artist: artist.id,
          type: "album",
          limit: 1,
          fmt: "json",
        },
      });

      return {
        name: artist.name,
        id: artist.id,
        score: artist.score,
        country: artist.country || "Unknown",
        type: artist.type || "Unknown",
        began: artist["life-span"]?.begin?.slice(0, 4) || "?",
        ended: artist["life-span"]?.ended
          ? artist["life-span"]?.end?.slice(0, 4) || "?"
          : "active",
        albumCount: releaseRes.data["release-group-count"] || 0,
        tags:
          artist.tags
            ?.sort((a, b) => b.count - a.count)
            .slice(0, 2)
            .map((t) => t.name) || [],
      };
    }

    const a1 = await fetchArtistFull(name1);
    await sleep(300);
    const a2 = await fetchArtistFull(name2);
    if (!a1)
      return await respond({ text: `⚠️ Could not find artist *"${name1}"*.` });
    if (!a2)
      return await respond({ text: `⚠️ Could not find artist *"${name2}"*.` });

    // score: relevance score (50%) + album count (50%)
    const maxAlbums = Math.max(a1.albumCount, a2.albumCount) || 1;
    const s1 = (a1.score / 100) * 50 + (a1.albumCount / maxAlbums) * 50;
    const s2 = (a2.score / 100) * 50 + (a2.albumCount / maxAlbums) * 50;
    const winner = s1 > s2 ? a1.name : s2 > s1 ? a2.name : "It's a tie!";

    await respond({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🥊 Artist Battle", emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${a1.name}* vs *${a2.name}*` },
        },
        { type: "divider" },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Origin*\n${a1.name}: ${a1.country}\n${a2.name}: ${a2.country}`,
            },
            {
              type: "mrkdwn",
              text: `*Active Since*\n${a1.name}: ${a1.began}\n${a2.name}: ${a2.began}`,
            },
          ],
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Albums*\n${a1.name}: ${a1.albumCount}\n${a2.name}: ${a2.albumCount}`,
            },
            {
              type: "mrkdwn",
              text: `*Status*\n${a1.name}: ${a1.ended}\n${a2.name}: ${a2.ended}`,
            },
          ],
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: `🏆 *Winner: ${winner}*` },
        },
      ],
    });
  } catch (err) {
    console.error(err);
    await respond({ text: "⚠️ Something went wrong. Try again!" });
  }
});

app.command("/spoton-bandname", async ({ ack, respond }) => {
  await ack();

  const adjectives = [
    "Overcaffeinated",
    "Melancholic",
    "Neon",
    "Fuzzy",
    "Cosmic",
    "Cursed",
    "Astral",
    "Velvet",
    "Perpetually Late",
    "Haunted",
  ];
  const nouns = [
    "Ferrets",
    "Prophets",
    "Raccoons",
    "Theorists",
    "Ghosts",
    "Pigeons",
    "Architects",
    "Wanderers",
    "Mechanics",
    "Librarians",
  ];
  const prefixes = ["The", "Dr.", "Captain", "Professor", "DJ", ""];
  const albums = [
    "Songs From The Parking Garage",
    "Crying at the Self-Checkout",
    "404: Vibes Not Found",
    "The Snooze Button Sessions",
    "Feelings I Googled At 2AM",
    "We Don't Talk About Track 7",
    "Unplugged (But Emotionally Plugged In)",
    "Live From My Childhood Bedroom",
  ];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const prefix = pick(prefixes);
  const bandName = `${prefix ? prefix + " " : ""}${pick(adjectives)} ${pick(nouns)}`;
  const album = pick(albums);

  await respond({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🎸 Your Band Name", emoji: true },
      },
      { type: "section", text: { type: "mrkdwn", text: `*${bandName}*` } },
      {
        type: "section",
        text: { type: "mrkdwn", text: `🎵 Debut Album:\n_"${album}"_` },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "Run again for a new name!" }],
      },
    ],
  });
});

const triviaAnswers = new Map();

app.command("/spoton-trivia", async ({ command, ack, respond }) => {
  await ack();
  try {
    const res = await axios.get("https://opentdb.com/api.php", {
      params: { amount: 1, category: 12, type: "multiple" }, // 12 = Entertainment: Music
    });

    const q = res.data.results[0];
    const decode = (str) =>
      str
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

    const question = decode(q.question);
    const correct = decode(q.correct_answer);
    const allAnswers = [...q.incorrect_answers.map(decode), correct].sort(
      () => Math.random() - 0.5,
    );
    const labels = ["A", "B", "C", "D"];

    const key = `${command.user_id}-${command.channel_id}`;
    triviaAnswers.set(key, correct);

    await respond({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🎵 Music Trivia", emoji: true },
        },
        { type: "section", text: { type: "mrkdwn", text: `*${question}*` } },
        {
          type: "actions",
          block_id: "trivia_answer",
          elements: allAnswers.map((ans, i) => ({
            type: "button",
            text: {
              type: "plain_text",
              text: `${labels[i]}. ${ans}`,
              emoji: true,
            },
            value: JSON.stringify({ chosen: ans, userKey: key }),
            action_id: `trivia_choice_${i}`,
          })),
        },
      ],
    });
  } catch (err) {
    console.error(err);
    await respond({
      text: "⚠️ Couldn't load a trivia question right now. Try again!",
    });
  }
});

[
  "trivia_choice_0",
  "trivia_choice_1",
  "trivia_choice_2",
  "trivia_choice_3",
].forEach((actionId) => {
  app.action(actionId, async ({ body, ack, respond }) => {
    await ack();
    const { chosen, userKey } = JSON.parse(body.actions[0].value);
    const correct = triviaAnswers.get(userKey);
    const isCorrect = chosen === correct;
    triviaAnswers.delete(userKey);

    await respond({
      replace_original: true,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: isCorrect
              ? `✅ *Correct!*\n_${correct}_ was the right answer. Well done! 🎉`
              : `❌ *Incorrect.*\nYou chose _${chosen}_.\nThe correct answer was *${correct}*.`,
          },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: "Use `/spoton-trivia` to play again!" },
          ],
        },
      ],
    });
  });
});

app.command("/spoton-stats", async ({ command, ack, respond }) => {
  await ack();
  const artistName = command.text.trim();
  if (!artistName)
    return await respond({
      text: "⚠️ Usage: `/spoton-stats <artist>`\nExample: `/spoton-stats Daft Punk`",
    });

  try {
    // find artist
    const searchRes = await axios.get(`${MB}/artist`, {
      headers: MB_HEADERS,
      params: { query: artistName, limit: 1, fmt: "json" },
    });
    const artist = searchRes.data.artists?.[0];
    if (!artist)
      return await respond({
        text: `⚠️ Could not find artist *"${artistName}"*.\nTry another name.`,
      });

    const detailRes = await axios.get(`${MB}/artist/${artist.id}`, {
      headers: MB_HEADERS,
      params: { inc: "tags+url-rels", fmt: "json" },
    });
    await sleep(300);
    const albumRes = await axios.get(`${MB}/release-group`, {
      headers: MB_HEADERS,
      params: { artist: artist.id, type: "album", limit: 1, fmt: "json" },
    });
    await sleep(300);
    const topTrackRes = await axios.get(`${MB}/recording`, {
      headers: MB_HEADERS,
      params: { artist: artist.id, limit: 5, fmt: "json" },
    });

    const detail = detailRes.data;
    const tags =
      detail.tags
        ?.sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((t) => `• ${t.name}`)
        .join("\n") || "• Not listed";
    const albumCount = albumRes.data["release-group-count"] || "Unknown";
    const topTracks =
      topTrackRes.data.recordings
        ?.slice(0, 5)
        .map((r) => `• ${r.title}`)
        .join("\n") || "• Not available";
    const began = detail["life-span"]?.begin || "Unknown";
    const ended = detail["life-span"]?.ended
      ? detail["life-span"]?.end || "?"
      : "Present";
    const country = detail.country || "Unknown";
    const mbUrl = `https://musicbrainz.org/artist/${artist.id}`;

    await respond({
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📊 Artist Stats: ${detail.name}`,
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Type:*\n${detail.type || "Unknown"}` },
            { type: "mrkdwn", text: `*Country:*\n${country}` },
            { type: "mrkdwn", text: `*Active:*\n${began} – ${ended}` },
            { type: "mrkdwn", text: `*Studio Albums:*\n${albumCount}` },
          ],
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Genres / Tags:*\n${tags}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Recordings (sample):*\n${topTracks}`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `🔎 *MusicBrainz:* ${mbUrl}` },
        },
      ],
    });
  } catch (err) {
    console.error(err);
    await respond({
      text: "⚠️ Something went wrong fetching stats. Try again!",
    });
  }
});

app.command("/spoton-help", async ({ ack, respond }) => {
  await ack();
  await respond({
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🎵 SpotOn — Music Bot Commands",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Here's everything SpotOn can do:",
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🎲 `/spoton-track`*\nGet a random song recommendation from a surprise genre.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🎧 `/spoton-similar <artist>`*\nDiscover artists similar to one you love.\n_Example: `/spoton-similar Radiohead`_",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🥊 `/spoton-vs <artist1> vs <artist2>`*\nHead-to-head battle between two artists.\n_Example: `/spoton-vs Taylor Swift vs Drake`_",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🎸 `/spoton-bandname`*\nGenerate a hilarious random band name + debut album title.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🎵 `/spoton-trivia`*\nTest your music knowledge with an interactive trivia question.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*📊 `/spoton-stats <artist>`*\nSee Spotify stats for any artist — popularity, followers, genres, top tracks.\n_Example: `/spoton-stats Daft Punk`_",
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🏓 `/spoton-ping`*\nCheck if the bot is alive and measure latency.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Powered by Spotify & OpenTDB · Built with Slack Bolt",
          },
        ],
      },
    ],
  });
});

(async () => {
  await app.start();
  console.log("bot is running!");
})();
