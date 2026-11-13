import zlib from 'zlib';

/**
 * Invoice text extraction and deterministic field parsing.
 *
 * Strategy:
 * 1. Text-based PDFs: extract embedded text streams locally (no external API).
 * 2. Scanned PDFs / images: optional Google Cloud Vision OCR via
 *    GOOGLE_VISION_API_KEY. If no provider is configured the result is marked
 *    provider_unavailable and the user can complete the form manually.
 * 3. Parse text into structured fields with explicit confidence labels.
 *
 * No value is invented. Missing fields stay missing and require manual entry.
 */

const TARGET_FIELDS = [
  'productName',
  'brand',
  'modelNumber',
  'serialNumber',
  'purchaseDate',
  'store',
  'invoiceNumber',
  'price',
  'currency',
  'warrantyDuration',
  'warrantyUnit',
  'warrantyStartDate',
  'warrantyEndDate'
];

const MIN_USABLE_TEXT_LENGTH = 20;

/* ------------------------------------------------------------------------- */
/* PDF embedded text extraction                                              */
/* ------------------------------------------------------------------------- */

const decodePdfLiteralString = (raw) => {
  let output = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char !== '\\') {
      output += char;
      continue;
    }

    const next = raw[++i];
    if (next === undefined) break;

    switch (next) {
      case 'n':
        output += '\n';
        break;
      case 'r':
        output += '\r';
        break;
      case 't':
        output += '\t';
        break;
      case 'b':
        output += '\b';
        break;
      case 'f':
        output += '\f';
        break;
      case '(':
      case ')':
      case '\\':
        output += next;
        break;
      case '\r':
        if (raw[i + 1] === '\n') i++;
        break;
      case '\n':
        break;
      default:
        if (/[0-7]/.test(next)) {
          let octal = next;
          while (octal.length < 3 && /[0-7]/.test(raw[i + 1] || '')) {
            octal += raw[++i];
          }
          output += String.fromCharCode(parseInt(octal, 8));
        } else {
          output += next;
        }
    }
  }
  return output;
};

const decodePdfHexString = (raw) => {
  const hex = raw.replace(/\s+/g, '');
  if (hex.length < 2 || hex.length % 2 !== 0) return '';
  let output = '';
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isFinite(code)) output += String.fromCharCode(code);
  }
  return output;
};

/**
 * Some generators put lightweight HTML markup inside PDF text strings (for
 * example "<br/>" or "<font ...>"). Treat it as markup, not invoice text.
 */
const stripHtmlMarkup = (value) =>
  String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[A-Za-z][^>]{0,200}>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const decodeAscii85 = (buffer) => {
  let encoded = buffer.toString('latin1').replace(/\s+/g, '');
  if (encoded.startsWith('<~')) encoded = encoded.slice(2);
  const terminator = encoded.indexOf('~>');
  if (terminator !== -1) encoded = encoded.slice(0, terminator);
  else if (encoded.endsWith('~')) encoded = encoded.slice(0, -1);

  const bytes = [];
  let group = [];

  const flushGroup = () => {
    const originalLength = group.length;
    if (originalLength === 1) throw new Error('Invalid ASCII85 group');
    while (group.length < 5) group.push(84);

    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    if (value > 0xffffffff) throw new Error('Invalid ASCII85 value');

    bytes.push(
      Math.floor(value / 16777216) & 0xff,
      Math.floor(value / 65536) & 0xff,
      Math.floor(value / 256) & 0xff,
      value & 0xff
    );

    if (originalLength < 5) bytes.length -= 5 - originalLength;
    group = [];
  };

  for (const char of encoded) {
    if (char === 'z' && group.length === 0) {
      bytes.push(0, 0, 0, 0);
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 33 || code > 117) throw new Error('Invalid ASCII85 character');
    group.push(code - 33);
    if (group.length === 5) flushGroup();
  }

  if (group.length) flushGroup();
  return Buffer.from(bytes);
};

const decodeAsciiHex = (buffer) => {
  const encoded = buffer
    .toString('latin1')
    .replace(/\s+/g, '')
    .replace(/>.*$/, '');
  if (!encoded || !/^[0-9A-Fa-f]+$/.test(encoded)) {
    throw new Error('Invalid ASCIIHex data');
  }
  const padded = encoded.length % 2 === 0 ? encoded : `${encoded}0`;
  const bytes = [];
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes);
};

