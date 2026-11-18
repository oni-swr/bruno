import { Client, GatewayIntentBits, Events, SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } from '@discordjs/voice';
import prism from 'prism-media';
import { Readable } from 'node:stream';
import { appendFileSync, mkdirSync } from 'node:fs';
import { config, request, decide, isAddressed } from './brain.js';
import { canPrepare, canPlayPrepared, PREPARED_MAX_AGE_MS } from './timing.js';

if (!process.env.DISCORD_TOKEN) throw new Error('Set DISCORD_TOKEN in .env first.');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let session;
const logDir = process.env.CONVERSATION_LOG_DIR || 'logs';
const logOthers = process.env.LOG_TRANSCRIPTS !== 'false';
mkdirSync(logDir, { recursive: true });
// One file per day, e.g. logs/conversation-2026-11-19.txt. Also echoed to the console.
function logConversation(tag, speaker, text) {
  if (tag === 'heard' && !logOthers) return;
  const now = new Date();
  const line = `[${now.toLocaleTimeString('de-CH')}] ${tag.padEnd(9)} ${speaker}: ${text}`;
  console.log(line);
  try { appendFileSync(`${logDir}/conversation-${now.toLocaleDateString('sv-SE')}.txt`, line + '\n', 'utf8'); }
  catch (e) { console.error('Log:', e.message); }
}
let controlling = false;
const commands = [
  new SlashCommandBuilder().setName('join').setDescription('Bruno joins your voice channel and listens for a good moment.'),
  new SlashCommandBuilder().setName('leave').setDescription('Disconnect and forget the conversation.'),
  new SlashCommandBuilder().setName('quiet').setDescription('Toggle listening-only mode.'),
].map(c => c.setDMPermission(false).toJSON());

function close() {
  if (!session) return;
  const old = session;
  session = undefined;
  clearInterval(old.timer);
  old.player.stop();
  for (const stream of old.streams.values()) stream.destroy();
  old.connection.destroy();
  old.history.length = 0;
  old.prepared = undefined;
}

async function join(channel) {
  close();
  const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false });
  const s = session = { channel, connection, player: createAudioPlayer(), history: [], streams: new Map(), pending: 0, busy: false, quiet: false, playing: false, lastSpeech: Date.now(), lastReply: 0, revision: 0, considered: 0 };
  s.player.on('error', e => { s.playing = false; console.error('Playback:', e.message); });
  s.player.on(AudioPlayerStatus.Idle, () => { s.playing = false; });
  connection.on('error', e => { console.error('Voice:', e.message); if (session === s) close(); });
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try { await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]); }
    catch { if (session === s) close(); }
  });
  connection.subscribe(s.player);
  try { await entersState(connection, VoiceConnectionStatus.Ready, 20000); }
  catch (e) { if (session === s) close(); throw e; }
  console.log(`Voice ready in ${channel.name}.`);
  s.player.on(AudioPlayerStatus.Playing, () => console.log(`Voice playback started (${Date.now() - s.replyAudioEndedAt} ms after last received audio).`));
  connection.receiver.speaking.on('start', userId => {
    if (channel.members.get(userId)?.user.bot || s.streams.has(userId) || session !== s) return;
    s.lastSpeech = Date.now();
    // Finish the short reply. Discord speaking events include coughs, laughter and echo.
    // Ignore capture during playback; explicit /quiet and /leave still stop it.
    if (s.playing) return;
    const stream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: config.endSilence } });
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    s.streams.set(userId, stream);
    const capturedAt = Date.now();
    const chunks = [];
    let bytes = 0;
    let failed = false;
    const limit = setTimeout(() => stream.destroy(), 20000);
    decoder.on('data', data => { s.lastSpeech = Date.now(); bytes += data.length; if (bytes <= 3840000) chunks.push(data); else stream.destroy(); });
    const fail = e => { failed = true; console.error('Receive:', e.message); stream.destroy(); };
    stream.on('error', fail);
    decoder.on('error', fail);
    stream.pipe(decoder);
    stream.on('close', () => {
      clearTimeout(limit);
      s.streams.delete(userId);
      decoder.destroy();
      if (!failed && bytes >= 48000 && session === s && s.pending < 3) {
        s.pending++;
        void transcribe(s, userId, Buffer.concat(chunks), capturedAt).finally(() => s.pending--);
      }
    });
  });
  s.timer = setInterval(() => void consider(s), 100);
}

async function transcribe(s, userId, pcm, capturedAt) {
  try {
    const result = await (await request(`${config.speech}/transcribe`, { method: 'POST', body: pcm })).json();
    if (!result.text || session !== s) return;
    const speaker = s.channel.members.get(userId)?.displayName || 'Friend';
    logConversation('heard', speaker, result.text);
    s.history.push({ speaker, text: result.text, at: capturedAt });
    s.history = s.history.sort((a,b) => a.at - b.at).slice(-16);
    s.revision++;
    console.log(`Transcribed speech in ${result.seconds.toFixed(2)}s`);
  } catch (e) { console.error('Transcription:', e.message); }
}

