import { writeFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';

const RECESS_URL = 'https://swet-studio.recess.tv/embed/checkout/explore?displayClassIrl=list&hideMenu=true&class_type=IRL&displayDays=14';

const response = await fetch(RECESS_URL, {
  headers: { 'user-agent': 'SWET schedule sync/1.0' }
});

if (!response.ok) {
  throw new Error(`Recess returned ${response.status}`);
}

const $ = cheerio.load(await response.text());
const schedule = {};

function titleCase(value) {
  return value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

$('.embed-checkout-list-day-header').each((_, header) => {
  const fullDate = $(header).find('.full-date').text().trim();
  if (!fullDate) return;

  const parsedDate = new Date(`${fullDate} 12:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return;

  const date = [
    parsedDate.getFullYear(),
    String(parsedDate.getMonth() + 1).padStart(2, '0'),
    String(parsedDate.getDate()).padStart(2, '0')
  ].join('-');

  const classes = [];
  let row = $(header).next();

  while (row.length && !row.hasClass('embed-checkout-list-day-header')) {
    if (row.hasClass('item-row')) {
      const rawName = row.find('.name').first().text().trim();
      const rawTime = row.find('.datetime').first().text().trim();
      const instructor = row.find('.instructor').first().text().replace(/\s+/g, ' ').trim();

      if (rawName && rawTime) {
        const segments = rawName.split('|').map(value => value.trim()).filter(Boolean);
        const firstSegment = segments[0].replace(/^aerial\s+/i, '').trim();
        const levelSegment = segments.find(value => /^(all levels?|beginner|inter(?:mediate)?|advanced|private)$/i.test(value));
        const lowerName = firstSegment.toLowerCase();
        const isPrivate = /private/i.test(rawName);

        let level = 'All Level';
        if (isPrivate) level = 'Private';
        else if (/advanced/i.test(levelSegment || '')) level = 'Advanced';
        else if (/inter/i.test(levelSegment || '')) level = 'Intermediate';

        classes.push({
          time: rawTime.replace(/(am|pm)$/i, ' $1').toUpperCase(),
          name: titleCase(firstSegment),
          instructor,
          level,
          signature: /dance|fly|conditioning/i.test(lowerName)
        });
      }
    }
    row = row.next();
  }

  schedule[date] = classes;
});

// Recess renders a seven-day window but omits headings for days without classes.
// Store those dates explicitly so the editor doesn't mistake a closed day for
// missing data and load an outdated preset.
const firstDate = Object.keys(schedule).sort()[0];
if (firstDate) {
  const cursor = new Date(`${firstDate}T12:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = cursor.toISOString().slice(0, 10);
    if (!Object.prototype.hasOwnProperty.call(schedule, date)) schedule[date] = [];
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

if (!Object.keys(schedule).length) {
  throw new Error('No dated Recess classes were found; refusing to overwrite schedule-data.json');
}

const output = {
  generatedAt: new Date().toISOString(),
  source: RECESS_URL,
  timezone: 'America/New_York',
  schedule
};

await writeFile('schedule-data.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(`Synced ${Object.values(schedule).reduce((sum, day) => sum + day.length, 0)} classes across ${Object.keys(schedule).length} days.`);
