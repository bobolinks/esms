import fs from 'fs';
import path from 'path';
import Args from 'args';
import merge from 'deepmerge';
import { EsmServer, EsmsOptions } from './index';

Args
  .option('port', 'The port on which the app will be running', 80)
  .command('config', 'Config file to be used to run serve', undefined, ['c']);

const args = Args.parse(process.argv);
const target = Args.sub[0] || process.cwd();
const configFile = path.resolve(target, args.config || 'esms.config.js');
const options = {
  port: args.port,
};

async function main() {
  if (fs.existsSync(configFile)) {
    let cfg = null;
    // load with require
    try {
      cfg = require(configFile);
    } catch (_) {
      try {
        cfg = (await eval(`import('${configFile}')`));
      } catch (e) {
        console.error(e);
      }
    }
    if (cfg) {
      start(merge.all([{}, options, cfg.default || cfg]) as EsmsOptions);
    }
  } else {
    start(options);
  }
}

main();

function start(options: EsmsOptions) {
  const server = new EsmServer(target, options);
  server.start();
}