const applyPdfFilters = (streamBuffer, dictionary, warnings) => {
  const filterMatch = dictionary.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/);
  if (!filterMatch) return streamBuffer;

  const filters = [...filterMatch[1].matchAll(/\/([A-Za-z0-9]+)/g)].map(
    (match) => match[1]
  );

  let decoded = streamBuffer;
  for (const filter of filters) {
    if (filter === 'FlateDecode' || filter === 'Fl') {
      try {
        decoded = zlib.inflateSync(decoded);
      } catch {
        try {
          decoded = zlib.inflateRawSync(decoded);
        } catch {
          warnings.push('A compressed PDF stream could not be decoded.');
          return null;
        }
      }
      continue;
    }

    if (filter === 'ASCII85Decode' || filter === 'A85') {
      try {
        decoded = decodeAscii85(decoded);
      } catch {
        warnings.push('An ASCII85-encoded PDF stream could not be decoded.');
        return null;
      }
      continue;
    }

    if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      try {
        decoded = decodeAsciiHex(decoded);
      } catch {
        warnings.push('An ASCIIHex-encoded PDF stream could not be decoded.');
        return null;
      }
      continue;
    }

    if (
      filter === 'DCTDecode' ||
      filter === 'JPXDecode' ||
      filter === 'CCITTFaxDecode' ||
      filter === 'JBIG2Decode'
    ) {
      return null;
    }

    warnings.push(`Unsupported PDF stream filter: ${filter}.`);
    return null;
  }

  return decoded;
};

const collectPdfObjects = (binary) => {
  const objects = new Map();
  const pattern = /(?:^|[\r\n])\s*(\d+)\s+(\d+)\s+obj\b/g;
  const matches = [...binary.matchAll(pattern)];

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : binary.length;
    objects.set(match[1], {
      number: match[1],
      body: binary.slice(start, end)
    });
  }

  return objects;
};

const objectDictionary = (body) => {
  const streamIndex = body.search(/\bstream(?:\r\n|\r|\n)/);
  return streamIndex === -1 ? body : body.slice(0, streamIndex);
};

const streamBytesFromObject = (body) => {
  const match = body.match(/\bstream(?:\r\n|\r|\n)/);
  if (!match) return null;

  const start = match.index + match[0].length;
  const dictionary = body.slice(0, match.index);
  const directLength = dictionary.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
  let end = directLength
    ? start + Number(directLength[1])
    : body.indexOf('endstream', start);

  if (end < start || end > body.length) end = body.indexOf('endstream', start);
  if (end < start) return null;

  return Buffer.from(body.slice(start, end), 'latin1');
};

const isNonTextStreamDictionary = (dictionary) =>
  /\/Subtype\s*\/(?:Image|XML)\b|\/Type\s*\/(?:EmbeddedFile|Metadata|ObjStm|XObject|XRef)\b|DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|FontFile/.test(
    dictionary
  );

const extractStringsFromContentStream = (content) => {
  // Split on common positioning operators so extracted text keeps line breaks.
  const chunks = String(content).split(/\b(?:BT|ET|Td|TD|T\*|Tm|TJ)\b/);
  const lines = [];

  for (const chunk of chunks) {
    const pieces = [];
    let index = 0;

    while (index < chunk.length) {
      const char = chunk[index];

      if (char === '(') {
        let depth = 1;
        let raw = '';
        index++;

        while (index < chunk.length && depth > 0) {
          const current = chunk[index];
          if (current === '\\') {
            raw += current;
            index++;
            if (index < chunk.length) raw += chunk[index];
            index++;
            continue;
          }
          if (current === '(') depth++;
          if (current === ')') {
            depth--;
            if (depth === 0) break;
          }
          raw += current;
          index++;
        }

        const decoded = stripHtmlMarkup(decodePdfLiteralString(raw));
        if (decoded.trim()) pieces.push(decoded);
        index++;
        continue;
      }

      if (char === '<' && chunk[index + 1] !== '<') {
        const end = chunk.indexOf('>', index + 1);
        if (end === -1) break;
        const decoded = stripHtmlMarkup(decodePdfHexString(chunk.slice(index + 1, end)));
        if (decoded.trim()) pieces.push(decoded);
        index = end + 1;
        continue;
      }

      index++;
    }

    if (pieces.length) lines.push(pieces.join(' '));
  }

  return lines.join('\n');
};

