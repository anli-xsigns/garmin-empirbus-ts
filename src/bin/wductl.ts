
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { runControl } from '../application/cliControl'

const argv = yargs(hideBin(process.argv))
  .scriptName('wductl')
  .usage('$0 [--ws ws://host:port/ws] <target> <action> [value]')
  .option('ws', { type: 'string', default: process.env.EMPIRBUS_WS || 'ws://192.168.1.1:8888/ws', describe: 'WebSocket URL' })
  .command('$0 <target> <action> [value]', 'Kanal steuern', y => {
    return y
      .positional('target', { type: 'string', describe: 'Kanal-ID oder Name' })
      .positional('action', { type: 'string', choices: ['on','off','toggle','dim'] as const })
      .positional('value', { type: 'number', describe: 'bei dim: Zielwert 0..100' })
  }, async args => {
    try {
      const ws = String(args.ws)
      const target = String(args.target)
      const action = String(args.action) as any
      const value = typeof args.value === 'number' ? args.value : undefined
      await runControl(ws, target, action, value as any)
      console.log('ok')
      process.exit(0)
    } catch (err: any) {
      console.error(err?.message || err)
      process.exit(1)
    }
  })
  .help()
  .strict()
  .parse()
