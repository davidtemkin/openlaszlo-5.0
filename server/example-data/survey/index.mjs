// vacation-survey: in-memory vote tally (seeded like the original survey.jsp)
const votes = { Hawaii: 30, Paris: 28, Jamaica: 32 };
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function surveyResponse(vote) {
  let status = "ok";
  if (vote == null) status = "Vacation option was null";
  else {
    const key = { hawaii: "Hawaii", paris: "Paris", jamaica: "Jamaica" }[vote.toLowerCase()];
    if (key) votes[key]++; else status = "Bad vacation choice: " + vote;
  }
  const total = votes.Hawaii + votes.Paris + votes.Jamaica;
  return `<response status="${status}">
    <vote>${vote == null ? "" : esc(vote)}</vote>
    <summary total="${total}">
        <option name="Hawaii">${votes.Hawaii}</option>
        <option name="Paris">${votes.Paris}</option>
        <option name="Jamaica">${votes.Jamaica}</option>
    </summary>
</response>`;
}

export async function handle(req, res, sub, q, body) {
  res.writeHead(200, { "Content-Type": "text/xml;charset=utf-8" });
  res.end('<?xml version="1.0" encoding="UTF-8"?>\n' + surveyResponse((body || q).get("vote")));
  return true;
}
