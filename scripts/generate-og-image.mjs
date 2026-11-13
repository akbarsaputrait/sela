import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const icon = await readFile(new URL("../public/favicon.png", import.meta.url))
const iconUrl = `data:image/png;base64,${icon.toString("base64")}`

// Match the landing page's warm monochrome identity. The notch shadow denotes
// actual product elevation; the work note supplies context rather than decoration.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <filter id="notch-shadow" x="-10%" y="-10%" width="120%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#25241f" flood-opacity="0.10"/>
    </filter>
    <clipPath id="desktop-clip"><rect x="642" y="140" width="486" height="330" rx="16"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#f5f4f0"/>
  <g font-family="Arial, Helvetica, sans-serif" fill="#25241f">
    <image href="${iconUrl}" x="72" y="58" width="48" height="48"/>
    <text x="136" y="94" font-size="36" font-weight="600" letter-spacing="-1.5">Sela</text>

    <text x="72" y="222" font-size="72" font-weight="500" letter-spacing="-3.5">A little space</text>
    <text x="72" y="306" font-size="72" font-weight="500" letter-spacing="-3.5">to remember.</text>
    <g fill="#69675f" font-size="23">
      <text x="74" y="375">Put the thought down.</text>
      <text x="74" y="409">Come back when it matters.</text>
    </g>

    <g clip-path="url(#desktop-clip)">
      <rect x="642" y="140" width="486" height="330" rx="16" fill="#eeede8"/>
      <rect x="642" y="140" width="486" height="32" fill="#faf9f6"/>
      <path d="M642 172 H1128" stroke="#d6d4cd"/>
      <text x="660" y="161" font-size="12" font-weight="600">Notes</text>
      <text x="706" y="161" font-size="12">File</text>
      <text x="738" y="161" font-size="12">Edit</text>
      <text x="1081" y="161" font-size="12">9:41</text>
      <image href="${iconUrl}" x="1052" y="150" width="15" height="15"/>
      <path d="M821 140 H947 V149 Q947 158 938 158 H830 Q821 158 821 149 Z" fill="#171716"/>

      <rect x="690" y="369" width="390" height="73" rx="7" fill="#fffefa" stroke="#d6d4cd"/>
      <text x="710" y="399" font-size="18" font-weight="600">One thing at a time.</text>
      <text x="710" y="425" font-size="14" fill="#69675f">Back to the paragraph I was writing.</text>

      <path d="M665 172 H1105 V332 Q1105 352 1085 352 H685 Q665 352 665 332 Z" fill="#ffffff" stroke="#e4e4e4" filter="url(#notch-shadow)"/>
      <text x="685" y="201" font-size="12" fill="#737373">You asked to be reminded · 15 min ago</text>
      <text x="685" y="237" font-size="27" font-weight="600" letter-spacing="-0.6">Reply to Julian</text>
      <rect x="685" y="258" width="67" height="32" rx="7" fill="#292929"/>
      <text x="718.5" y="279" font-size="13" font-weight="600" text-anchor="middle" fill="#fafafa">Done</text>
      <rect x="761" y="258" width="134" height="32" rx="7" fill="#ffffff" stroke="#dedede"/>
      <text x="828" y="279" font-size="13" text-anchor="middle">Snooze 5 min</text>
      <text x="1020" y="279" font-size="13" fill="#737373">Dismiss</text>
      <text x="685" y="324" font-size="10.5" fill="#737373">Dismiss keeps this reminder in Activities without snoozing it.</text>
    </g>
    <rect x="642" y="140" width="486" height="330" rx="16" fill="none" stroke="#cbc9c2"/>

    <text x="74" y="546" font-size="20">Available only on macOS.</text>
    <text x="74" y="582" font-size="17" fill="#69675f">sela.akbarsaputrait.tech</text>
  </g>
</svg>`

const output = new URL("../public/og-image.png", import.meta.url)
await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(output))
console.log("Generated public/og-image.png (1200×630)")
