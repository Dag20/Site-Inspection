import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { pullIssues, sendMutations } from './api';
import { openLocalDb } from './local/db';
import { SyncEngine } from './local/engine';
import './styles.css';
import { App } from './ui/App';

registerSW({ immediate: true });

const db = await openLocalDb();
// Ask the browser not to clear this site's data when storage runs low. Unsent work lives there.
void navigator.storage?.persist?.();
const engine = new SyncEngine(db, sendMutations, () => pullIssues(db));
engine.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App db={db} engine={engine} />
  </StrictMode>,
);
