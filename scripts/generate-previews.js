'use strict';

const sharp = require('../node_modules/sharp');
const path  = require('path');
const fs    = require('fs');

const OUT = path.join(__dirname, '..', 'widgets', 'prayer_times');

const darkSvg = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#1a1a2e"/>
  <circle cx="200" cy="200" r="280" fill="#2a2a4a" opacity="0.5"/>
  <circle cx="820" cy="820" r="240" fill="#1e2d1e" opacity="0.4"/>
  <rect x="80" y="337" width="864" height="350" rx="20" fill="#0d1b2a"/>
  <rect x="80" y="337" width="378" height="350" rx="20" fill="rgba(255,255,255,0.03)"/>
  <rect x="458" y="337" width="1" height="350" fill="rgba(255,255,255,0.07)"/>
  <text x="120" y="377" font-family="system-ui,Arial,sans-serif" font-size="13" fill="rgba(255,255,255,0.45)" letter-spacing="0.8">DUBAI, UAE</text>
  <text x="100" y="430" font-family="system-ui,Arial,sans-serif" font-size="12" fill="#3eb68a" font-weight="600" letter-spacing="1">NEXT PRAYER</text>
  <text x="100" y="492" font-family="system-ui,Arial,sans-serif" font-size="54" fill="#ffffff" font-weight="700">Asr</text>
  <text x="100" y="532" font-family="system-ui,Arial,sans-serif" font-size="30" fill="#3eb68a" font-weight="600">15:48</text>
  <text x="100" y="560" font-family="system-ui,Arial,sans-serif" font-size="15" fill="rgba(255,255,255,0.4)">in 2h 18m</text>
  <text x="100" y="652" font-family="system-ui,Arial,sans-serif" font-size="13" fill="rgba(255,255,255,0.3)">21 Dhul Hijjah 1447</text>
  <g opacity="0.35">
    <circle cx="490" cy="366" r="4" fill="#3eb68a"/>
    <text x="506" y="371" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.8)">Fajr</text>
    <text x="905" y="371" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.5)" text-anchor="end">04:05</text>
  </g>
  <g opacity="0.35">
    <circle cx="490" cy="413" r="4" fill="#3eb68a"/>
    <text x="506" y="418" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.8)">Sunrise</text>
    <text x="905" y="418" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.5)" text-anchor="end">05:32</text>
  </g>
  <g opacity="0.35">
    <circle cx="490" cy="460" r="4" fill="#3eb68a"/>
    <text x="506" y="465" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.8)">Dhuhr</text>
    <text x="905" y="465" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.5)" text-anchor="end">12:27</text>
  </g>
  <rect x="472" y="468" width="465" height="36" rx="8" fill="rgba(62,182,138,0.13)"/>
  <circle cx="490" cy="488" r="5" fill="#3eb68a"/>
  <text x="506" y="493" font-family="system-ui,Arial,sans-serif" font-size="16" fill="#3eb68a" font-weight="700">Asr</text>
  <text x="905" y="493" font-family="system-ui,Arial,sans-serif" font-size="16" fill="#3eb68a" font-weight="700" text-anchor="end">15:48</text>
  <circle cx="490" cy="535" r="4" fill="rgba(255,255,255,0.2)"/>
  <text x="506" y="540" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.8)">Maghrib</text>
  <text x="905" y="540" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.5)" text-anchor="end">19:17</text>
  <circle cx="490" cy="582" r="4" fill="rgba(255,255,255,0.2)"/>
  <text x="506" y="587" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.8)">Isha</text>
  <text x="905" y="587" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.5)" text-anchor="end">20:44</text>
  <text x="512" y="740" font-family="system-ui,Arial,sans-serif" font-size="15" fill="rgba(255,255,255,0.15)" text-anchor="middle" letter-spacing="3">PRAYERS ALERT</text>
