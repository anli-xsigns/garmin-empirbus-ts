
import WebSocket from 'ws'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import * as fs from 'fs'

const argv = yargs(hideBin(process.argv))
  .scriptName('wstap')
  .usage('$0 --log out.ndjson [--ws ws://host:port/ws]')
  .option('ws', { type: 'string', default: process.env.EMPIRBUS_WS || 'ws://192.168.1.1:8888/ws', describe: 'WebSocket URL' })
  .option('log', { type: 'string', demandOption: true, describe: 'Output NDJSON log file' })
  .help()
  .parseSync()

const ws = new WebSocket(argv.ws as string)
const out = fs.createWriteStream(argv.log as string, { flags: 'a' })

ws.on('open', () => out.write(JSON.stringify({ ts: new Date().toISOString(), dir: 'out', raw: '[connected]' }) + '\n'))
ws.on('message', (data) => {
  const raw = typeof data === 'string' ? data : data.toString('utf8')
  out.write(JSON.stringify({ ts: new Date().toISOString(), dir: 'in', raw }) + '\n')
})
ws.on('close', () => out.write(JSON.stringify({ ts: new Date().toISOString(), dir: 'out', raw: '[closed]' }) + '\n'))
ws.on('error', (err) => out.write(JSON.stringify({ ts: new Date().toISOString(), dir: 'out', raw: `[error] ${err.message}` }) + '\n'))