/**
 * Extract text from a PDF buffer. This handles common FlateDecode and
 * ASCII85Decode content streams. Only page content streams are read when the
 * PDF exposes them, so embedded metadata/images cannot become invoice text.
 */
export const extractTextFromPdfBuffer = (buffer) => {
  const warnings = [];
  let text = '';
  let streamCount = 0;

  try {
    const binary = buffer.toString('latin1');
    if (!binary.includes('%PDF-')) {
      return {
        text: '',
        warnings: ['The uploaded file does not look like a valid PDF.'],
        streamCount: 0
      };
    }

    const objects = collectPdfObjects(binary);
    const contentRefs = new Set();

    for (const object of objects.values()) {
      const dictionary = objectDictionary(object.body);
      if (!/\/Type\s*\/Page\b/.test(dictionary) || /\/Type\s*\/Pages\b/.test(dictionary)) {
        continue;
      }

      const contents = dictionary.match(/\/Contents\s*(\[[\s\S]*?\]|\d+\s+\d+\s+R)/);
      if (!contents) continue;

      for (const match of contents[1].matchAll(/(\d+)\s+\d+\s+R/g)) {
        contentRefs.add(match[1]);
      }
    }

    const candidates = contentRefs.size
      ? [...contentRefs].map((number) => objects.get(number)).filter(Boolean)
      : [...objects.values()];

    for (const object of candidates) {
      const dictionary = objectDictionary(object.body);
      if (isNonTextStreamDictionary(dictionary)) continue;

      const streamBuffer = streamBytesFromObject(object.body);
      if (!streamBuffer) continue;

      const decoded = applyPdfFilters(streamBuffer, dictionary, warnings);
      if (!decoded) continue;

      const extracted = extractStringsFromContentStream(decoded.toString('latin1'));
      if (extracted.trim()) {
        text += `\n${extracted}`;
        streamCount++;
      }
    }

    if (contentRefs.size && streamCount === 0) {
      warnings.push('No readable embedded text was found in the PDF page streams.');
    }

    if (/\/Encrypt\b/.test(binary)) {
      warnings.push('The PDF appears to be encrypted; text extraction may be incomplete.');
    }
  } catch (error) {
    warnings.push(`Local PDF text extraction failed: ${error.message}`);
  }

  return {
    text: cleanText(text),
    warnings,
    streamCount
  };
};


/* ------------------------------------------------------------------------- */
/* Optional OCR provider                                                     */
/* ------------------------------------------------------------------------- */

