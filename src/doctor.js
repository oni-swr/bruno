import { generateDependencyReport } from '@discordjs/voice';
import { config, request } from './brain.js';
console.log(generateDependencyReport());
for (const [name, url] of [['Speech',`${config.speech}/health`], ['Ollama',`${config.ollama}/api/tags`]]) {
  try { const data = await (await request(url)).json(); console.log(name, 'OK'); if (data.models) console.log('Models:', data.models.map(m => m.name).join(', ')); }
  catch (e) { console.error(name, e.message); process.exitCode = 1; }
}
console.log('Discord token:', process.env.DISCORD_TOKEN ? 'configured' : 'missing');
