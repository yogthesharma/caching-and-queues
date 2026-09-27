import { createHash } from 'node:crypto';

export function etagFor(body) {
  const hash = createHash('sha1').update(JSON.stringify(body)).digest('base64url');
  return `"${hash.slice(0, 16)}"`;
}

// True when the client's cached copy (If-None-Match) matches, so we can answer 304 with no body.
export function isFresh(request, etag) {
  const header = request.headers['if-none-match'];
  if (!header) {
    return false;
  }
  if (header.trim() === '*') {
    return true;
  }
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}