const callGoogleVisionOcr = async (buffer, mimetype) => {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      error: 'Google Cloud Vision OCR is not configured (GOOGLE_VISION_API_KEY missing).'
    };
  }

  const isPdf = mimetype === 'application/pdf';
  const endpoint = isPdf
    ? `https://vision.googleapis.com/v1/files:annotate?key=${encodeURIComponent(apiKey)}`
    : `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;

  const requestBody = isPdf
    ? {
        requests: [
          {
            inputConfig: {
              content: buffer.toString('base64'),
              mimeType: 'application/pdf'
            },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
          }
        ]
      }
    : {
        requests: [
          {
            image: { content: buffer.toString('base64') },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
          }
        ]
      };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      return {
        available: true,
        error: `OCR provider returned HTTP ${response.status}.`
      };
    }

    const data = await response.json();
    const first = data?.responses?.[0];
    const text =
      first?.fullTextAnnotation?.text ||
      first?.textAnnotations?.[0]?.description ||
      '';

    return { available: true, text: cleanText(text), error: null };
  } catch (error) {
    return {
      available: true,
      error:
        error.name === 'TimeoutError'
          ? 'OCR provider timed out.'
          : `OCR provider request failed: ${error.message}`
    };
  }
};

/* ------------------------------------------------------------------------- */
/* Text normalization and deterministic parsing                              */
/* ------------------------------------------------------------------------- */

const WINDOWS_1252_SPECIALS = {
  '\u0080': '€',
  '\u0085': '…',
  '\u0091': '‘',
  '\u0092': '’',
  '\u0093': '“',
  '\u0094': '”',
  '\u0095': '•',
  '\u0096': '–',
  '\u0097': '—'
};

export const cleanText = (value) =>
  String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[\u0080\u0085\u0091-\u0097]/g, (char) => WINDOWS_1252_SPECIALS[char] || ' ')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const linesOf = (text) =>
  cleanText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const field = (value, confidence = 'medium', evidence = '') => ({
  value,
  confidence,
  status: 'needs_review',
  evidence: String(evidence || '').slice(0, 160)
});

/**
 * Reject binary-looking or nonsensical text before it reaches a user-facing
 * field. This is deliberately conservative: a missing value is safer than a
 * corrupted one because the form always allows manual entry.
 */
const isPlausibleFieldValue = (value, kind = 'text') => {
  const normalized = stripHtmlMarkup(value).replace(/\s+/g, ' ').trim();
  if (normalized.length < 2 || normalized.length > 160) return false;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return false;
  if (/^[\/|<>]+/.test(normalized)) return false;

  const characters = [...normalized];
  const letters = characters.filter((char) => /\p{L}/u.test(char)).length;
  const digits = characters.filter((char) => /\p{N}/u.test(char)).length;
  const allowed = characters.filter((char) =>
    /[\p{L}\p{N}\s.,:;/()&'’"+\-–—_#%*@]/u.test(char)
  ).length;

  if (letters === 0 && digits === 0) return false;
  if (allowed / characters.length < 0.8) return false;

  if (kind === 'name') {
    if (letters < 2) return false;
    if (letters / characters.length < 0.45) return false;
    if (/[<>{}\[\]\\|=~^]/.test(normalized)) return false;
  }

  if (kind === 'identifier' || kind === 'serial') {
    if (/\s/.test(normalized)) return false;
    if (!/\d/.test(normalized)) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/#-]*$/.test(normalized)) return false;
    if (kind === 'serial' && !/[A-Za-z]/.test(normalized) && normalized.length < 6) {
      return false;
    }
  }

  return true;
};

const sanitizeFieldCandidate = (value) => {
  let candidate = stripHtmlMarkup(value).replace(/\s+/g, ' ').trim();
  candidate = candidate.replace(/^[-–—:;#\s]+/, '').trim();
  candidate = candidate.split(/\s+\|\s+/)[0].trim();
  return candidate;
};

const normalizeProductName = (value) => {
  const candidate = sanitizeFieldCandidate(value)
    .replace(/\s*\bModel\s*(?:No\.?|Number)?\s*:.*$/i, '')
    .trim();
  return isPlausibleFieldValue(candidate, 'name') ? candidate : '';
};

/**
 * Column headers in table-style invoices are labels, not values. Without this
 * guard a label such as "Description of Goods" would happily accept the next
 * header ("HSN/SAC") as the product name.
 */
const TABLE_HEADER_LINE =
  /^(?:#|hsn(?:\/sac)?|sac|qty|quantity|unit\s*price|rate|taxable\s*(?:value|amount)|description(?:\s+of\s+goods)?|item(?:\s+description)?|product(?:\s+name)?|serial(?:\s*\/\s*service\s+tag)?|service\s+tag|warranty\s*(?:period|duration|start|end)|amount|total|price|unit|gst|igst|cgst|sgst|discount|tax)$/i;

const isTableHeaderLine = (value) =>
  TABLE_HEADER_LINE.test(sanitizeFieldCandidate(value));

const NUMERIC_ONLY_LINE = /^[\d\s.,:;%+\-–—/()#]+$/;

const looksLikeLabelPrefix = (value) =>
  /^[A-Za-z][A-Za-z .&/()'-]{1,40}:\s*\S/.test(String(value || ''));

/**
 * Lines that are clearly boilerplate rather than a product or seller value.
 */
const NON_VALUE_LINE =
  /\b(?:terms?\s*(?:&|and)\s*conditions?|warranty\s+(?:claims?|policy|terms?|details?|purposes?)|not\s+a\s+valid|sample\s+only|authori[sz]ed\s+signatory|thank\s+you|page\s+\d+\s*(?:of|\/)\s*\d+)\b/i;

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

const toIsoDate = (year, monthIndex, day) => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    year > 2200 ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

/**
 * Parse a date token. Returns { value, ambiguous }.
 * Day-first is used when the token is ambiguous, which is common on invoices.
 */
export const parseDateToken = (token) => {
  const value = String(token || '').trim();

  let match = value.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) {
    return {
      value: toIsoDate(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      ambiguous: false
    };
  }

  match = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    // If one side is clearly a month, use that ordering. Otherwise prefer
    // day-first and flag the ambiguity instead of silently guessing.
    if (first > 12 && second <= 12) {
      return { value: toIsoDate(year, second - 1, first), ambiguous: false };
    }
    if (second > 12 && first <= 12) {
      return { value: toIsoDate(year, first - 1, second), ambiguous: false };
    }
    return {
      value: toIsoDate(year, second - 1, first),
      ambiguous: true
    };
  }

  match = value.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})[,]?\s+(\d{4})\b/);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    if (month !== undefined) {
      return {
        value: toIsoDate(Number(match[3]), month, Number(match[1])),
        ambiguous: false
      };
    }
  }

  match = value.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})[,]?\s+(\d{4})\b/);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month !== undefined) {
      return {
        value: toIsoDate(Number(match[3]), month, Number(match[2])),
        ambiguous: false
      };
    }
  }

  return { value: null, ambiguous: false };
};

const DATE_PATTERN =
  /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}[,]?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2}[,]?\s+\d{4})\b/;

const findDateField = (lines, labels, warnings, { maxLookahead = 2 } = {}) => {
  const labelPattern = new RegExp(
    `(?:${labels.map(escapeRegExp).join('|')})`,
    'i'
  );

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!labelPattern.test(line)) continue;

    const sameLine = line.match(DATE_PATTERN);
    if (sameLine) {
      const parsed = parseDateToken(sameLine[1]);
      if (parsed.value) {
        if (parsed.ambiguous) {
          warnings.push(`Date "${sameLine[1]}" is ambiguous; interpreted as day-first.`);
        }
        return field(parsed.value, 'high', line);
      }
    }

    // Labels and values are often separate text runs/lines in generated PDFs.
    for (let nextIndex = index + 1; nextIndex <= index + maxLookahead; nextIndex++) {
      const nextLine = lines[nextIndex];
      if (!nextLine) break;
      const match = nextLine.match(DATE_PATTERN);
      if (!match) continue;

      const parsed = parseDateToken(match[1]);
      if (!parsed.value) continue;
      if (parsed.ambiguous) {
        warnings.push(`Date "${match[1]}" is ambiguous; interpreted as day-first.`);
      }
      return field(parsed.value, 'high', `${line} ${nextLine}`);
    }
  }

  return null;
};

const findLabeledValue = (lines, labels, { kind = 'text', maxLookahead = 3 } = {}) => {
  const orderedLabels = [...labels].sort((a, b) => b.length - a.length);
  const labelAlternation = orderedLabels.map(escapeRegExp).join('|');
  const inlineSeparatorPattern = new RegExp(
    `^(?:${labelAlternation})\\s*(?:no\\.?|number|#)?\\.?\\s*[:#-]\\s*(.+)$`,
    'i'
  );
  // "Invoice No. TZ-2026-10482" and "Serial No. SN-1" use whitespace plus a
  // marker instead of a colon. Requiring the marker avoids treating a sentence
  // such as "Brand new condition" as a labelled brand value.
  const inlineMarkerPattern = new RegExp(
    `^(?:${labelAlternation})\\s+(?:no\\.?|number|#)\\.?\\s+(.+)$`,
    'i'
  );
  const patterns = [inlineSeparatorPattern, inlineMarkerPattern];

  // Identifiers and serials are often written as "Invoice TZ-2026" or
  // "Serial SAMPLE-001" without any marker. Only use the loose whitespace form
  // for these value types, where a single token is required anyway.
  if (kind === 'identifier' || kind === 'serial') {
    patterns.push(
      new RegExp(
        `^(?:${labelAlternation})\\s*(?:no\\.?|number|#)?\\.?\\s+(.+)$`,
        'i'
      )
    );
  }
  const labelOnlyPattern = new RegExp(
    `^(?:${labelAlternation})\\s*(?:no\\.?|number|#)?\\.?\\s*[:#-]?\\s*$`,
    'i'
  );

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match || !match[1]) continue;
      const candidate = sanitizeFieldCandidate(match[1]);
      if (!candidate || isTableHeaderLine(candidate)) continue;
      if (looksLikeLabelPrefix(candidate)) continue;
      if (isPlausibleFieldValue(candidate, kind)) {
        return { value: candidate, evidence: line, confidence: 'high' };
      }
    }

    if (!labelOnlyPattern.test(line)) continue;

    // Some invoices put the label on one line and the value on a later line
    // (table headers followed by a values row). Skip other headers and
    // numeric row markers before accepting a value.
    for (let nextIndex = index + 1; nextIndex <= index + maxLookahead; nextIndex++) {
      const nextLine = lines[nextIndex];
      if (!nextLine) break;
      if (labelOnlyPattern.test(nextLine)) break;
      if (isTableHeaderLine(nextLine)) continue;
      if (NUMERIC_ONLY_LINE.test(nextLine)) continue;

      const candidate = sanitizeFieldCandidate(nextLine);
      if (!candidate || looksLikeLabelPrefix(candidate)) continue;
      if (!isPlausibleFieldValue(candidate, kind)) continue;

      return {
        value: candidate,
        evidence: `${line} ${nextLine}`,
        confidence: 'medium'
      };
    }
  }

  return null;
};

