const OWNER = "vumc-media";
const REPO = "weekly-feed";
const BRANCH = "main";
const FILE_PATH = "schedule.json";

function parseSchedule(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const dayRegex = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i;
  const timeRegex = /^(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)?)\s+(.+)$/i;

  const days = [];
  let current = null;

  for (const line of lines) {
    if (dayRegex.test(line)) {
      current = {
        title: line.replace(/\s+/g, " "),
        events: []
      };
      days.push(current);
      continue;
    }

    if (!current) continue;

    const match = line.match(timeRegex);

    if (match) {
      current.events.push({
        time: normalizeTime(match[1]),
        event: match[2].trim()
      });
    } else {
      current.events.push({
        time: "",
        event: line
      });
    }
  }

  return days;
}

function normalizeTime(value) {
  return value
    .replace(/\s+/g, "")
    .replace(/AM/gi, "a")
    .replace(/PM/gi, "p")
    .replace(/am/gi, "a")
    .replace(/pm/gi, "p");
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed." })
    };
  }

  try {
    const { token, rawSchedule } = JSON.parse(event.body || "{}");

    if (!process.env.ADMIN_TOKEN) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "ADMIN_TOKEN is not set in Netlify." })
      };
    }

    if (token !== process.env.ADMIN_TOKEN) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid admin token." })
      };
    }

    if (!process.env.GITHUB_TOKEN) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "GITHUB_TOKEN is not set in Netlify." })
      };
    }

    if (!rawSchedule || !rawSchedule.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Schedule is empty." })
      };
    }

    const scheduleData = {
      updatedAt: new Date().toISOString(),
      raw: rawSchedule,
      days: parseSchedule(rawSchedule)
    };

    const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

    let sha = null;

    const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "vumc-weekly-feed-admin"
      }
    });

    if (getRes.ok) {
      const file = await getRes.json();
      sha = file.sha;
    }

    const putBody = {
      message: "Update weekly schedule",
      content: Buffer.from(JSON.stringify(scheduleData, null, 2)).toString("base64"),
      branch: BRANCH
    };

    if (sha) putBody.sha = sha;

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "vumc-weekly-feed-admin"
      },
      body: JSON.stringify(putBody)
    });

    const result = await putRes.json();

    if (!putRes.ok) {
      return {
        statusCode: putRes.status,
        body: JSON.stringify({
          error: result.message || "GitHub update failed."
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        days: scheduleData.days.length,
        commit: result.commit && result.commit.sha
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
