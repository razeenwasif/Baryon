import { createServer } from 'node:http';
import { config } from './config.js';
import { listEntries } from './entries.js';

createServer(async (req, res) => res.end(JSON.stringify(await listEntries()))).listen(config.port);