const parseAmount = (raw) => {
  const cleaned = String(raw || '')
    .replace(/[^\d.,-]/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/,/g, '.');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(2)) : null;
};

const CURRENCY_CODES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED', 'CNY', 'CHF'];

const CURRENCY_SYMBOLS = [
  ['US$', 'USD'],
  ['A$', 'AUD'],
  ['C$', 'CAD'],
  ['₹', 'INR'],
  ['₨', 'INR'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['¥', 'JPY'],
  ['₩', 'KRW']
];

const detectCurrency = (text) => {
  const source = String(text || '');

  const iso = source.match(
    new RegExp(`\\b(${CURRENCY_CODES.join('|')})\\b`, 'i')
  );
  if (iso) return iso[1].toUpperCase();

  // Indian invoices often spell the currency out instead of using an ISO code.
  if (/\b(?:rupees?|rs\.?)\b/i.test(source)) return 'INR';

  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (source.includes(symbol)) return code;
  }

  return '';
};

const AMOUNT_LABELS = [
  'grand total',
  'total amount',
  'invoice total',
  'amount paid',
  'total',
  'price',
  'amount',
  'paid'
];

const amountPatternForLabel = (label) =>
  new RegExp(
    // Anchor to the line start so "Subtotal" or "Taxable amount" cannot be
    // mistaken for the invoice total.
    `^(?:${escapeRegExp(label)})\\s*[:#-]?\\s*(?:[A-Z]{3}\\s*)?(?:₹|Rs\\.?|\\$|€|£|¥)?\\s*([\\d][\\d,]*(?:\\.\\d{1,2})?)`,
    'i'
  );