async function consider(s) {
  if (process.env.VOICE_DEBUG === '1' && Date.now() - (s.lastDebug || 0) > 5000) {
    s.lastDebug = Date.now();
    console.log('Voice state:', JSON.stringify({pending:s.pending, streams:s.streams.size, busy:s.busy, playing:s.playing, revision:s.revision, considered:s.considered, silenceMs:Date.now()-s.lastSpeech}));
  }
  const addressed = isAddressed(s.history);
  const cooldown = addressed ? Math.min(1500, config.cooldown) : config.cooldown;
  const gap = addressed ? config.directGap : config.gap;
  if (session !== s) return;
  if (s.prepared && Date.now() - s.prepared.createdAt >= PREPARED_MAX_AGE_MS) {
    logConversation('expired', config.name, s.prepared.text);
    s.prepared = undefined;
  }
  if (canPlayPrepared(s, Date.now(), {gap, cooldown})) {
    const candidate = s.prepared;
    s.prepared = undefined;
    try {
      const resource = createAudioResource(Readable.from([candidate.audio]), {inputType: StreamType.Raw});
      s.playing = true;
      s.replyAudioEndedAt = s.lastSpeech;
      s.lastReply = Date.now();
      s.player.play(resource);
      s.history.push({speaker:config.name, text:candidate.text, at:Date.now()});
      logConversation('SAID', config.name, `${candidate.text}  (${candidate.addressed ? 'addressed' : 'unsolicited'}, ${s.revision - candidate.revision} newer turns since)`);
    } catch (e) { s.playing = false; console.error('Playback:', e.message); }
    return;
  }
  if (!canPrepare(s, Date.now(), {cooldown, addressed})) return;
  s.busy = true;
  const revision = s.revision;
  const started = Date.now();
  s.considered = revision;
  const stillRelevant = () => session === s && !s.quiet && Date.now() - started < PREPARED_MAX_AGE_MS && !(s.prepared?.addressed && !addressed);
  try {
    const text = await decide(s.history);
    if (!text || !stillRelevant()) {
      if (text) logConversation('dropped', config.name, text);
      return;
    }
    const audio = Buffer.from(await (await request(`${config.speech}/synthesize-pcm`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text})})).arrayBuffer());
    if (!stillRelevant()) { logConversation('dropped', config.name, text); return; }
    s.prepared = {audio, text, revision, addressed, createdAt:started};
    console.log(`Prepared ${addressed ? 'addressed reply' : 'unsolicited comment'} in ${Date.now()-started} ms; waiting for a gap.`);
  } catch (e) { console.error('Reply:', e.message); }
  finally { s.busy = false; }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  for (const guild of client.guilds.cache.values()) {
    try { await guild.commands.set(commands); }
    catch (e) { console.error('Command registration failed:', e.message); }
  }
  console.log('Use /join in your server while connected to a voice channel.');
  if (process.env.AUTO_JOIN_CHANNEL_ID) {
    try {
      const channel = await client.channels.fetch(process.env.AUTO_JOIN_CHANNEL_ID);
      if (channel?.type !== ChannelType.GuildVoice) throw new Error('Auto-join target is not a voice channel.');
      await join(channel);
    } catch (e) { console.error('Auto-join:', e.message); }
  }
});
client.on(Events.GuildCreate, guild => guild.commands.set(commands).catch(e => console.error(e.message)));
client.on(Events.VoiceStateUpdate, () => {
  if (session && !session.channel.members.some(m => !m.user.bot)) close();
});
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || !['join','leave','quiet'].includes(interaction.commandName)) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (controlling) { await interaction.editReply('A voice command is still in progress. Try again shortly.'); return; }
  controlling = true;
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('Join a regular voice channel first.');
    if (session && session.channel.id !== channel.id) throw new Error('I am already in another channel. Use /leave there first.');
    if (interaction.commandName === 'join') {
      await request(`${config.speech}/health`);
      await join(channel);
      await interaction.editReply('Listening locally. I will chime in occasionally; /quiet pauses replies and /leave clears my memory. Let everyone in the channel know I am listening.');
    } else if (interaction.commandName === 'leave') {
      close(); await interaction.editReply('Disconnected and cleared conversation memory.');
    } else {
      if (!session) throw new Error('Use /join first.');
      session.quiet = !session.quiet;
      if (session.quiet) { session.prepared = undefined; session.player.stop(); }
      await interaction.editReply(session.quiet ? 'Replies paused; still listening.' : 'Replies enabled.');
    }
  } catch (e) { await interaction.editReply(e.message); }
  finally { controlling = false; }
});
client.on(Events.Error, e => console.error('Discord:', e.message));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { close(); client.destroy(); process.exit(0); });
await client.login(process.env.DISCORD_TOKEN);
