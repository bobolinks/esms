import fs from 'fs';
import path from 'path';
import Args from 'args';
import merge from 'deepmerge';
import { EsmServer, EsmsOptions } from './index';

Args
  .option('port', 'The port on which the app will be running', 3000)
  .command('config', 'Config file to be used to run serve', undefined, ['c']);

const args = Args.parse(process.argv);
const target = Args.sub[0] || process.cwd();
const configFile = path.resolve(target, args.config || 'esms.config.ts');
const options = {
  port: args.port,
};

if (fs.existsSync(configFile)) {
  try {
    const cfg = require(configFile);
    main(merge.all([{}, options, cfg.default]) as EsmsOptions);
  } catch (e) {
    console.error(e);
  }
} else {
  main(options);
}

function main(options: EsmsOptions) {
  const server = new EsmServer(target, options);
  server.start();
}