const findAmount = (lines) => {
  for (const label of AMOUNT_LABELS) {
    const pattern = amountPatternForLabel(label);
    const labelOnlyPattern = new RegExp(
      `^(?:${escapeRegExp(label)})\\s*[:#-]?\\s*(?:[A-Z]{3}|₹|Rs\\.?|\\$|€|£|¥)?\\s*$`,
      'i'
    );

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const sameLine = line.match(pattern);
      if (sameLine) {
        const amount = parseAmount(sameLine[1]);
        if (amount !== null) {
          return { value: amount, evidence: line, confidence: 'high' };
        }
      }

      if (!labelOnlyPattern.test(line)) continue;

      for (let nextIndex = index + 1; nextIndex <= index + 2; nextIndex++) {
        const nextLine = lines[nextIndex];
        if (!nextLine || !/\d/.test(nextLine)) continue;
        const amount = parseAmount(nextLine);
        if (amount !== null) {
          return {
            value: amount,
            evidence: `${line} ${nextLine}`,
            confidence: 'high'
          };
        }
      }
    }
  }

  return null;
};

const DURATION_PATTERN = /(\d{1,3})\s*(day|days|month|months|year|years)\b/i;
const DURATION_LABEL = /warranty\s*(?:period|duration|term)|coverage\s*(?:period|duration|term)|guarantee\s*(?:period|duration|term)/i;

const durationResult = (match) => {
  const rawUnit = match[2].toLowerCase();
  return {
    duration: Number(match[1]),
    unit: rawUnit.startsWith('day')
      ? 'Days'
      : rawUnit.startsWith('month')
        ? 'Months'
        : 'Years',
    evidence: match[0]
  };
};

const findWarrantyDuration = (text) => {
  const lines = linesOf(text);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const sameLine = line.match(DURATION_PATTERN);
    if (sameLine && /warranty|guarantee|coverage/i.test(line)) {
      return durationResult(sameLine);
    }

    if (!DURATION_LABEL.test(line)) continue;
    for (let nextIndex = index + 1; nextIndex <= index + 2; nextIndex++) {
      const nextLine = lines[nextIndex];
      if (!nextLine || DURATION_LABEL.test(nextLine)) break;
      const match = nextLine.match(DURATION_PATTERN);
      if (match) return durationResult(match);
    }
  }

  const flat = cleanText(text).replace(/\s+/g, ' ');
  const fallback = flat.match(
    /(?:warranty|guarantee|coverage)[^.]{0,50}?(\d{1,3})\s*(day|days|month|months|year|years)\b/i
  );
  if (fallback) {
    return durationResult([fallback[0], fallback[1], fallback[2]]);
  }

  return null;
};

