export const PREPARED_MAX_AGE_MS = Number(process.env.PREPARED_MAX_AGE_MS || 90000);

export function canConsider(s, now, {gap, cooldown}) {
  return !s.quiet && !s.busy && !s.playing && !s.pending && !s.streams.size &&
    s.revision !== s.considered && now - s.lastSpeech >= gap && now - s.lastReply >= cooldown;
}

// Hold at most one comment. A held unsolicited comment is only replaced by a direct reply.
export function canPrepare(s, now, {cooldown, addressed = false}) {
  if (s.prepared && !(addressed && !s.prepared.addressed)) return false;
  // After speaking, wait for someone to say something new (unless an unanswered line names him).
  if (!addressed && s.revision <= (s.spokeAt ?? -1)) return false;
  return !s.quiet && !s.busy && !s.playing && s.revision !== s.considered &&
    now - s.lastReply >= cooldown;
}

// Newer transcripts no longer discard a prepared comment; it waits for the next gap.
export function canPlayPrepared(s, now, {gap, cooldown, maxAge = PREPARED_MAX_AGE_MS}) {
  const candidate = s.prepared;
  return !!candidate && now - candidate.createdAt < maxAge &&
    !s.quiet && !s.playing && !s.pending && !s.streams.size &&
    now - s.lastSpeech >= gap && now - s.lastReply >= cooldown;
}
