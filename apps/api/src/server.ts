import { createApp } from './app';
import { DevAuthProvider } from './auth';
import { createDb } from './db/client';
import { channelFromEnv } from './notifications/channels';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
if (process.env.DEV_AUTH !== '1' || process.env.NODE_ENV === 'production') {
  throw new Error('No sign-in provider is configured. Development sign-in (DEV_AUTH=1) is refused in production; real sign-in is added in the first MVP sprint.');
}

const { db } = createDb(url);
const app = createApp({ db, auth: new DevAuthProvider(db), channel: channelFromEnv(), logger: true });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