const HEADER_WORDS =
  /^(invoice|receipt|tax invoice|bill|statement|date|bill to|ship to|sold to|customer|order|total|subtotal|amount|thank you|gst|vat|phone|email|address)/i;

const findProductName = (lines) => {
  const labeled = findLabeledValue(
    lines,
    [
      'product name',
      'item description',
      'item name',
      'product description',
      'description of goods',
      'product',
      'item'
    ],
    { kind: 'name', maxLookahead: 8 }
  );
  if (labeled) {
    const value = normalizeProductName(labeled.value);
    if (value) return field(value, labeled.confidence, labeled.evidence);
  }

  // Conservative fallback: first descriptive line near the top that is not a
  // header, date, amount, or address. Marked low confidence and still requires
  // explicit user review.
  for (const line of lines.slice(0, 15)) {
    const candidate = normalizeProductName(line.replace(/^[^A-Za-z0-9]+/, '').trim());
    if (!candidate || candidate.length < 3 || candidate.length > 120) continue;
    if (HEADER_WORDS.test(candidate)) continue;
    if (NON_VALUE_LINE.test(candidate)) continue;
    if (isTableHeaderLine(candidate)) continue;
    if (!/[A-Za-z]{2,}/.test(candidate)) continue;
    if (/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(candidate)) continue;
    if (/^[\d\s.,$€£₹¥-]+$/.test(candidate)) continue;

    return field(candidate, 'low', line);
  }

  return null;
};

/**
 * Sellers are often printed as a signature line ("For TechZone Electronics")
 * rather than a labelled "Seller:" field.
 */
const findSellerFallback = (lines) => {
  for (const line of lines) {
    const match = line.match(/^(?:for|sold\s+by|seller|from)\s*[:\-–]?\s+(.{3,120})$/i);
    if (!match) continue;

    const candidate = sanitizeFieldCandidate(match[1]);
    if (!candidate || isTableHeaderLine(candidate)) continue;
    if (HEADER_WORDS.test(candidate)) continue;
    if (NON_VALUE_LINE.test(candidate)) continue;
    if (!isPlausibleFieldValue(candidate, 'name')) continue;

    return { value: candidate, evidence: line, confidence: 'low' };
  }

  return null;
};

/**
 * Parse deterministic fields out of invoice text. Missing fields remain
 * missing; nothing is inferred from the product category.
 */