</svg>`;

const lightSvg = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#f0f2f5"/>
  <circle cx="200" cy="200" r="280" fill="#e4e8f0" opacity="0.7"/>
  <circle cx="820" cy="820" r="240" fill="#e4ede4" opacity="0.6"/>
  <!-- Widget card — white -->
  <rect x="80" y="337" width="864" height="350" rx="20" fill="#ffffff"/>
  <!-- Left panel subtle tint -->
  <rect x="80" y="337" width="378" height="350" rx="20" fill="rgba(0,0,0,0.025)"/>
  <!-- Divider -->
  <rect x="458" y="337" width="1" height="350" fill="rgba(0,0,0,0.08)"/>
  <!-- Location -->
  <text x="120" y="377" font-family="system-ui,Arial,sans-serif" font-size="13" fill="rgba(0,0,0,0.4)" letter-spacing="0.8">DUBAI, UAE</text>
  <!-- Next prayer label -->
  <text x="100" y="430" font-family="system-ui,Arial,sans-serif" font-size="12" fill="#3eb68a" font-weight="600" letter-spacing="1">NEXT PRAYER</text>
  <!-- Prayer name -->
  <text x="100" y="492" font-family="system-ui,Arial,sans-serif" font-size="54" fill="#0d1b2a" font-weight="700">Asr</text>
  <!-- Prayer time -->
  <text x="100" y="532" font-family="system-ui,Arial,sans-serif" font-size="30" fill="#3eb68a" font-weight="600">15:48</text>
  <!-- Countdown -->
  <text x="100" y="560" font-family="system-ui,Arial,sans-serif" font-size="15" fill="rgba(0,0,0,0.35)">in 2h 18m</text>
  <!-- Hijri date -->
  <text x="100" y="652" font-family="system-ui,Arial,sans-serif" font-size="13" fill="rgba(0,0,0,0.28)">21 Dhul Hijjah 1447</text>
  <!-- Fajr (passed) -->
  <g opacity="0.38">
    <circle cx="490" cy="366" r="4" fill="#3eb68a"/>
    <text x="506" y="371" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.7)">Fajr</text>
    <text x="905" y="371" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.45)" text-anchor="end">04:05</text>
  </g>
  <!-- Sunrise (passed) -->
  <g opacity="0.38">
    <circle cx="490" cy="413" r="4" fill="#3eb68a"/>
    <text x="506" y="418" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.7)">Sunrise</text>
    <text x="905" y="418" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.45)" text-anchor="end">05:32</text>
  </g>
  <!-- Dhuhr (passed) -->
  <g opacity="0.38">
    <circle cx="490" cy="460" r="4" fill="#3eb68a"/>
    <text x="506" y="465" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.7)">Dhuhr</text>
    <text x="905" y="465" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.45)" text-anchor="end">12:27</text>
  </g>
  <!-- Asr (next) highlight -->
  <rect x="472" y="468" width="465" height="36" rx="8" fill="rgba(62,182,138,0.12)"/>
  <circle cx="490" cy="488" r="5" fill="#3eb68a"/>
  <text x="506" y="493" font-family="system-ui,Arial,sans-serif" font-size="16" fill="#3eb68a" font-weight="700">Asr</text>
  <text x="905" y="493" font-family="system-ui,Arial,sans-serif" font-size="16" fill="#3eb68a" font-weight="700" text-anchor="end">15:48</text>
  <!-- Maghrib -->
  <circle cx="490" cy="535" r="4" fill="rgba(0,0,0,0.18)"/>
  <text x="506" y="540" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.7)">Maghrib</text>
  <text x="905" y="540" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.45)" text-anchor="end">19:17</text>
  <!-- Isha -->
  <circle cx="490" cy="582" r="4" fill="rgba(0,0,0,0.18)"/>
  <text x="506" y="587" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.7)">Isha</text>
  <text x="905" y="587" font-family="system-ui,Arial,sans-serif" font-size="16" fill="rgba(0,0,0,0.45)" text-anchor="end">20:44</text>
  <text x="512" y="740" font-family="system-ui,Arial,sans-serif" font-size="15" fill="rgba(0,0,0,0.12)" text-anchor="middle" letter-spacing="3">PRAYERS ALERT</text>
</svg>`;

async function generate() {
  fs.mkdirSync(OUT, { recursive: true });

  await sharp(Buffer.from(darkSvg))
    .png()
    .toFile(path.join(OUT, 'preview-dark.png'));
  console.log('✓ preview-dark.png');

  await sharp(Buffer.from(lightSvg))
    .png()
    .toFile(path.join(OUT, 'preview-light.png'));
  console.log('✓ preview-light.png');
}

generate().catch(e => { console.error(e); process.exit(1); });