export const parseInvoiceText = (rawText) => {
  const text = cleanText(rawText);
  const lines = linesOf(text);
  const warnings = [];
  const fields = {};

  const setField = (name, result) => {
    if (result) {
      fields[name] =
        result && result.status
          ? result
          : field(result.value, result.confidence || 'medium', result.evidence || '');
    }
  };

  const productName = findProductName(lines);
  if (productName) fields.productName = productName;

  const brand = findLabeledValue(lines, ['brand name', 'brand', 'manufacturer', 'make'], {
    kind: 'name'
  });
  if (brand) fields.brand = field(brand.value, brand.confidence, brand.evidence);

  const model = findLabeledValue(lines, [
    'model number',
    'model no',
    'model',
    'model #'
  ]);
  if (model) fields.modelNumber = field(model.value, model.confidence, model.evidence);

  const serial = findLabeledValue(
    lines,
    ['serial number', 'serial no', 'serial / service tag', 'service tag', 'serial', 's/n', 'imei'],
    { kind: 'serial', maxLookahead: 6 }
  );
  if (serial) fields.serialNumber = field(serial.value, serial.confidence, serial.evidence);

  const invoiceNumber = findLabeledValue(
    lines,
    [
      'invoice number',
      'invoice no',
      'invoice #',
      'receipt number',
      'receipt no',
      'bill number',
      'bill no',
      'invoice'
    ],
    { kind: 'identifier' }
  );
  if (invoiceNumber) {
    fields.invoiceNumber = field(
      invoiceNumber.value,
      invoiceNumber.confidence,
      invoiceNumber.evidence
    );
  }

  const store =
    findLabeledValue(
      lines,
      ['store name', 'seller', 'vendor', 'store', 'merchant', 'sold by', 'dealer'],
      { kind: 'name' }
    ) || findSellerFallback(lines);
  if (store) fields.store = field(store.value, store.confidence, store.evidence);

  const purchaseDate = findDateField(
    lines,
    ['purchase date', 'date of purchase', 'invoice date', 'date', 'bill date'],
    warnings
  );
  if (purchaseDate) fields.purchaseDate = purchaseDate;

  const startDate = findDateField(
    lines,
    ['warranty start', 'coverage start', 'warranty from'],
    warnings,
    { maxLookahead: 6 }
  );
  if (startDate) fields.warrantyStartDate = startDate;

  const endDate = findDateField(
    lines,
    ['warranty end', 'warranty expires', 'coverage end', 'valid until'],
    warnings
  );
  if (endDate) fields.warrantyEndDate = endDate;

  const amount = findAmount(lines);
  if (amount) fields.price = field(amount.value, amount.confidence, amount.evidence);

  const currency = detectCurrency(text);
  if (currency) fields.currency = field(currency, 'medium', currency);

  const duration = findWarrantyDuration(text);
  if (duration) {
    fields.warrantyDuration = field(duration.duration, 'high', duration.evidence);
    fields.warrantyUnit = field(duration.unit, 'high', duration.evidence);
  }

  // Flag invoices that appear to contain multiple item lines. The first item is
  // still only a suggestion and requires review.
  const itemLikeLines = lines.filter(
    (line) =>
      /\b(qty|quantity|item|description|unit price|sku)\b/i.test(line) ||
      /^\d+\s*[x×]\s+/i.test(line)
  );
  if (itemLikeLines.length > 2) {
    warnings.push(
      'The invoice appears to contain multiple item lines. Confirm the correct product before saving.'
    );
  }

  const missingFields = TARGET_FIELDS.filter(
    (name) => !fields[name] || !fields[name].value
  );

  return { fields, missingFields, warnings };
};

/* ------------------------------------------------------------------------- */
/* Orchestration                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Extract structured information from an invoice buffer.
 * @param {Object} options
 * @param {Buffer} options.buffer
 * @param {string} options.mimetype
 * @param {string} [options.originalName]
 * @returns {Promise<Object>}
 */
export const extractInvoice = async ({ buffer, mimetype, originalName = '' }) => {
  const warnings = [];
  const isPdf = mimetype === 'application/pdf';
  let text = '';
  let provider = 'none';
  let method = 'none';
  let status = 'not_attempted';

  if (isPdf) {
    const local = extractTextFromPdfBuffer(buffer);
    text = local.text;
    warnings.push(...local.warnings);
    if (text.length >= MIN_USABLE_TEXT_LENGTH) {
      provider = 'local-pdf-text';
      method = 'embedded-text';
    }
  }

  if (text.length < MIN_USABLE_TEXT_LENGTH) {
    const ocr = await callGoogleVisionOcr(buffer, mimetype);
    if (!ocr.available) {
      warnings.push(ocr.error);
      status = 'provider_unavailable';
    } else if (ocr.error) {
      warnings.push(ocr.error);
      status = 'failed';
    } else if (ocr.text && ocr.text.length >= 1) {
      text = ocr.text;
      provider = 'google-cloud-vision';
      method = 'ocr';
    } else {
      warnings.push('OCR provider returned no readable text.');
      status = 'failed';
    }
  }

  if (!text || text.length < 1) {
    return {
      provider,
      method,
      status: status === 'not_attempted' ? 'failed' : status,
      extractedAt: new Date(),
      textLength: 0,
      fields: {},
      missingFields: TARGET_FIELDS,
      warnings:
        warnings.length > 0
          ? warnings
          : [`No readable text could be extracted from ${originalName || 'the invoice'}.`]
    };
  }

  const parsed = parseInvoiceText(text);
  warnings.push(...parsed.warnings);

  const foundCount = Object.keys(parsed.fields).length;
  const finalStatus =
    status === 'provider_unavailable' || status === 'failed'
      ? status
      : foundCount > 0
        ? parsed.missingFields.length > 0
          ? 'partial'
          : 'success'
        : 'partial';

  return {
    provider,
    method,
    status: finalStatus,
    extractedAt: new Date(),
    textLength: text.length,
    fields: parsed.fields,
    missingFields: parsed.missingFields,
    warnings
  };
};

export { TARGET_FIELDS };
